import MeshWorker from './mesh.worker?worker&inline';
import { WorkerPool, type WorkerLike } from './pool';
import { runTask } from './tasks';

/** Shared pool singleton (lazy). `?noworkers` in the URL forces the main-thread path (A/B debugging, locked-down browsers). */
let pool: WorkerPool | null = null;
const disabled = (): boolean => typeof location !== 'undefined' && /[?&]noworkers\b/.test(location.search);

export function getPool(): WorkerPool {
  if (!pool) {
    const ok = typeof Worker !== 'undefined' && !disabled();
    pool = new WorkerPool({
      factory: ok ? () => new MeshWorker() as unknown as WorkerLike : null,
      runSync: (task, params, inputs) => (runTask as (t: string, p: unknown, i: unknown[]) => unknown)(task, params, inputs),
    });
  }
  return pool;
}
export const setPoolForTests = (p: WorkerPool | null): void => {
  pool?.dispose();
  pool = p;
};
