/**
 * Graph-level time model. PURE.
 * Frames are integers on the timeline; `time` (seconds) = frame / fps and is what the engine's EvalOptions / Frame carry.
 * The loop is the half-open range [start, end): frame `end` equals frame `start` of the next cycle. `loopLength` (a graph
 * setting owned by 1A) is the default length of that range, so `loopPhase` in shaders stays consistent with the timeline.
 */
export type LoopMode = 'once' | 'loop' | 'pingpong';
export type TimeDisplay = 'frames' | 'seconds' | 'timecode';

export interface Marker {
  frame: number;
  name: string;
}

export interface TimelineSettings {
  /** First frame of the animation range. */
  startFrame: number;
  /** Exclusive end frame; null = startFrame + graph loopLength. */
  endFrame: number | null;
  /** Playback range (work area); null = full range. */
  workStart: number | null;
  workEnd: number | null;
  loop: LoopMode;
  /** Playback speed multiplier (negative plays backwards). */
  speed: number;
  autoKey: boolean;
  snap: boolean;
  display: TimeDisplay;
  markers: Marker[];
}

export const defaultTimeline = (): TimelineSettings => ({
  startFrame: 0,
  endFrame: null,
  workStart: null,
  workEnd: null,
  loop: 'loop',
  speed: 1,
  autoKey: false,
  snap: true,
  display: 'frames',
  markers: [],
});

const num = (v: unknown, d: number, lo = -1e7, hi = 1e7): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const optNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Coerce any JSON into valid settings (project files may be old or hand edited). */
export function sanitizeTimeline(raw: unknown): TimelineSettings {
  const d = defaultTimeline();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<Record<keyof TimelineSettings, unknown>>;
  const markers = Array.isArray(r.markers)
    ? (r.markers as unknown[])
        .filter((m): m is Marker => !!m && typeof (m as Marker).frame === 'number' && Number.isFinite((m as Marker).frame))
        .map((m) => ({ frame: Math.round(m.frame), name: String(m.name ?? '') }))
        .slice(0, 512)
    : [];
  return {
    startFrame: Math.round(num(r.startFrame, d.startFrame)),
    endFrame: optNum(r.endFrame) === null ? null : Math.round(optNum(r.endFrame) as number),
    workStart: optNum(r.workStart) === null ? null : Math.round(optNum(r.workStart) as number),
    workEnd: optNum(r.workEnd) === null ? null : Math.round(optNum(r.workEnd) as number),
    loop: r.loop === 'once' || r.loop === 'pingpong' ? r.loop : 'loop',
    speed: num(r.speed, 1, -16, 16) || 1,
    autoKey: !!r.autoKey,
    snap: r.snap !== false,
    display: r.display === 'seconds' || r.display === 'timecode' ? r.display : 'frames',
    markers,
  };
}

export interface FrameRange {
  start: number;
  /** Exclusive. */
  end: number;
}

/** Full animation range [start,end) (>= 1 frame). */
export function animRange(tl: TimelineSettings, loopLength: number): FrameRange {
  const start = tl.startFrame;
  const end = tl.endFrame ?? start + Math.max(1, loopLength);
  return { start, end: Math.max(start + 1, end) };
}

/** Playback range (work area clamped to the full range). */
export function workRange(tl: TimelineSettings, loopLength: number): FrameRange {
  const full = animRange(tl, loopLength);
  const s = Math.max(full.start, Math.min(tl.workStart ?? full.start, full.end - 1));
  const e = Math.min(full.end, Math.max(tl.workEnd ?? full.end, s + 1));
  return { start: s, end: e };
}

export const frameToTime = (frame: number, fps: number): number => frame / fps;
export const timeToFrame = (time: number, fps: number): number => time * fps;

/** Format a frame for display. */
export function formatFrame(frame: number, fps: number, mode: TimeDisplay): string {
  const f = Math.round(frame * 1000) / 1000;
  if (mode === 'frames') return `${Number.isInteger(f) ? f : f.toFixed(2)} f`;
  if (mode === 'seconds') return `${(f / fps).toFixed(3)} s`;
  const total = Math.floor(Math.abs(f));
  const ff = total % Math.round(fps);
  const secs = Math.floor(total / Math.round(fps));
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${f < 0 ? '-' : ''}${p(Math.floor(secs / 60))}:${p(secs % 60)}:${p(ff)}`;
}

/** Parse what a user types into the time field ("12", "12f", "0.5s", "00:01:05"). Returns frames or null. */
export function parseFrame(text: string, fps: number): number | null {
  const s = text.trim().toLowerCase();
  if (!s) return null;
  if (/^\d+:\d+:\d+$/.test(s)) {
    const [m, sec, f] = s.split(':').map(Number);
    return (m * 60 + sec) * Math.round(fps) + f;
  }
  const m = /^(-?\d*\.?\d+)\s*(f|s)?$/.exec(s);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return m[2] === 's' ? v * fps : v;
}

/** Choose a ruler tick step (frames) so that ticks are >= `minPx` apart. */
export function niceTickStep(pxPerFrame: number, minPx = 48): number {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  for (const s of steps) if (s * pxPerFrame >= minPx) return s;
  return 10000;
}

/** Snap a frame to the integer grid (or to markers / range ends when close). */
export function snapFrame(frame: number, opts: { enabled: boolean; targets?: number[]; thresholdFrames?: number }): number {
  if (!opts.enabled) return frame;
  let best = Math.round(frame);
  const th = opts.thresholdFrames ?? 0;
  for (const t of opts.targets ?? []) if (Math.abs(t - frame) <= th && Math.abs(t - frame) < Math.abs(best - frame)) best = t;
  return best;
}
