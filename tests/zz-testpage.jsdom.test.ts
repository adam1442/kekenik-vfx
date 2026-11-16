// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { mountGizmoTest } from '../src/gizmos/testpage';

it('gizmo test page mounts, draws, handles pointer + keyboard input without throwing', async () => {
  const noop: () => void = new Proxy(function () {}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : k === 'canvas' ? {} : noop), apply: () => noop, set: () => true });
  HTMLCanvasElement.prototype.getContext = (() => noop) as never;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);
  const root = document.createElement('div');
  document.body.append(root);
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 900 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 700 });
  mountGizmoTest(root);
  await new Promise((r) => setTimeout(r, 30));
  const canvas = root.querySelector('canvas')!;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 900, height: 700, right: 900, bottom: 700, x: 0, y: 0, toJSON() {} }) as DOMRect;
  canvas.setPointerCapture = () => {};
  const fire = (type: string, x: number, y: number, init: Record<string, unknown> = {}) => canvas.dispatchEvent(Object.assign(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, ...init }), { pointerId: 1 }));
  for (let i = 0; i < 40; i++) { fire('pointermove', 100 + i * 10, 300); }
  fire('pointerdown', 450, 350); fire('pointermove', 470, 360); fire('pointerup', 470, 360);
  fire('dblclick', 450, 350);
  canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 400, clientY: 300, cancelable: true }));
  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
  const buttons = [...root.querySelectorAll('button')];
  for (const b of buttons) b.click();
  await new Promise((r) => setTimeout(r, 30));
  expect(root.textContent).toContain('PASS');
  expect(root.textContent).not.toContain('FAIL');
});
