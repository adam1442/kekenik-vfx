import { collectTransfers, runTask, type TaskName } from './tasks';
import type { TaskRequest, TaskResponse } from './pool';

/** Module worker entry (bundled inline by Vite: `import W from './mesh.worker?worker&inline'`, no external request, works from file:// and static hosting). */
const ctx = self as unknown as { onmessage: ((e: { data: TaskRequest }) => void) | null; postMessage(m: TaskResponse, t?: Transferable[]): void };
ctx.onmessage = (e) => {
  const { taskId, task, params, inputs } = e.data;
  try {
    const outputs = (runTask as (t: TaskName, p: unknown, i: unknown[]) => unknown)(task as TaskName, params, inputs);
    ctx.postMessage({ taskId, ok: true, outputs }, collectTransfers(outputs));
  } catch (err) {
    ctx.postMessage({ taskId, ok: false, error: (err as Error)?.message ?? String(err) });
  }
};
