import { Emitter } from './emitter';

/**
 * Console bus: every diagnostic in the app goes through here; the Console panel
 * subscribes to it. Shader errors carry nodeId / nodeName / file / line (see ShaderDiagnostic).
 */
export type LogLevel = 'info' | 'warn' | 'error';
export type LogSource = 'app' | 'gpu' | 'shader' | 'graph' | 'eval' | 'io' | 'test' | 'fusion' | 'worker' | 'histogram' | 'i18n';

export interface LogEntry {
  id: number;
  time: number;
  level: LogLevel;
  source: LogSource;
  message: string;
  nodeId?: string;
  nodeName?: string;
  file?: string;
  line?: number;
  column?: number;
  /** Extra multi-line detail, e.g. the offending source line. */
  detail?: string;
}

export type LogInput = Omit<LogEntry, 'id' | 'time' | 'level' | 'source'> & { source?: LogSource };

class ConsoleBus {
  readonly entries: LogEntry[] = [];
  readonly onEntry = new Emitter<LogEntry>();
  maxEntries = 2000;
  private nextId = 1;

  push(level: LogLevel, message: string, extra: Partial<LogInput> = {}): LogEntry {
    const e: LogEntry = { id: this.nextId++, time: Date.now(), level, source: 'app', ...extra, message };
    this.entries.push(e);
    if (this.entries.length > this.maxEntries) this.entries.splice(0, this.entries.length - this.maxEntries);
    this.onEntry.emit(e);
    return e;
  }
  info = (m: string, x?: Partial<LogInput>) => this.push('info', m, x);
  warn = (m: string, x?: Partial<LogInput>) => this.push('warn', m, x);
  error = (m: string, x?: Partial<LogInput>) => this.push('error', m, x);
  clear(): void {
    this.entries.length = 0;
  }
  format(e: LogEntry): string {
    const where = e.nodeId ? ` [node ${e.nodeId}${e.nodeName ? ` "${e.nodeName}"` : ''}]` : '';
    const loc = e.file ? ` ${e.file}${e.line ? `:${e.line}${e.column ? `:${e.column}` : ''}` : ''}` : '';
    return `${new Date(e.time).toISOString().slice(11, 23)} ${e.level.toUpperCase()} (${e.source})${where}${loc} ${e.message}${e.detail ? `\n${e.detail}` : ''}`;
  }
}

export const consoleBus = new ConsoleBus();
