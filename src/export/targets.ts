import { MemorySink, utf8, toBlobPart, type ByteSink } from './bytes';
import { ExportCapError, ZipWriter } from './zip';

/**
 * Delivery targets. Everything streams; nothing ever holds a full sequence in RAM.
 *   DirectoryTarget : File System Access API (showDirectoryPicker) -> files are written directly, no size limit.
 *   DownloadTarget  : no FS access -> one file is downloaded as is, several files go into an incrementally built ZIP.
 *                     Pieces are kept as Blobs (the browser may spill them to disk) under a HARD CAP with a clear warning.
 *   MemoryTarget    : tests / self-test.
 */
export interface FileRecord {
  path: string;
  bytes: number;
}

export interface ExportTarget {
  readonly kind: 'directory' | 'download' | 'memory';
  readonly label: string;
  readonly files: FileRecord[];
  /** Hard cap on the total bytes this target accepts (Infinity for folders). */
  readonly capBytes: number;
  openFile(path: string, mime?: string): Promise<ByteSink>;
  writeFile(path: string, data: Uint8Array | string, mime?: string): Promise<void>;
  /** Finalise (ZIP central directory, trigger the download). */
  finish(): Promise<string>;
  abort(): Promise<void>;
}

abstract class BaseTarget implements ExportTarget {
  abstract readonly kind: ExportTarget['kind'];
  abstract readonly label: string;
  readonly files: FileRecord[] = [];
  capBytes = Infinity;
  abstract openFile(path: string, mime?: string): Promise<ByteSink>;
  abstract finish(): Promise<string>;
  abstract abort(): Promise<void>;
  async writeFile(path: string, data: Uint8Array | string, mime?: string): Promise<void> {
    const s = await this.openFile(path, mime);
    await s.write(typeof data === 'string' ? utf8(data) : data);
    await s.close();
  }
  protected track(path: string, sink: ByteSink): ByteSink {
    const rec: FileRecord = { path, bytes: 0 };
    this.files.push(rec);
    return {
      get canSeek() {
        return sink.canSeek;
      },
      get position() {
        return sink.position;
      },
      async write(c) {
        await sink.write(c);
        rec.bytes += c.length;
      },
      writeAt: sink.writeAt ? (p, c) => sink.writeAt!(p, c) : undefined,
      close: () => sink.close(),
      abort: () => sink.abort?.() ?? Promise.resolve(),
    };
  }
}

/* ------------------------------------------------------------------------------------------------ memory */
export class MemoryTarget extends BaseTarget {
  readonly kind = 'memory' as const;
  readonly label = 'memory';
  readonly data = new Map<string, MemorySink>();
  async openFile(path: string): Promise<ByteSink> {
    const s = new MemorySink();
    this.data.set(path, s);
    return this.track(path, s);
  }
  bytesOf(path: string): Uint8Array {
    const s = this.data.get(path);
    if (!s) throw new Error(`MemoryTarget: no file ${path}`);
    return s.bytes();
  }
  async finish(): Promise<string> {
    return `${this.files.length} file(s) in memory`;
  }
  async abort(): Promise<void> {
    this.data.clear();
  }
}

/* ------------------------------------------------------------------------------------------------ File System Access */
type FsDir = FileSystemDirectoryHandle;

export const hasDirectoryPicker = (): boolean => typeof window !== 'undefined' && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';

export class DirectoryTarget extends BaseTarget {
  readonly kind = 'directory' as const;
  get label(): string {
    return `folder "${this.root.name}"`;
  }
  constructor(private root: FsDir) {
    super();
  }
  /** Must run inside a user gesture. Returns null when the user cancels. */
  static async pick(): Promise<DirectoryTarget | null> {
    try {
      const h = await (window as unknown as { showDirectoryPicker(o?: object): Promise<FsDir> }).showDirectoryPicker({ mode: 'readwrite', id: 'kekenik-export' });
      return new DirectoryTarget(h);
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return null;
      throw e;
    }
  }
  async openFile(path: string): Promise<ByteSink> {
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop();
    if (!name) throw new Error('DirectoryTarget: empty file name');
    let dir = this.root;
    for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable({ keepExistingData: false });
    let pos = 0;
    const sink: ByteSink = {
      canSeek: true,
      get position() {
        return pos;
      },
      async write(c) {
        await w.write(c as unknown as FileSystemWriteChunkType);
        pos += c.length;
      },
      async writeAt(p, c) {
        await w.write({ type: 'write', position: p, data: c as unknown as BufferSource });
      },
      async close() {
        await w.close();
      },
      async abort() {
        try {
          await w.abort();
        } catch {
          /* ignore */
        }
      },
    };
    return this.track(path, sink);
  }
  async finish(): Promise<string> {
    return `${this.files.length} file(s) written to ${this.label}`;
  }
  async abort(): Promise<void> {
    /* files already closed stay; the open one is aborted by its owner */
  }
}

/* ------------------------------------------------------------------------------------------------ download (ZIP / single) */

/** Collects chunks as Blobs; coalesces small pieces so the part list stays short. */
export class BlobCollector {
  private parts: BlobPart[] = [];
  private pending: Uint8Array[] = [];
  private pendingBytes = 0;
  bytes = 0;
  constructor(readonly cap: number) {}
  async write(c: Uint8Array): Promise<void> {
    if (this.bytes + c.length > this.cap) throw new ExportCapError(`Download buffer cap reached (${(this.cap / 1048576).toFixed(0)} MB). Use Chrome / Edge to export to a folder, or reduce the size / frame count.`);
    this.pending.push(c.slice());
    this.pendingBytes += c.length;
    this.bytes += c.length;
    if (this.pendingBytes >= 16 * 1024 * 1024) this.flush();
  }
  private flush(): void {
    if (!this.pending.length) return;
    this.parts.push(new Blob(this.pending.map((p) => toBlobPart(p))));
    this.pending = [];
    this.pendingBytes = 0;
  }
  blob(type = 'application/octet-stream'): Blob {
    this.flush();
    return new Blob(this.parts, { type });
  }
}

export type Deliver = (blob: Blob, fileName: string) => void;
const anchorDeliver: Deliver = (blob, name) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
};

const NO_DEFLATE = /\.(png|exr|glb|jpg|jpeg|zip|dds|tga)$/i;

export class DownloadTarget extends BaseTarget {
  readonly kind = 'download' as const;
  readonly label: string;
  private collector: BlobCollector;
  private zip: ZipWriter | null = null;
  private single: { name: string; mime: string } | null = null;
  constructor(private zipName: string, expectedFiles: number, capBytes = 1536 * 1024 * 1024, private deliver: Deliver = anchorDeliver) {
    super();
    this.capBytes = capBytes;
    this.collector = new BlobCollector(capBytes);
    this.label = expectedFiles === 1 ? 'browser download' : `browser download (${zipName}.zip)`;
    if (expectedFiles !== 1) this.zip = new ZipWriter(this.collector, capBytes);
  }
  async openFile(path: string, mime = 'application/octet-stream'): Promise<ByteSink> {
    if (this.zip) {
      const inner = this.zip.beginEntry(path, NO_DEFLATE.test(path) ? 'store' : 'deflate');
      return this.track(path, inner);
    }
    if (this.single) throw new Error('DownloadTarget: planned for a single file but a second one was opened');
    this.single = { name: path.split('/').pop() ?? path, mime };
    const c = this.collector;
    const sink: ByteSink = {
      canSeek: false,
      get position() {
        return c.bytes;
      },
      write: (b) => c.write(b),
      close: async () => undefined,
    };
    return this.track(path, sink);
  }
  async finish(): Promise<string> {
    if (this.zip) {
      await this.zip.finish();
      this.deliver(this.collector.blob('application/zip'), `${this.zipName}.zip`);
      return `${this.files.length} file(s) in ${this.zipName}.zip (${(this.collector.bytes / 1048576).toFixed(1)} MB)`;
    }
    if (!this.single) return 'nothing to deliver';
    this.deliver(this.collector.blob(this.single.mime), this.single.name);
    return `downloaded ${this.single.name}`;
  }
  async abort(): Promise<void> {
    /* collector is garbage collected */
  }
}
