import { isPackageName } from './safety';

export type Method = 'disable' | 'uninstall';

export interface JournalEntry {
  pkg: string;
  /** How it was turned off: `pm disable-user`, or `pm uninstall -k --user 0` when disabling was blocked. */
  method: Method;
  label: string;
  at: string;
}

export interface Journal {
  format: 'quiet-phone-restore';
  version: 1;
  device: { serial: string; brand: string; model: string };
  updatedAt: string;
  entries: JournalEntry[];
}

export function emptyJournal(device: Journal['device']): Journal {
  return { format: 'quiet-phone-restore', version: 1, device, updatedAt: new Date(0).toISOString(), entries: [] };
}

export function serializeJournal(j: Journal): string {
  return JSON.stringify(j, null, 2) + '\n';
}

export class JournalError extends Error {}

export function parseJournal(text: string): Journal {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new JournalError("This isn't a Quiet Phone restore file (it isn't JSON).");
  }
  const o = raw as Partial<Journal> | null;
  if (!o || typeof o !== 'object' || o.format !== 'quiet-phone-restore') {
    throw new JournalError("This isn't a Quiet Phone restore file.");
  }
  if (o.version !== 1) throw new JournalError(`Restore file version ${String(o.version)} is newer than this copy of Quiet Phone.`);
  if (!Array.isArray(o.entries)) throw new JournalError('The restore file has no list of changes.');
  const entries: JournalEntry[] = [];
  for (const e of o.entries as Partial<JournalEntry>[]) {
    if (!e || !isPackageName(e.pkg)) throw new JournalError(`The restore file has a bad package name: ${JSON.stringify(e?.pkg)}`);
    const method: Method = e.method === 'uninstall' ? 'uninstall' : 'disable';
    entries.push({ pkg: e.pkg, method, label: typeof e.label === 'string' ? e.label.slice(0, 120) : e.pkg, at: typeof e.at === 'string' ? e.at : '' });
  }
  const d = (o.device ?? {}) as Partial<Journal['device']>;
  return {
    format: 'quiet-phone-restore',
    version: 1,
    device: { serial: String(d.serial ?? ''), brand: String(d.brand ?? ''), model: String(d.model ?? '') },
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : '',
    entries,
  };
}

/** Union of two journals for the same phone. An uninstall record wins over a disable record. */
export function mergeJournals(a: Journal, b: Journal): Journal {
  const byPkg = new Map<string, JournalEntry>();
  for (const e of [...a.entries, ...b.entries]) {
    const prev = byPkg.get(e.pkg);
    if (!prev) byPkg.set(e.pkg, { ...e });
    else if (e.method === 'uninstall') prev.method = 'uninstall';
  }
  const newer = (a.updatedAt || '') >= (b.updatedAt || '') ? a : b;
  return { ...newer, device: a.device.serial ? a.device : b.device, entries: [...byPkg.values()] };
}

export function withEntry(j: Journal, e: JournalEntry): Journal {
  const entries = j.entries.filter((x) => x.pkg !== e.pkg);
  entries.push(e);
  return { ...j, updatedAt: e.at || new Date().toISOString(), entries };
}

export function withoutEntry(j: Journal, pkg: string): Journal {
  return { ...j, updatedAt: new Date().toISOString(), entries: j.entries.filter((x) => x.pkg !== pkg) };
}
