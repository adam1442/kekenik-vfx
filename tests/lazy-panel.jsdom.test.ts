/* Lazy (code-split) panels: loading state, proxying of resize / serialize / dispose, dispose-before-load, load failure + retry.
 * Run: npm i --no-save jsdom@26 && KK_JSDOM=1 npx vitest run tests/lazy-panel.jsdom.test.ts */
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { registerLazyPanel, type PanelCreate } from '../src/ui/dock/panel-lazy';
import { getPanel, type PanelContext, type PanelInstance } from '../src/ui/dock/panel-registry';

const ctx = { initialState: { tab: 'x' } } as unknown as PanelContext;
const meta = (id: string) => ({ id, title: `Lazy ${id}`, icon: 'info' });

function deferred<T>(): { promise: Promise<T>; resolve(v: T): void; reject(e: unknown): void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
}

describe('registerLazyPanel', () => {
  it('registers the metadata synchronously and shows a loading state until the chunk arrives', async () => {
    const d = deferred<{ create: PanelCreate }>();
    registerLazyPanel(meta('lz1'), () => d.promise);
    const def = getPanel('lz1')!;
    expect(def.title).toBe('Lazy lz1');
    const host = document.createElement('div');
    const inst = def.create(host, ctx);
    expect(host.querySelector('.k-panel-loading')).not.toBeNull();

    // calls made while loading are remembered and replayed
    inst.resize?.(300, 200);
    const real: PanelInstance = { dispose: vi.fn(), resize: vi.fn(), focus: vi.fn(), serialize: () => ({ tab: 'real' }) };
    d.resolve({
      create: (h) => {
        h.append(Object.assign(document.createElement('div'), { className: 'real-ui' }));
        return real;
      },
    });
    await vi.waitFor(() => expect(host.querySelector('.real-ui')).not.toBeNull());
    expect(host.querySelector('.k-panel-loading')).toBeNull();
    expect(real.resize).toHaveBeenCalledWith(300, 200);
    expect(inst.serialize?.()).toEqual({ tab: 'real' });
    inst.resize?.(10, 20);
    expect(real.resize).toHaveBeenLastCalledWith(10, 20);
    inst.dispose();
    expect(real.dispose).toHaveBeenCalledOnce();
  });

  it('serialises the restored state while loading, and never creates a panel that was disposed before its chunk loaded', async () => {
    const d = deferred<{ create: PanelCreate }>();
    registerLazyPanel(meta('lz2'), () => d.promise);
    const host = document.createElement('div');
    const inst = getPanel('lz2')!.create(host, ctx);
    expect(inst.serialize?.()).toEqual({ tab: 'x' });
    inst.dispose();
    const create = vi.fn(() => ({ dispose() {} }));
    d.resolve({ create });
    await Promise.resolve();
    await Promise.resolve();
    expect(create).not.toHaveBeenCalled();
  });

  it('shows the error with a Retry button when the chunk fails to load and recovers on retry', async () => {
    let fail = true;
    registerLazyPanel(meta('lz3'), () => (fail ? Promise.reject(new Error('offline')) : Promise.resolve({ create: (h: HTMLElement) => (h.append(Object.assign(document.createElement('div'), { className: 'real-ui' })), { dispose() {} }) })));
    const host = document.createElement('div');
    getPanel('lz3')!.create(host, ctx);
    await vi.waitFor(() => expect(host.textContent).toContain('offline'));
    fail = false;
    (host.querySelector('button') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(host.querySelector('.real-ui')).not.toBeNull());
  });
});
