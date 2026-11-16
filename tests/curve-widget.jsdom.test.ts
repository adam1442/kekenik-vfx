// @vitest-environment jsdom
import { expect, it } from 'vitest';
import type { CurveValue } from '../src/engine/params/schema';

// Opt-in DOM test (KK_JSDOM=1): drives the curve widget with synthetic pointer / keyboard events.
it('curve widget: add key by clicking, drag it, delete with double click / Delete, flip / invert buttons, set() is silent', async () => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    constructor(private cb: (e: unknown[]) => void) {}
    observe() {
      this.cb([{ contentRect: { width: 220, height: 120 } }]);
    }
    disconnect() {}
  };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 220 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 120 });
  const { createCurveWidget } = await import('../src/ui/widgets/curve');
  await import('../src/ui/widgets/curve-editor');
  const events: string[] = [];
  let last: CurveValue | null = null;
  const w = createCurveWidget({ keys: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, { onBegin: () => events.push('begin'), onInput: (v) => ((last = v), events.push('input')), onEnd: () => events.push('end') }, { height: 120 });
  document.body.append(w.el);
  const canvas = w.el.querySelector('canvas')!;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 220, height: 120, right: 220, bottom: 120, x: 0, y: 0, toJSON() {} }) as DOMRect;
  canvas.setPointerCapture = () => {};
  canvas.releasePointerCapture = () => {};
  const fire = (target: EventTarget, type: string, x: number, y: number, init: Record<string, unknown> = {}): void => {
    target.dispatchEvent(Object.assign(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0, ...init }), { pointerId: 1 }));
  };
  // plot area is [10, 210] x [10, 110]; (0.5, 0.9) -> x = 110, y = 20
  fire(canvas, 'pointerdown', 110, 20);
  fire(window, 'pointermove', 112, 22);
  fire(window, 'pointerup', 112, 22);
  expect(events[0]).toBe('begin');
  expect(events.at(-1)).toBe('end');
  expect(last!.keys).toHaveLength(3);
  expect(last!.keys[1].x).toBeGreaterThan(0.45);
  expect(last!.keys[1].y).toBeGreaterThan(0.7);
  // set() must not call back
  const n = events.length;
  w.set({ keys: [{ x: 0, y: 0.2 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }] });
  expect(events.length).toBe(n);
  expect(w.get().keys[0].y).toBe(0.2);
  // double-click on the middle key (at x=110, y=60) removes it
  fire(canvas, 'dblclick', 110, 60);
  expect(w.get().keys).toHaveLength(2);
  // buttons
  const btn = (label: string): HTMLElement => [...w.el.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLElement;
  btn('Invert').click();
  expect(w.get().keys[0].y).toBeCloseTo(0.8, 6);
  btn('Flip').click();
  expect(w.get().keys[0].x).toBe(0);
  btn('Normalize').click();
  const k = w.get().keys;
  expect(Math.min(...k.map((q) => q.y))).toBeCloseTo(0, 6);
  expect(Math.max(...k.map((q) => q.y))).toBeCloseTo(1, 6);
  // Delete never removes an end key (locked ends)
  w.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  expect(w.get().keys).toHaveLength(2);
  w.dispose();
});
