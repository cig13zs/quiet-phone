import type { Device } from './device';
import { PHONE_RESTORE_PATH } from './device';
import type { Brand, PkgState } from './types';
import type { PhoneInfo } from './phone';
import { readPackages, readPhone, readProtected } from './phone';
import type { Candidate, Plan, PlanOptions } from './plan';
import { buildPlan, defaultSelection, findCandidates } from './plan';
import type { Journal } from './journal';
import { emptyJournal, mergeJournals, parseJournal, serializeJournal } from './journal';
import type { RunOptions, StepResult } from './apply';
import { applyPlan, restore } from './apply';
import { detectBrand } from './detect';
import { brandById } from './data';

/** Where a copy of the restore record is kept on this computer (browser storage, a file...). */
export interface JournalStore {
  load(serial: string): Journal | null | Promise<Journal | null>;
  save(j: Journal): void | Promise<void>;
}

export const memoryStore = (): JournalStore & { data: Map<string, Journal> } => {
  const data = new Map<string, Journal>();
  return { data, load: (s) => data.get(s) ?? null, save: (j) => void data.set(j.device.serial, j) };
};

/**
 * One connected phone, from first read to restore. The web app and the CLI both drive this, so
 * they make exactly the same changes.
 */
export class Session {
  phone!: PhoneInfo;
  states = new Map<string, PkgState>();
  protectedPkgs = new Map<string, string>();
  detected: Brand | undefined;
  brand: Brand | undefined;
  candidates: Candidate[] = [];
  journal!: Journal;
  /** Packages this tool turned off before that are back on (an update, or a manual change). */
  cameBack: string[] = [];
  phoneCopyError: string | null = null;

  constructor(readonly device: Device, private store: JournalStore) {}

  async load(): Promise<void> {
    this.phone = await readPhone(this.device);
    this.protectedPkgs = await readProtected(this.device);
    this.states = await readPackages(this.device);
    this.detected = detectBrand(this.phone);
    const base = emptyJournal({ serial: this.phone.serial, brand: this.phone.brand, model: this.phone.name });
    let j = base;
    const local = await this.store.load(this.phone.serial);
    if (local) j = mergeJournals(j, local);
    try {
      const onPhone = await this.device.readFile(PHONE_RESTORE_PATH);
      if (onPhone) j = mergeJournals(j, parseJournal(onPhone));
    } catch {
      // A missing or unreadable copy on the phone is not a reason to stop; the local copy still counts.
    }
    this.journal = j;
    this.cameBack = j.entries.filter((e) => this.states.get(e.pkg) === 'enabled').map((e) => e.pkg);
    this.useBrand(this.detected?.id ?? this.brand?.id);
  }

  useBrand(id: string | undefined): void {
    this.brand = id ? brandById(id) : undefined;
    this.candidates = this.brand ? findCandidates(this.brand, this.states, this.protectedPkgs) : [];
  }

  defaultSelection(): Set<string> {
    const sel = defaultSelection(this.candidates);
    // Anything this tool turned off before that has come back is picked again.
    for (const pkg of this.cameBack) if (this.candidates.some((c) => c.pkg === pkg && !c.protectedWhy)) sel.add(pkg);
    return sel;
  }

  plan(selection: Iterable<string>, opts: PlanOptions = {}): Plan {
    return buildPlan(this.candidates, selection, opts);
  }

  private async persist(j: Journal): Promise<void> {
    this.journal = j;
    await this.store.save(j);
  }

  /** Keeps a copy of the restore record on the phone, so any computer can undo the changes. */
  async savePhoneCopy(): Promise<void> {
    try {
      await this.device.writeFile(PHONE_RESTORE_PATH, serializeJournal(this.journal));
      this.phoneCopyError = null;
    } catch (e) {
      this.phoneCopyError = (e as Error).message;
    }
  }

  async refresh(): Promise<void> {
    this.states = await readPackages(this.device);
    this.cameBack = this.journal.entries.filter((e) => this.states.get(e.pkg) === 'enabled').map((e) => e.pkg);
    this.useBrand(this.brand?.id);
  }

  async apply(plan: Plan, opts: RunOptions = {}): Promise<StepResult[]> {
    const { results } = await applyPlan(this.device, plan, this.journal, {
      ...opts,
      dynamicProtected: this.protectedPkgs,
      onJournal: (j) => this.persist(j),
    });
    await this.savePhoneCopy();
    await this.refresh();
    return results;
  }

  async restore(opts: RunOptions & { only?: Iterable<string> } = {}): Promise<StepResult[]> {
    const { results } = await restore(this.device, this.journal, { ...opts, onJournal: (j) => this.persist(j) });
    await this.savePhoneCopy();
    await this.refresh();
    return results;
  }

  /** Adds a restore file's records to this phone's journal. Returns how many were new. */
  async importJournal(text: string): Promise<number> {
    const incoming = parseJournal(text);
    const before = new Set(this.journal.entries.map((e) => e.pkg));
    await this.persist(mergeJournals(this.journal, incoming));
    await this.savePhoneCopy();
    return this.journal.entries.filter((e) => !before.has(e.pkg)).length;
  }

  exportJournal(): string {
    return serializeJournal(this.journal);
  }
}
