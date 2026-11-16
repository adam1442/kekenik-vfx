// @vitest-environment jsdom
import { expect, it } from 'vitest';
import type { GradientValue } from '../src/engine/params/schema';

// Opt-in DOM test (KK_JSDOM=1): drives the gradient editor + colour picker with synthetic pointer events,
// mimicking the Properties panel (onBegin / onInput / onEnd, then set() back into the widget).
it('gradient editor: a new stop can get ANY hue (hue strip, saturation / value pad, hex field), also from a white start', async () => {
  const ctxStub = new Proxy({}, { get: () => () => ({ addColorStop() {} }), set: () => true });
  HTMLCanvasElement.prototype.getContext = (() => ctxStub) as never;
  const { GradientEditor } = await import('../src/ui/widgets/gradient');
  const white: GradientValue = { stops: [{ pos: 0, color: [1, 1, 1, 1] }, { pos: 1, color: [1, 1, 1, 1] }] };
  let latest: GradientValue = white;
  const holder: { ge?: InstanceType<typeof GradientEditor> } = {};
  const ge = new GradientEditor(white, {
    onBegin: () => undefined,
    onInput: (v) => (latest = v),
    onEnd: () => holder.ge?.set(latest), // the panel calls widget.set(storedValue) after every edit
  });
  holder.ge = ge;
  document.body.append(ge.el);
  const rect = (l: number, t: number, w: number, hh: number): DOMRect => ({ left: l, top: t, width: w, height: hh, right: l + w, bottom: t + hh, x: l, y: t, toJSON() {} }) as DOMRect;
  const bar = ge.el.querySelector('.bar') as HTMLElement;
  bar.getBoundingClientRect = () => rect(0, 0, 200, 20);
  bar.setPointerCapture = () => undefined;
  bar.releasePointerCapture = () => undefined;
  const fire = (target: EventTarget, type: string, x: number, y: number): void => {
    target.dispatchEvent(Object.assign(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0 }), { pointerId: 1 }));
  };
  // add a stop in the middle
  fire(bar, 'pointerdown', 100, 10);
  fire(window, 'pointerup', 100, 10);
  expect(latest.stops).toHaveLength(3);
  // open the picker of the selected stop
  (ge.el.querySelector('button.k-swatch') as HTMLElement).click();
  const picker = document.querySelector('.k-picker') as HTMLElement;
  expect(picker).toBeTruthy();
  const strips = picker.querySelectorAll('.strip');
  const hue = strips[0] as HTMLElement;
  const sv = picker.querySelector('canvas') as HTMLCanvasElement;
  for (const el of [hue, sv]) {
    el.getBoundingClientRect = () => rect(0, 0, 200, 100);
    el.setPointerCapture = () => undefined;
    el.releasePointerCapture = () => undefined;
  }
  const mid = (): [number, number, number, number] => latest.stops.find((s) => Math.abs(s.pos - 0.5) < 1e-6)!.color as [number, number, number, number];
  // hue = 1/3 (green), saturation / value pad at (s=1, v=1)
  fire(hue, 'pointerdown', 66, 5);
  fire(window, 'pointerup', 66, 5);
  fire(sv, 'pointerdown', 200, 0);
  fire(window, 'pointerup', 200, 0);
  const c = mid();
  expect(c[1]).toBeGreaterThan(0.9);
  expect(c[0]).toBeLessThan(0.1);
  // now blue (hue 2/3) while saturated
  fire(hue, 'pointerdown', 133, 5);
  fire(window, 'pointerup', 133, 5);
  const c2 = mid();
  expect(c2[2]).toBeGreaterThan(0.9);
  expect(c2[0]).toBeLessThan(0.1);
  // hex field
  const hex = picker.querySelector('input.hex') as HTMLInputElement;
  hex.value = '#00ff00';
  hex.dispatchEvent(new Event('change'));
  expect(mid()[1]).toBeGreaterThan(0.9);
  ge.dispose();
});
