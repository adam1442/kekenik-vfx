/**
 * Widget contract. Every widget exposes `el`, `get()/set()` (set never fires callbacks) and `dispose()`.
 *  - `onBegin` / `onEnd` bracket a continuous interaction (drag, scrub); `onInput` fires for every value change
 *    (during a drag, and also for discrete edits such as typing/clicking, which have no begin/end).
 * The Properties panel maps begin/end to a coalesced undo transaction and to scheduler.begin/endInteraction().
 */
export interface WidgetCallbacks<T> {
  onBegin?(): void;
  onInput?(v: T): void;
  onEnd?(): void;
}
export interface Widget<T> {
  readonly el: HTMLElement;
  get(): T;
  set(v: T): void;
  setMixed?(mixed: boolean): void;
  setDisabled?(d: boolean): void;
  dispose(): void;
}
