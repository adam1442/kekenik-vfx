import { defaultGraphSettings, type GraphData } from '../graph/graph';
import type { NodeRegistry } from '../graph/registry';
import { deserializeProject, PROJECT_FORMAT, PROJECT_VERSION, ProjectError, projectFromJson, type ProjectFile } from './project';
import { unwrapIntegrity } from './integrity';
import { salvageGraphData, salvageTruncatedJson } from './salvage';

/**
 * Project loading with corrupted-file recovery. Order of attempts:
 *   1. integrity envelope check (autosaves) -> a damaged envelope is a warning, the payload is still tried,
 *   2. strict parse + migrate + build (the normal path),
 *   3. truncated JSON: close the open brackets (`salvageTruncatedJson`),
 *   4. structural salvage (`salvageGraphData`): drop broken nodes / links, default missing fields.
 * `repairs` lists everything that was fixed (empty = the file was healthy). A file that is not a Kekenik project at all still throws.
 */
export type LoadedProject = ReturnType<typeof deserializeProject> & { repairs: string[] };

export function loadProjectRobust(registry: NodeRegistry, text: string, beforeGraph?: (p: ProjectFile) => void): LoadedProject {
  const repairs: string[] = [];
  const un = unwrapIntegrity(text);
  if (!un.ok) repairs.push(`integrity check failed (${un.reason}): trying to recover the data`);
  let parsed: unknown;
  try {
    parsed = projectFromJson(un.json);
  } catch (e) {
    const rec = salvageTruncatedJson(un.json);
    if (!rec) throw e;
    parsed = rec;
    repairs.push('the file was truncated: the readable part was recovered');
  }
  try {
    const r = deserializeProject(registry, parsed, beforeGraph);
    return { ...r, repairs };
  } catch (e) {
    const p = parsed as Record<string, unknown> | null;
    if (!p || typeof p !== 'object' || p.format !== PROJECT_FORMAT) throw e;
    if (e instanceof ProjectError && /newer version/.test(e.message)) throw e;
    const { data, report } = salvageGraphData(p.graph, defaultGraphSettings());
    repairs.push(`${(e as Error).message}`, ...report.repairs);
    const fixed: Record<string, unknown> = { ...p, graph: data as GraphData };
    const v = Number(p.version);
    if (!Number.isInteger(v) || v < 1 || v > PROJECT_VERSION) fixed.version = PROJECT_VERSION;
    if (!Array.isArray(fixed.assets)) fixed.assets = [];
    if (!Array.isArray(fixed.subgraphs)) delete fixed.subgraphs;
    const r = deserializeProject(registry, fixed, beforeGraph);
    return { ...r, repairs };
  }
}
