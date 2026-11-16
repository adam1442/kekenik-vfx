import { Emitter } from '../../shared/emitter';
import { IndexedDbAssetStore, type AssetStore } from './autosave';
import { DecodeError, IMAGE_EXTENSIONS, MAX_IMAGE_PIXELS, decodeNative, downscaleFactor, downscaleImage, sniffImageFormat, type DecodedImage } from './decode';
import { MODEL_LIMITS, ModelError, parseModelAsync, type ParsedModel } from './model';
import type { AssetMeta } from './project';

/**
 * Asset manager: imported textures / models.
 *  - the original FILE is stored in IndexedDB (`AssetStore`) and embedded as base64 when a project is saved ("bundle"),
 *  - decoded data lives in a BYTE-CAPPED LRU cache (never unbounded); evicted entries decode again on demand,
 *  - decoding is asynchronous: `image(id)` / `model(id)` return null while loading and `onReady` fires afterwards
 *    (the engine re-evaluates), so evaluation never blocks and a failing file only gives its node an error badge.
 */
/** Thrown by nodes while an asset is still decoding: shown as a transient badge, never logged / toasted; the engine re-evaluates on `onReady`. */
export class PendingAssetError extends Error {
  override name = 'PendingError';
}
export type AssetKind = 'image' | 'model';
export interface AssetRecord extends AssetMeta {
  kind: AssetKind;
  width?: number;
  height?: number;
  triangles?: number;
}

export const MODEL_EXTENSIONS = ['glb', 'gltf', 'obj'];
export const kindOfFile = (name: string): AssetKind | null => {
  const e = name.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS.includes(e) ? 'image' : MODEL_EXTENSIONS.includes(e) ? 'model' : null;
};
export const MAX_ASSET_BYTES = 256 * 1024 * 1024;

/** Cheap content id: size + FNV-1a over up to 3 x 64 KB windows (head / middle / tail). */
export function contentId(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  const win = (a: number, b: number): void => {
    for (let i = a; i < b; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  const n = bytes.length;
  const W = 65536;
  win(0, Math.min(n, W));
  if (n > 3 * W) win(Math.floor(n / 2) - W / 2, Math.floor(n / 2) + W / 2);
  if (n > W) win(Math.max(W, n - W), n);
  return `a_${h.toString(36)}${n.toString(36)}`;
}

const toB64 = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s: string): Uint8Array => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

async function decodeBrowser(blob: Blob, maxSize: number): Promise<DecodedImage> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') throw new DecodeError('This browser cannot decode PNG / JPG / WEBP here.');
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  try {
    if (bmp.width * bmp.height > MAX_IMAGE_PIXELS) throw new DecodeError(`Image is too large (${bmp.width}x${bmp.height}). Downscale it first.`);
    const k = downscaleFactor(bmp.width, bmp.height, maxSize);
    const w = Math.max(1, Math.floor(bmp.width / k));
    const h = Math.max(1, Math.floor(bmp.height / k));
    const cv = new OffscreenCanvas(w, h);
    const g = cv.getContext('2d', { willReadFrequently: true });
    if (!g) throw new DecodeError('2D canvas is unavailable.');
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, 0, 0, w, h);
    const data = g.getImageData(0, 0, w, h).data;
    let hasAlpha = false;
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) {
      hasAlpha = true;
      break;
    }
    return { width: w, height: h, kind: 'u8', data, hasAlpha, downscaled: k > 1 ? k : undefined };
  } finally {
    bmp.close();
  }
}

export async function decodeImageBlob(blob: Blob, name: string, maxSize = 0): Promise<DecodedImage> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const native = decodeNative(bytes, name);
  if (native) return downscaleImage(native, downscaleFactor(native.width, native.height, maxSize));
  const fmt = sniffImageFormat(bytes, name);
  if (fmt === 'unknown') throw new DecodeError(`Unsupported image format "${name}".`);
  return decodeBrowser(blob, maxSize);
}

const imageBytes = (i: DecodedImage): number => i.data.byteLength;

export class AssetManager {
  readonly onReady = new Emitter<string>();
  readonly onChange = new Emitter<void>();
  private recs = new Map<string, AssetRecord>();
  private images = new Map<string, DecodedImage>();
  private models = new Map<string, ParsedModel>();
  private pending = new Map<string, Promise<void>>();
  private errs = new Map<string, string>();
  private cached = 0;

  constructor(
    public store: AssetStore = new IndexedDbAssetStore(),
    public cacheBytes = 384 * 1024 * 1024,
  ) {}

  get(id: string): AssetRecord | undefined {
    return this.recs.get(id);
  }
  list(kind?: AssetKind): AssetRecord[] {
    return [...this.recs.values()].filter((r) => !kind || r.kind === kind);
  }
  metas(ids?: Iterable<string>): AssetRecord[] {
    const set = ids ? new Set(ids) : null;
    return this.list().filter((r) => !set || set.has(r.id));
  }
  get cachedBytes(): number {
    return this.cached;
  }
  error(id: string, max = 0): string | undefined {
    return this.errs.get(`${id}@${max}`) ?? this.errs.get(id);
  }

  /** Stores a file and validates it by decoding once (so a corrupt file is rejected with a clear message). */
  async add(blob: Blob, name: string): Promise<AssetRecord> {
    const kind = kindOfFile(name);
    if (!kind) throw new Error(`"${name}" is not a supported image or model (PNG, JPG, WEBP, TGA, EXR, HDR, GLB, glTF, OBJ).`);
    if (blob.size > MAX_ASSET_BYTES) throw new Error(`"${name}" is larger than ${MAX_ASSET_BYTES / 1048576} MB.`);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const id = contentId(bytes);
    const rec: AssetRecord = { id, name, mime: blob.type || (kind === 'image' ? 'image/*' : 'model/*'), size: blob.size, kind };
    if (kind === 'image') {
      const img = await decodeImageBlob(blob, name, 4096);
      rec.width = img.width * (img.downscaled ?? 1);
      rec.height = img.height * (img.downscaled ?? 1);
      this.putImage(`${id}@4096`, img);
    } else {
      const m = await parseModelAsync(bytes, name);
      rec.triangles = m.triangleCount;
      this.models.set(id, m);
    }
    await this.store.put(id, blob);
    this.recs.set(id, rec);
    this.errs.clear();
    this.onChange.emit();
    return rec;
  }

  private putImage(key: string, img: DecodedImage): void {
    const old = this.images.get(key);
    if (old) this.cached -= imageBytes(old);
    this.images.delete(key);
    this.images.set(key, img);
    this.cached += imageBytes(img);
    for (const [k, v] of this.images) {
      if (this.cached <= this.cacheBytes || k === key) break;
      this.images.delete(k);
      this.cached -= imageBytes(v);
    }
  }

  /** Decoded image (RGBA8 / half) or null while it loads. `maxSize` > 0 downscales on import (0 = original). */
  image(id: string, maxSize = 0): DecodedImage | null {
    const key = `${id}@${maxSize}`;
    const hit = this.images.get(key);
    if (hit) {
      this.images.delete(key); // LRU touch
      this.images.set(key, hit);
      return hit;
    }
    // the validated import decode (<= 4096) is also good for any larger / equal request when no downscale happened
    if (!this.pending.has(key) && !this.errs.has(key)) {
      this.pending.set(
        key,
        (async () => {
          try {
            const blob = await this.store.get(id);
            if (!blob) throw new Error('The asset file is missing from this browser\'s storage. Re-import it.');
            const rec = this.recs.get(id);
            this.putImage(key, await decodeImageBlob(blob, rec?.name ?? id, maxSize));
          } catch (e) {
            this.errs.set(key, (e as Error).message);
          } finally {
            this.pending.delete(key);
            this.onReady.emit(id);
          }
        })(),
      );
    }
    return null;
  }

  model(id: string): ParsedModel | null {
    const hit = this.models.get(id);
    if (hit) return hit;
    if (!this.pending.has(id) && !this.errs.has(id)) {
      this.pending.set(
        id,
        (async () => {
          try {
            const blob = await this.store.get(id);
            if (!blob) throw new Error('The asset file is missing from this browser\'s storage. Re-import it.');
            this.models.set(id, await parseModelAsync(new Uint8Array(await blob.arrayBuffer()), this.recs.get(id)?.name ?? id));
            while (this.models.size > 4) this.models.delete(this.models.keys().next().value as string);
          } catch (e) {
            this.errs.set(id, (e as Error).message);
          } finally {
            this.pending.delete(id);
            this.onReady.emit(id);
          }
        })(),
      );
    }
    return null;
  }

  /** Awaitable decode (tests / project load warm-up). */
  async ensure(id: string, maxSize = 0): Promise<void> {
    const rec = this.recs.get(id);
    if (!rec) return;
    if (rec.kind === 'image') this.image(id, maxSize);
    else this.model(id);
    await Promise.all([...this.pending.values()]);
  }

  setRecords(recs: readonly AssetRecord[] | undefined): void {
    this.recs.clear();
    for (const r of recs ?? []) if (r && typeof r.id === 'string' && (r.kind === 'image' || r.kind === 'model')) this.recs.set(r.id, { ...r });
    this.errs.clear();
    this.onChange.emit();
  }

  async remove(id: string): Promise<void> {
    this.recs.delete(id);
    for (const k of [...this.images.keys()]) if (k.startsWith(`${id}@`)) {
      this.cached -= imageBytes(this.images.get(k)!);
      this.images.delete(k);
    }
    this.models.delete(id);
    await this.store.delete(id).catch(() => undefined);
    this.onChange.emit();
  }

  /** Embeds the blobs of `ids` as base64 (project bundle). */
  async exportBlobs(ids: Iterable<string>): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const id of ids) {
      const b = await this.store.get(id);
      if (b) out[id] = toB64(new Uint8Array(await b.arrayBuffer()));
    }
    return out;
  }
  /** Restores embedded blobs into the store (only the ones that are missing). */
  async importBlobs(map: Record<string, string> | undefined): Promise<number> {
    let n = 0;
    for (const [id, data] of Object.entries(map ?? {})) {
      if (await this.store.get(id)) continue;
      await this.store.put(id, new Blob([fromB64(data) as BlobPart], { type: this.recs.get(id)?.mime }));
      n++;
    }
    return n;
  }
}

/** The app-wide asset manager (nodes read it in `evaluate`). Tests swap `assets.store` for a MemoryAssetStore. */
export const assets = new AssetManager();

export { MODEL_LIMITS, ModelError };
