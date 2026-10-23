import type { Device } from './device';
import type { PkgState } from './types';
import type { Plan } from './plan';
import type { Journal, Method } from './journal';
import { withEntry, withoutEntry } from './journal';
import { assertChangeable, isPackageName } from './safety';

export interface StepResult {
  pkg: string;
  label: string;
  ok: boolean;
  method?: Method;
  message: string;
}

export interface RunOptions {
  /** When `pm disable-user` is blocked, remove the package for user 0 instead (default on). */
  allowUninstall?: boolean;
  dynamicProtected?: ReadonlyMap<string, string>;
  /** Called after each package, before the next one starts. */
  onStep?: (r: StepResult, index: number, total: number) => void;
  /** Called every time the journal changes, so it can be saved before the next command. */
  onJournal?: (j: Journal) => void | Promise<void>;
  now?: () => string;
}

const has = (out: string, pkg: string) => out.split(/\r?\n/).some((l) => l.trim() === `package:${pkg}`);

/** One package's state for user 0, or 'absent' when the phone has never heard of it. */
export async function stateOf(device: Device, pkg: string): Promise<PkgState | 'absent'> {
  if (!isPackageName(pkg)) throw new Error(`Not a package name: ${pkg}`);
  const installed = has((await device.shell(['pm', 'list', 'packages', '--user', '0', pkg])).stdout, pkg);
  if (!installed) {
    const known = has((await device.shell(['pm', 'list', 'packages', '-u', '--user', '0', pkg])).stdout, pkg);
    return known ? 'removed' : 'absent';
  }
  const disabled = has((await device.shell(['pm', 'list', 'packages', '-d', '--user', '0', pkg])).stdout, pkg);
  return disabled ? 'disabled' : 'enabled';
}

function firstLine(s: string): string {
  return s.trim().split(/\r?\n/).find((l) => l.trim())?.trim().slice(0, 200) ?? '';
}

/**
 * Turns off each package in the plan. The journal entry is written before the command is sent,
 * so a cable pulled halfway still leaves a record that Restore can use.
 */
export async function applyPlan(device: Device, plan: Plan, journal: Journal, opts: RunOptions = {}): Promise<{ journal: Journal; results: StepResult[] }> {
  const allowUninstall = opts.allowUninstall ?? true;
  const now = opts.now ?? (() => new Date().toISOString());
  const results: StepResult[] = [];
  let j = journal;
  const save = async (next: Journal) => {
    j = next;
    await opts.onJournal?.(j);
  };
  for (const [i, a] of plan.actions.entries()) {
    assertChangeable(a.pkg, opts.dynamicProtected);
    let result: StepResult;
    await save(withEntry(j, { pkg: a.pkg, method: 'disable', label: a.label, at: now() }));
    const r = await device.shell(['pm', 'disable-user', '--user', '0', a.pkg]);
    let state = await stateOf(device, a.pkg);
    if (state === 'disabled') {
      result = { pkg: a.pkg, label: a.label, ok: true, method: 'disable', message: 'Turned off' };
    } else if (allowUninstall && state === 'enabled') {
      await save(withEntry(j, { pkg: a.pkg, method: 'uninstall', label: a.label, at: now() }));
      const u = await device.shell(['pm', 'uninstall', '-k', '--user', '0', a.pkg]);
      state = await stateOf(device, a.pkg);
      result = state === 'removed'
        ? { pkg: a.pkg, label: a.label, ok: true, method: 'uninstall', message: 'Removed for your user (this phone blocks turning it off). Restore puts it back.' }
        : { pkg: a.pkg, label: a.label, ok: false, message: firstLine(u.stdout + '\n' + u.stderr) || firstLine(r.stdout + '\n' + r.stderr) || 'The phone refused.' };
    } else {
      result = { pkg: a.pkg, label: a.label, ok: false, message: firstLine(r.stdout + '\n' + r.stderr) || 'The phone refused.' };
    }
    if (!result.ok && state === 'enabled') await save(withoutEntry(j, a.pkg));
    results.push(result);
    opts.onStep?.(result, i, plan.actions.length);
  }
  return { journal: j, results };
}

/**
 * Puts packages back: re-installs anything removed for user 0, then re-enables anything disabled.
 * Works from the phone's current state, so it is safe to run twice. With `only`, restores just
 * those packages.
 */
export async function restore(device: Device, journal: Journal, opts: RunOptions & { only?: Iterable<string> } = {}): Promise<{ journal: Journal; results: StepResult[] }> {
  const only = opts.only ? new Set(opts.only) : null;
  const todo = journal.entries.filter((e) => !only || only.has(e.pkg)).reverse();
  const results: StepResult[] = [];
  let j = journal;
  for (const [i, e] of todo.entries()) {
    let result: StepResult;
    if (!isPackageName(e.pkg)) {
      result = { pkg: String(e.pkg), label: e.label, ok: false, message: 'Not a package name.' };
    } else {
      let state = await stateOf(device, e.pkg);
      let out = '';
      if (state === 'removed') {
        const r = await device.shell(['cmd', 'package', 'install-existing', '--user', '0', e.pkg]);
        out = r.stdout + r.stderr;
        state = await stateOf(device, e.pkg);
        if (state === 'removed') {
          const r2 = await device.shell(['pm', 'install-existing', '--user', '0', e.pkg]);
          out = r2.stdout + r2.stderr;
          state = await stateOf(device, e.pkg);
        }
      }
      if (state === 'disabled') {
        const r = await device.shell(['pm', 'enable', '--user', '0', e.pkg]);
        out = r.stdout + r.stderr;
        state = await stateOf(device, e.pkg);
      }
      if (state === 'enabled') result = { pkg: e.pkg, label: e.label, ok: true, message: 'Back on' };
      else if (state === 'absent') result = { pkg: e.pkg, label: e.label, ok: true, message: 'Not on this phone, nothing to put back' };
      else result = { pkg: e.pkg, label: e.label, ok: false, message: firstLine(out) || 'The phone refused.' };
    }
    if (result.ok) {
      j = withoutEntry(j, e.pkg);
      await opts.onJournal?.(j);
    }
    results.push(result);
    opts.onStep?.(result, i, todo.length);
  }
  return { journal: j, results };
}
