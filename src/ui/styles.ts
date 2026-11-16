import './theme/index';

/** Styles are real CSS files now (src/ui/theme/*.css, imported above). Kept for backward compatibility. */
export function injectStyles(): void {
  /* CSS is bundled and inlined by the build; nothing to inject at runtime. */
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c);
  return e;
}
