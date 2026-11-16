import { themeColor, uiState } from '../../ui/theme/ui-store';
import type * as THREE from 'three/webgpu';
import type { GpuContext } from '../../engine/gpu/device';
import { cameraBasis, type CameraData } from '../../engine/mesh/camera';
import { makeShape, type ShapeParams, defaultShapeParams } from '../../engine/mesh/shapes';
import { transformMesh, defaultTransformParams } from '../../engine/mesh/ops';
import { STD, type MeshData } from '../../engine/mesh/mesh';
import type { MemoryManager } from '../../engine/resources/memory';
import { consoleBus } from '../../shared/log';
import { badTriangles, crossMarkers, edgePositions, islandColors, normalColors, normalLines, renderArrays, vertexColorChannel, type RenderArrays } from './render-data';

type T = typeof THREE;

export const DISPLAY_MODES = ['matcap', 'pbr', 'unlit', 'wireframe', 'shaded_wire', 'edges', 'points', 'vertices', 'uv_checker', 'vertex_color', 'normals', 'island', 'bad_tris'] as const;
export type DisplayMode = (typeof DISPLAY_MODES)[number];
export const DISPLAY_LABELS: Record<DisplayMode, string> = {
  matcap: 'Matcap', pbr: 'PBR (procedural env)', unlit: 'Unlit', wireframe: 'Wireframe', shaded_wire: 'Shaded + Wire', edges: 'Edges', points: 'Points', vertices: 'Vertices', uv_checker: 'UV Checker', vertex_color: 'Vertex Color', normals: 'Normals', island: 'Island IDs', bad_tris: 'Bad Triangles',
};
export type VcChannel = 'rgb' | 'r' | 'g' | 'b' | 'a';
export type PreviewShape = 'plane' | 'billboard' | 'sphere' | 'cube' | 'cylinder';
export type BlendKind = 'opaque' | 'alpha' | 'additive' | 'multiply' | 'translucent';

export interface SceneOptions {
  display: DisplayMode;
  vcChannel: VcChannel;
  uvSet: number;
  grid: boolean;
  bounds: boolean;
  axes: boolean;
}
export interface MaterialPreview {
  enabled: boolean;
  blend: BlendKind;
  doubleSided: boolean;
  depthWrite: boolean;
  /** Soft-particle depth fade distance in world units (0 = off). */
  softFade: number;
  /** UV scroll in texture widths per second. */
  scroll: [number, number];
  tile: [number, number];
  flipbook: { cols: number; rows: number; frame: number } | null;
  opacity: number;
}
export const defaultMaterialPreview = (): MaterialPreview => ({ enabled: true, blend: 'additive', doubleSided: true, depthWrite: false, softFade: 0, scroll: [0, 0], tile: [1, 1], flipbook: null, opacity: 1 });
export const defaultSceneOptions = (): SceneOptions => ({ display: 'matcap', vcChannel: 'rgb', uvSet: 0, grid: true, bounds: false, axes: true });

export interface SceneStats {
  points: number;
  vertices: number;
  prims: number;
  tris: number;
  attrs: string[];
  cpuBytes: number;
  viewportBytes: number;
  bounds: { size: [number, number, number]; radius: number; center: [number, number, number]; empty: boolean };
  note: string;
}

/**
 * ViewportScene: three.js (WebGPURenderer on OUR GPUDevice) scene for the 3D viewport. All mesh -> GPU conversion for display
 * is derived from the frozen MeshData (render-data.ts). Display objects are rebuilt only when the mesh version or a display
 * option changes; camera moves just re-render. Geometry buffers created for display are accounted in the MemoryManager
 * ('viewport' category) so the memory meter and budget include them.
 */
export class ViewportScene {
  readonly stats: SceneStats = { points: 0, vertices: 0, prims: 0, tris: 0, attrs: [], cpuBytes: 0, viewportBytes: 0, bounds: { size: [0, 0, 0], radius: 0, center: [0, 0, 0], empty: true }, note: '' };
  opts: SceneOptions = defaultSceneOptions();
  mat: MaterialPreview = defaultMaterialPreview();
  private renderer!: THREE.WebGPURenderer;
  private scene!: THREE.Scene;
  private persp!: THREE.PerspectiveCamera;
  private orthoCam!: THREE.OrthographicCamera;
  private display!: THREE.Group;
  private helpers!: THREE.Group;
  private gridObj: THREE.LineSegments | null = null;
  private gridKey = '';
  private matcap!: THREE.Texture;
  private checker!: THREE.Texture;
  private ext: THREE.ExternalTexture | null = null;
  private extSource: GPUTexture | null = null;
  private mesh: MeshData | null = null;
  private meshKey = '';
  private ra: RenderArrays | null = null;
  private billboard = false;
  private solidMats: THREE.Material[] = [];
  private accounted = 0;
  private softUniform: { value: number } | null = null;
  private timeScroll: [number, number] = [0, 0];
  private errorsSeen = new Set<string>();
  private disposed = false;
  private w = 1;
  private h = 1;
  needsRender = true;
  /** transparent canvas, sub-rectangle rendering (tiles) with the aspect of the FULL image. */
  private alphaMode = false;
  private exportView: { fullW: number; fullH: number; x: number; y: number; w: number; h: number } | null = null;

  private constructor(
    private T: T,
    readonly canvas: HTMLCanvasElement,
    private gpu: GpuContext,
    private mm: MemoryManager | null,
  ) {}

  /** `alpha` creates a renderer with a transparent canvas (viewport export). */
  static async create(gpu: GpuContext, mm: MemoryManager | null, canvas: HTMLCanvasElement, opts: { alpha?: boolean } = {}): Promise<ViewportScene> {
    const T = await import('three/webgpu');
    const s = new ViewportScene(T, canvas, gpu, mm);
    s.alphaMode = !!opts.alpha;
    await s.init();
    return s;
  }

  private async init(): Promise<void> {
    const T = this.T;
    // Shared device: three skips requestAdapter / requestDevice and never destroys a device it did not create.
    this.renderer = new T.WebGPURenderer({ canvas: this.canvas, device: this.gpu.device, antialias: true, alpha: this.alphaMode });
    await this.renderer.init();
    this.renderer.toneMapping = T.NoToneMapping;
    this.scene = new T.Scene();
    this.scene.background = new T.Color(themeColor('viewport-clear', '#15171b'));
    this.persp = new T.PerspectiveCamera(40, 1, 0.01, 1000);
    this.orthoCam = new T.OrthographicCamera(-2, 2, 2, -2, -1000, 1000);
    this.display = new T.Group();
    this.helpers = new T.Group();
    this.scene.add(this.display, this.helpers);
    // lights (used by PBR / matcap-less materials); Z up
    const key = new T.DirectionalLight(0xffffff, 2.2);
    key.position.set(3, -4, 6);
    const fill = new T.DirectionalLight(0x9fb4ff, 0.6);
    fill.position.set(-4, 3, 2);
    this.scene.add(new T.HemisphereLight(0xdfe6ff, 0x2a2622, 0.7), key, fill);
    this.matcap = this.makeMatcap();
    this.checker = this.makeChecker();
    this.scene.environment = this.makeEnvironment();
    this.scene.environmentIntensity = 0.9;
  }

  /* ---------------------------------------------------------------------------------- procedural textures */
  private makeMatcap(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#202228';
    g.fillRect(0, 0, 128, 128);
    const grad = g.createRadialGradient(46, 40, 4, 64, 64, 64);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.18, '#d9dde6');
    grad.addColorStop(0.62, '#6f7683');
    grad.addColorStop(0.9, '#2c3038');
    grad.addColorStop(1, '#1b1d22');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(64, 64, 63, 0, Math.PI * 2);
    g.fill();
    // soft rim light
    const rim = g.createRadialGradient(64, 64, 44, 64, 64, 64);
    rim.addColorStop(0, 'rgba(120,150,255,0)');
    rim.addColorStop(1, 'rgba(120,150,255,0.35)');
    g.fillStyle = rim;
    g.fill();
    const t = new this.T.CanvasTexture(c);
    t.colorSpace = this.T.SRGBColorSpace;
    return t;
  }
  private makeChecker(): THREE.Texture {
    const n = 512, cells = 8, s = n / cells;
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d')!;
    for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
      const dark = (i + j) % 2 === 0;
      const r = Math.round(60 + 170 * (i / (cells - 1))), gg = Math.round(60 + 170 * (1 - j / (cells - 1))); // u -> red, v -> green (v up)
      g.fillStyle = dark ? `rgb(${r * 0.55 | 0},${gg * 0.55 | 0},70)` : `rgb(${r},${gg},120)`;
      g.fillRect(i * s, j * s, s, s);
    }
    g.fillStyle = '#ffffffcc';
    g.font = 'bold 22px sans-serif';
    g.fillText('0,0', 8, n - 12);
    g.fillText('1,1', n - 46, 28);
    const t = new this.T.CanvasTexture(c);
    t.colorSpace = this.T.SRGBColorSpace;
    t.wrapS = t.wrapT = this.T.RepeatWrapping;
    return t;
  }
  /** 8-bit equirect "studio": sky gradient, dark floor, two soft boxes. Filterable everywhere (no float textures). */
  private makeEnvironment(): THREE.Texture {
    const W = 128, H = 64;
    const data = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = y / (H - 1); // 0 = zenith
      let r: number, g: number, b: number;
      if (v < 0.5) {
        const k = v / 0.5;
        r = 0.45 + 0.35 * k;
        g = 0.52 + 0.3 * k;
        b = 0.7 + 0.15 * k;
      } else {
        const k = (v - 0.5) / 0.5;
        r = 0.8 * (1 - k) + 0.1 * k;
        g = 0.78 * (1 - k) + 0.1 * k;
        b = 0.75 * (1 - k) + 0.11 * k;
      }
      const u = x / W;
      for (const [cu, cv, w, e] of [[0.12, 0.28, 0.08, 1.0], [0.62, 0.22, 0.06, 0.8]] as const) {
        const d = Math.hypot((u - cu) * 2, (v - cv) * 1.4);
        const k = Math.max(0, 1 - d / w);
        r += e * k;
        g += e * k;
        b += e * k;
      }
      const o = (y * W + x) * 4;
      data[o] = Math.min(255, r * 255);
      data[o + 1] = Math.min(255, g * 255);
      data[o + 2] = Math.min(255, b * 255);
      data[o + 3] = 255;
    }
    const t = new this.T.DataTexture(data, W, H, this.T.RGBAFormat, this.T.UnsignedByteType);
    t.mapping = this.T.EquirectangularReflectionMapping;
    t.colorSpace = this.T.SRGBColorSpace;
    t.magFilter = t.minFilter = this.T.LinearFilter;
    t.needsUpdate = true;
    return t;
  }

  /* ---------------------------------------------------------------------------------- public API */
  setSize(w: number, h: number, dpr: number): void {
    this.w = Math.max(1, Math.floor(w));
    this.h = Math.max(1, Math.floor(h));
    this.renderer.setPixelRatio(Math.min(dpr, 2));
    this.renderer.setSize(this.w, this.h, false);
    this.needsRender = true;
  }
  setOptions(o: Partial<SceneOptions>): void {
    const rebuild = (o.display !== undefined && o.display !== this.opts.display) || (o.vcChannel !== undefined && o.vcChannel !== this.opts.vcChannel) || (o.uvSet !== undefined && o.uvSet !== this.opts.uvSet);
    Object.assign(this.opts, o);
    if (rebuild) this.rebuild();
    this.helpers.visible = true;
    this.needsRender = true;
  }
  setMaterial(m: Partial<MaterialPreview>): void {
    const structural = ['enabled', 'blend', 'doubleSided', 'depthWrite', 'opacity'].some((k) => k in m && (m as Record<string, unknown>)[k] !== (this.mat as unknown as Record<string, unknown>)[k]) || ('softFade' in m && (m.softFade! > 0) !== (this.mat.softFade > 0));
    Object.assign(this.mat, m);
    if (this.softUniform) this.softUniform.value = this.mat.softFade;
    if (structural) this.rebuild();
    this.needsRender = true;
  }
  /** Mesh to display (frozen MeshData). null clears. `previewShape` is used when `mesh` is null (texture preview primitive). */
  setMesh(mesh: MeshData | null, previewShape: PreviewShape | null = null): void {
    const key = mesh ? `m${mesh.uid}:${mesh.version}` : `s:${previewShape}`;
    this.billboard = !mesh && previewShape === 'billboard';
    if (key === this.meshKey) return;
    this.meshKey = key;
    this.mesh = mesh ?? (previewShape ? this.makePreviewMesh(previewShape) : null);
    this.ra = null;
    this.rebuild();
  }
  /** Bind (or clear) the bridge texture. `changed` = the GPUTexture object is new (size change): re-wrap it. */
  setTexture(tex: GPUTexture | null, filterable = true): void {
    if (tex === this.extSource) {
      this.needsRender = true;
      return;
    }
    this.extSource = tex;
    this.ext?.dispose();
    this.ext = null;
    if (tex) {
      const e = new this.T.ExternalTexture(tex);
      e.magFilter = e.minFilter = filterable ? this.T.LinearFilter : this.T.NearestFilter;
      e.generateMipmaps = false;
      this.ext = e;
    }
    this.rebuild();
  }
  get hasTexture(): boolean {
    return !!this.ext;
  }
  get currentMesh(): MeshData | null {
    return this.mesh;
  }

  private makePreviewMesh(shape: PreviewShape): MeshData {
    const p: ShapeParams = { ...defaultShapeParams(), size: [2, 2, 2], radius: 1, segments: 48, rings: 12 };
    switch (shape) {
      case 'sphere':
        return makeShape({ ...p, shape: 'sphere' });
      case 'cube':
        return makeShape({ ...p, shape: 'cube' });
      case 'cylinder':
        return makeShape({ ...p, shape: 'cylinder', caps: true });
      default:
        // vertical quad facing -Y (towards the default front camera); the billboard variant is re-aimed every frame
        return transformMesh(makeShape({ ...p, shape: 'plane', size: [2, 2, 1] }), { ...defaultTransformParams(), rotate: [90, 0, 0] });
    }
  }

  /* ---------------------------------------------------------------------------------- display objects */
  private account(bytes: number): void {
    if (!this.mm) return;
    if (bytes > this.accounted) this.mm.addExternal('viewport', bytes - this.accounted);
    else this.mm.removeExternal('viewport', this.accounted - bytes);
    this.accounted = bytes;
    this.mm.onChange.emit();
  }
  private clearDisplay(): void {
    for (const o of [...this.display.children, ...this.helpers.children.filter((c) => c !== this.gridObj)]) {
      o.parent?.remove(o);
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
    }
    for (const m of this.solidMats) m.dispose();
    this.solidMats = [];
    this.account(0);
  }
  private attr(arr: Float32Array, size: number): THREE.BufferAttribute {
    return new this.T.BufferAttribute(arr, size);
  }
  private lines(positions: Float32Array, color: number, opacity = 1): THREE.LineSegments {
    const g = new this.T.BufferGeometry();
    g.setAttribute('position', this.attr(positions, 3));
    const l = new this.T.LineSegments(g, new this.T.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
    l.frustumCulled = false;
    this.solidMats.push(l.material as THREE.Material);
    return l;
  }

  /** Material for the solid surface according to the display mode / VFX preview. */
  private solidMaterial(mode: DisplayMode, hasColors: boolean): THREE.Material | null {
    const T = this.T;
    const side = this.mat.doubleSided ? T.DoubleSide : T.FrontSide;
    if (this.mat.enabled && this.ext && !['wireframe', 'edges', 'points', 'vertices', 'vertex_color', 'normals', 'island', 'bad_tris', 'uv_checker'].includes(mode)) {
      const blend = this.mat.blend;
      const params: THREE.MeshBasicMaterialParameters = {
        map: this.ext,
        side,
        transparent: blend !== 'opaque',
        depthWrite: this.mat.depthWrite,
        vertexColors: hasColors,
        opacity: blend === 'translucent' ? this.mat.opacity * 0.6 : this.mat.opacity,
        blending: blend === 'additive' ? T.AdditiveBlending : blend === 'multiply' ? T.MultiplyBlending : blend === 'opaque' ? T.NoBlending : T.NormalBlending,
      };
      if (this.mat.softFade > 0) return this.softMaterial(params);
      return new T.MeshBasicMaterial(params);
    }
    switch (mode) {
      case 'unlit':
        return new T.MeshBasicMaterial({ color: 0xb4bcc8, side });
      case 'pbr':
        return new T.MeshStandardMaterial({ color: 0xc9cdd4, roughness: 0.5, metalness: 0.15, side: T.DoubleSide, vertexColors: hasColors });
      case 'matcap':
      case 'shaded_wire':
      case 'bad_tris':
        return new T.MeshMatcapMaterial({ matcap: this.matcap, color: hasColors && mode === 'matcap' ? 0xffffff : 0xffffff, side: T.DoubleSide, vertexColors: hasColors && mode === 'matcap', polygonOffset: mode === 'shaded_wire', polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      case 'uv_checker':
        return new T.MeshMatcapMaterial({ matcap: this.matcap, map: this.checker, side: T.DoubleSide });
      case 'vertex_color':
      case 'normals':
      case 'island':
        return new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide });
      case 'wireframe':
      case 'edges':
        return new T.MeshBasicMaterial({ color: 0x20232a, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, transparent: true, opacity: mode === 'wireframe' ? 0.0 : 0.85, depthWrite: mode !== 'wireframe' });
      default:
        return null;
    }
  }
  /** Soft-particle depth fade (TSL): opacity *= saturate((sceneDepth - fragmentDepth) / distance). Guarded: any failure disables it. */
  private softMaterial(params: THREE.MeshBasicMaterialParameters): THREE.Material {
    const T = this.T as unknown as Record<string, unknown> & T;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tsl = (globalThis as any).__kkTsl as Record<string, any> | undefined;
      if (!tsl) throw new Error('TSL not loaded');
      const m = new (T as unknown as { MeshBasicNodeMaterial: new (p: object) => THREE.Material & { opacityNode: unknown } }).MeshBasicNodeMaterial(params);
      const uSoft = tsl.uniform(this.mat.softFade);
      const uRange = tsl.uniform(this.persp.far - this.persp.near);
      this.softUniform = uSoft;
      m.opacityNode = tsl.saturate(tsl.viewportLinearDepth.sub(tsl.linearDepth()).mul(uRange).div(tsl.max(uSoft, 0.0001)));
      return m;
    } catch (e) {
      this.reportOnce(`soft fade unavailable: ${(e as Error).message}`);
      return new this.T.MeshBasicMaterial(params);
    }
  }
  /** Load three/tsl once (soft fade needs it). */
  async loadTsl(): Promise<void> {
    try {
      const tsl = await import('three/tsl');
      (globalThis as unknown as { __kkTsl: unknown }).__kkTsl = tsl;
    } catch (e) {
      this.reportOnce(`three/tsl failed to load: ${(e as Error).message}`);
    }
  }

  private rebuild(): void {
    if (this.disposed) return;
    this.clearDisplay();
    const T = this.T;
    const mesh = this.mesh;
    if (!mesh) {
      Object.assign(this.stats, { points: 0, vertices: 0, prims: 0, tris: 0, attrs: [], cpuBytes: 0, viewportBytes: 0, note: '' });
      this.stats.bounds = { size: [0, 0, 0], radius: 0, center: [0, 0, 0], empty: true };
      this.updateGrid();
      this.needsRender = true;
      return;
    }
    const mode = this.opts.display;
    const cloud = mesh.primCount === 0;
    let bytes = 0;
    let note = '';
    const b = mesh.bounds();
    const ra = (this.ra ??= renderArrays(mesh, this.opts.uvSet));
    const tris = ra.triCount;
    // ---- solid surface
    if (!cloud && tris > 0) {
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', this.attr(ra.positions, 3));
      geo.setAttribute('normal', this.attr(ra.normals, 3));
      geo.setAttribute('uv', this.attr(ra.uvs, 2));
      bytes += ra.positions.byteLength + ra.normals.byteLength + ra.uvs.byteLength + ra.indices.byteLength;
      let hasColors = false;
      if (mode === 'vertex_color') {
        geo.setAttribute('color', this.attr(vertexColorChannel(ra, this.opts.vcChannel), 3));
        bytes += ra.vertexCount * 12;
        hasColors = true;
      } else if (mode === 'normals') {
        geo.setAttribute('color', this.attr(normalColors(ra), 3));
        bytes += ra.vertexCount * 12;
        hasColors = true;
      } else if (mode === 'island') {
        const ic = islandColors(mesh);
        geo.setAttribute('color', this.attr(ic.colors, 3));
        bytes += ra.vertexCount * 12;
        hasColors = true;
        note = `${ic.count} islands`;
      } else if (ra.colors) {
        geo.setAttribute('color', this.attr(ra.colors, 4));
        bytes += ra.colors.byteLength;
        hasColors = true;
      }
      geo.setIndex(new T.BufferAttribute(ra.indices, 1));
      const mat = this.solidMaterial(mode, hasColors && (mode !== 'matcap' || true));
      if (mat) {
        this.solidMats.push(mat);
        const m = new T.Mesh(geo, mat);
        m.frustumCulled = false;
        m.renderOrder = this.mat.enabled && this.ext && mat.transparent ? 1 : 0;
        this.display.add(m);
      }
      if (mode === 'bad_tris') {
        const bad = badTriangles(mesh, ra);
        note = bad.tris.length ? `${bad.tris.length} bad (${bad.reasons.nonFinite} non-finite, ${bad.reasons.zeroArea} zero-area, ${bad.reasons.zeroUv} zero-UV)` : 'no bad triangles';
        if (bad.positions.length) {
          const bg = new T.BufferGeometry();
          bg.setAttribute('position', this.attr(bad.positions, 3));
          const bm = new T.MeshBasicMaterial({ color: 0xff2a3a, side: T.DoubleSide, depthTest: false, transparent: true, opacity: 0.9 });
          this.solidMats.push(bm);
          const o = new T.Mesh(bg, bm);
          o.frustumCulled = false;
          o.renderOrder = 5;
          this.display.add(o);
          bytes += bad.positions.byteLength;
        }
      }
      if (mode === 'normals') {
        const nl = normalLines(ra, Math.max(b.radius * 0.06, 1e-4));
        this.display.add(this.lines(nl, 0x7ad7ff));
        bytes += nl.byteLength;
      }
    }
    // ---- edges
    if (!cloud && (mode === 'wireframe' || mode === 'edges' || mode === 'shaded_wire')) {
      const ep = edgePositions(mesh);
      bytes += ep.byteLength;
      this.display.add(this.lines(ep, mode === 'shaded_wire' ? 0x6c7bff : 0xd7dce6, mode === 'shaded_wire' ? 0.9 : 1));
    }
    // ---- points / vertices (+ cross markers because WebGPU points are 1 px)
    if (cloud || mode === 'points' || mode === 'vertices') {
      const src = mode === 'vertices' && !cloud ? ra.positions : mesh.positions;
      const count = mode === 'vertices' && !cloud ? ra.vertexCount : mesh.pointCount;
      const pg = new T.BufferGeometry();
      pg.setAttribute('position', this.attr(src, 3));
      const pm = new T.PointsMaterial({ color: 0xffe08a, size: 1, sizeAttenuation: false });
      this.solidMats.push(pm);
      const pts = new T.Points(pg, pm);
      pts.frustumCulled = false;
      this.display.add(pts);
      const cm = crossMarkers(src, count, Math.max(b.radius * 0.012, 1e-4));
      bytes += cm.byteLength;
      this.display.add(this.lines(cm, 0xffe08a));
      if (count > 60_000) note = `markers decimated (${Math.ceil(count / 60_000)}x)`;
    }
    // ---- bounds box
    if (this.opts.bounds && !b.empty) {
      const [x0, y0, z0] = b.min, [x1, y1, z1] = b.max;
      const c = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
      const e = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
      this.helpers.add(this.lines(Float32Array.from(e.flatMap((i) => c[i])), 0x6c7bff, 0.8));
    }
    this.account(bytes);
    const s = this.stats;
    s.points = mesh.pointCount;
    s.vertices = mesh.vertexCount;
    s.prims = mesh.primCount;
    s.tris = tris;
    s.attrs = mesh.list().map((a) => `${a.element[0]}:${a.name}${a.size > 1 ? a.size : ''}`);
    s.cpuBytes = mesh.bytes;
    s.viewportBytes = bytes;
    s.bounds = { size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]], radius: b.radius, center: b.center, empty: b.empty };
    s.note = note;
    void STD;
    this.updateGrid();
    this.needsRender = true;
  }

  /** Grid line colours derived from the theme (`--viewport-clear` + `--text`): subtle lines on both the dark and the light clear colour. */
  private gridColors(): { major: [number, number, number]; minor: [number, number, number] } {
    const T = this.T;
    const bg = new T.Color(themeColor('viewport-clear', '#15171b'));
    const ink = uiState().resolved === 'light' ? new T.Color(0x1c2230) : new T.Color(0xe8eaee);
    const mixc = (k: number): [number, number, number] => {
      const c = bg.clone().lerp(ink, k);
      return [c.r, c.g, c.b];
    };
    return { major: mixc(0.2), minor: mixc(0.09) };
  }

  /** Re-read the theme tokens (called on Dark / Light / accent changes): clear colour + grid colours. */
  applyTheme(): void {
    const T = this.T;
    this.scene.background = new T.Color(themeColor('viewport-clear', '#15171b'));
    this.needsRender = true;
    this.updateGrid();
  }

  private updateGrid(): void {
    const T = this.T;
    const r = Math.max(this.stats.bounds.radius, 0.5);
    const step = Math.pow(10, Math.floor(Math.log10(r / 2)));
    const half = Math.ceil((r * 3) / step / 5) * 5; // cells per side, multiple of 5
    const key = `${step}:${half}:${uiState().resolved}`;
    if (key === this.gridKey && this.gridObj) {
      this.gridObj.visible = this.opts.grid;
      return;
    }
    this.gridKey = key;
    if (this.gridObj) {
      this.helpers.remove(this.gridObj);
      this.gridObj.geometry.dispose();
    }
    const pos: number[] = [], col: number[] = [];
    const gridCols = this.gridColors();
    const ext = half * step;
    for (let i = -half; i <= half; i++) {
      const major = i % 5 === 0;
      const c = i === 0 ? null : major ? gridCols.major : gridCols.minor;
      if (!c) continue;
      pos.push(-ext, i * step, 0, ext, i * step, 0, i * step, -ext, 0, i * step, ext, 0);
      for (let k = 0; k < 4; k++) col.push(c[0], c[1], c[2]);
    }
    // axes
    pos.push(-ext, 0, 0, ext, 0, 0, 0, -ext, 0, 0, ext, 0);
    col.push(0.75, 0.25, 0.27, 0.75, 0.25, 0.27, 0.3, 0.62, 0.36, 0.3, 0.62, 0.36);
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    const l = new T.LineSegments(g, new T.LineBasicMaterial({ vertexColors: true }));
    l.frustumCulled = false;
    l.visible = this.opts.grid;
    this.gridObj = l;
    this.helpers.add(l);
  }

  /** Per-frame UV transform of the preview texture: tiling, scroll, flipbook frame (+ the v flip between graph and mesh UVs). */
  private applyUvTransform(time: number): void {
    const e = this.ext;
    if (!e) return;
    const T = this.T;
    const su = this.mat.scroll[0] * time, sv = this.mat.scroll[1] * time;
    this.timeScroll = [su, sv];
    const fb = this.mat.flipbook;
    const cols = fb ? Math.max(1, fb.cols) : 1, rows = fb ? Math.max(1, fb.rows) : 1;
    const f = fb ? Math.max(0, Math.floor(fb.frame)) % (cols * rows) : 0;
    const col = f % cols, row = Math.floor(f / cols);
    // iu = tile.x * u + su ; iv = 1 - (tile.y * v + sv)   (graph textures are y-down, mesh UVs are v-up)
    e.wrapS = e.wrapT = fb ? T.ClampToEdgeWrapping : T.RepeatWrapping;
    e.repeat.set(this.mat.tile[0] / cols, -this.mat.tile[1] / rows);
    e.offset.set((su + col) / cols, (1 - sv + row) / rows);
    e.matrixAutoUpdate = true;
  }

  private applyCamera(c: CameraData): THREE.Camera {
    const aspect = this.exportView ? this.exportView.fullW / this.exportView.fullH : this.w / this.h;
    const b = cameraBasis(c);
    const cam = c.ortho ? this.orthoCam : this.persp;
    cam.position.set(c.position[0], c.position[1], c.position[2]);
    cam.up.set(b.up[0], b.up[1], b.up[2]);
    cam.lookAt(c.target[0], c.target[1], c.target[2]);
    if (c.ortho) {
      const hh = c.orthoSize / 2;
      this.orthoCam.left = -hh * aspect;
      this.orthoCam.right = hh * aspect;
      this.orthoCam.top = hh;
      this.orthoCam.bottom = -hh;
      this.orthoCam.near = c.near;
      this.orthoCam.far = c.far;
      this.orthoCam.updateProjectionMatrix();
    } else {
      this.persp.fov = c.fovY;
      this.persp.aspect = aspect;
      this.persp.near = Math.max(1e-5, c.near);
      this.persp.far = c.far;
      this.persp.updateProjectionMatrix();
    }
    const ev = this.exportView;
    if (ev) (cam as THREE.PerspectiveCamera).setViewOffset(ev.fullW, ev.fullH, ev.x, ev.y, ev.w, ev.h);
    else (cam as THREE.PerspectiveCamera).clearViewOffset();
    cam.updateMatrixWorld(true);
    return cam;
  }

  /** prepare for an export render (no helpers, optional transparent / solid background). */
  beginExport(o: { transparent: boolean; background: [number, number, number] }): void {
    this.scene.background = o.transparent && this.alphaMode ? null : new this.T.Color().setRGB(o.background[0], o.background[1], o.background[2]);
    this.setOptions({ grid: false, axes: false, bounds: false });
    this.helpers.visible = false;
  }
  /** render only the sub-rectangle (x, y, w, h) of a fullW x fullH image (null = normal rendering). */
  setExportView(v: { fullW: number; fullH: number; x: number; y: number; w: number; h: number } | null): void {
    this.exportView = v;
    this.needsRender = true;
  }

  private reportOnce(msg: string): void {
    if (this.errorsSeen.has(msg)) return;
    this.errorsSeen.add(msg);
    consoleBus.error(`3D viewport: ${msg}`, { source: 'app' });
  }

  render(cam: CameraData, timeSec: number): void {
    if (this.disposed) return;
    this.needsRender = false;
    const camera = this.applyCamera(cam);
    this.applyUvTransform(timeSec);
    if (this.billboard) {
      const q = new this.T.Quaternion().setFromAxisAngle(new this.T.Vector3(1, 0, 0), -Math.PI / 2);
      for (const o of this.display.children) o.quaternion.copy(camera.quaternion).multiply(q);
      // the preview plane faces -Y at rest; copying the camera quaternion makes it parallel to the screen
    }
    try {
      this.renderer.render(this.scene, camera);
    } catch (e) {
      this.reportOnce(`render failed: ${(e as Error).message}`);
      if (this.mat.softFade > 0) {
        this.mat.softFade = 0;
        this.rebuild();
      }
    }
  }

  /** Animated things (uv scroll) need continuous rendering. */
  get animated(): boolean {
    return this.mat.enabled && !!this.ext && (this.mat.scroll[0] !== 0 || this.mat.scroll[1] !== 0);
  }
  get scrollOffset(): [number, number] {
    return this.timeScroll;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearDisplay();
    this.gridObj?.geometry.dispose();
    this.ext?.dispose();
    this.matcap.dispose();
    this.checker.dispose();
    (this.scene.environment as THREE.Texture | null)?.dispose();
    this.renderer.dispose(); // does NOT destroy our shared GPUDevice (three only destroys devices it created)
  }
}
