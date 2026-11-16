/* DOM smoke test of the redesigned Home screen with stub services (no GPU: thumbnails stay placeholders).
 * Run: npm i --no-save jsdom@26 && KK_JSDOM=1 npx vitest run tests/home.jsdom.test.ts */
// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { makeRegistry } from './helpers';

beforeAll(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s };
});

const wait = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('Home screen', () => {
  it('renders the gallery, filters, selects, navigates by keyboard and opens a sample as a copy', async () => {
    const { openHome } = await import('../src/app/home');
    const registry = makeRegistry();
    const loaded: { text: string; opts: { name?: string; dirty?: boolean } }[] = [];
    const selection: string[][] = [];
    const app = {
      engine: { registry, subgraphs: { load: () => [] } },
      project: { confirmDiscard: async () => true, loadText: (text: string, opts: { name?: string; dirty?: boolean }) => loaded.push({ text, opts }), newProject: async () => true, open: async () => {} },
      selection: { set: (s: string[]) => selection.push(s) },
      dock: { openPanel: () => {} },
      commands: { execute: () => {} },
    };
    const kv = <T,>() => ({ all: async () => [] as { key: string; value: T }[], get: async () => undefined, put: async () => {}, del: async () => {} });
    const lib = { recents: kv(), versions: kv(), thumbs: kv<{ url: string }>() };
    openHome(app as never, lib as never);
    await wait(60);
    const root = document.querySelector('.k-home')!;
    const cards = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('.k-home-card')];
    expect(cards().length).toBeGreaterThanOrEqual(22);
    expect(root.querySelectorAll('.chip').length).toBe(13);
    expect(root.querySelector('.detail h3')?.textContent?.length).toBeGreaterThan(2);

    // search by node name
    const search = root.querySelector<HTMLInputElement>('.k-home-search')!;
    search.value = 'fluid 2d';
    search.dispatchEvent(new Event('input'));
    const hits = cards().map((c) => c.dataset.id);
    expect(hits).toContain('campfire_loop');
    expect(hits).not.toContain('hello_nodes');
    // category chip + beginner
    search.value = '';
    search.dispatchEvent(new Event('input'));
    const chip = (label: string): HTMLElement => [...root.querySelectorAll<HTMLElement>('.chip')].find((c) => c.textContent === label)!;
    chip('Beginner').click();
    expect(cards().map((c) => c.dataset.id)).toEqual(expect.arrayContaining(['hello_nodes', 'tiling_check_tutorial']));
    // keyboard
    const grid = root.querySelector<HTMLElement>('.grid')!;
    const first = cards()[0].dataset.id;
    grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(cards().findIndex((c) => c.classList.contains('sel'))).toBeGreaterThanOrEqual(0);
    expect(first).toBeTruthy();
    // open as copy
    cards().find((c) => c.dataset.id === 'hello_nodes')!.click();
    [...root.querySelectorAll<HTMLElement>('.detail .k-btn')].find((b) => b.classList.contains('primary'))!.click();
    await vi.waitFor(() => expect(loaded.length).toBe(1));
    expect(loaded[0].opts.dirty).toBe(true);
    expect(loaded[0].opts.name).toContain('(copy)');
    expect(selection[0]).toEqual(['ramp']);
    expect(document.querySelector('.k-home')).toBeNull();
  });
});
