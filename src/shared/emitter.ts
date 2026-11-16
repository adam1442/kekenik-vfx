/** Tiny typed event emitter + reactive store. No dependencies. */

export type Unsubscribe = () => void;

export class Emitter<T> {
  private listeners = new Set<(v: T) => void>();
  on(fn: (v: T) => void): Unsubscribe {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(v: T): void {
    for (const l of [...this.listeners]) {
      try {
        l(v);
      } catch (e) {
        console.error('[Emitter] listener threw', e);
      }
    }
  }
  clear(): void {
    this.listeners.clear();
  }
  get size(): number {
    return this.listeners.size;
  }
}

/** Minimal observable value. `subscribe` fires on change only (pass immediate=true to also fire now). */
export class Store<T> {
  private emitter = new Emitter<[T, T]>();
  constructor(private value: T) {}
  get(): T {
    return this.value;
  }
  set(next: T): void {
    if (Object.is(next, this.value)) return;
    const prev = this.value;
    this.value = next;
    this.emitter.emit([next, prev]);
  }
  update(fn: (v: T) => T): void {
    this.set(fn(this.value));
  }
  subscribe(fn: (v: T, prev: T) => void, immediate = false): Unsubscribe {
    if (immediate) fn(this.value, this.value);
    return this.emitter.on(([n, p]) => fn(n, p));
  }
}

export function createStore<T>(initial: T): Store<T> {
  return new Store(initial);
}
