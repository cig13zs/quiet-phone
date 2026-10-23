import { ESSENTIALS } from './data';
import type { Essentials } from './types';

const PKG = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;

export function isPackageName(s: unknown): s is string {
  return typeof s === 'string' && s.length <= 255 && PKG.test(s);
}

/** Why a package is on the static essential denylist, or null if it is not. */
export function essentialReason(pkg: string, ess: Essentials = ESSENTIALS): string | null {
  if (ess.exact.includes(pkg)) return ess.notes[pkg] ?? 'Part of the system the phone needs to work.';
  const prefix = ess.prefixes.find((p) => pkg.startsWith(p));
  if (prefix) return ess.notes[prefix] ?? 'Part of the system the phone needs to work.';
  return null;
}

export class RefusedError extends Error {}

/**
 * The last check before a command that changes a package is sent. Every path that changes the
 * phone goes through here, so a bad list entry or a hand-edited plan cannot reach an essential
 * package.
 */
export function assertChangeable(pkg: string, dynamicProtected: ReadonlyMap<string, string> = new Map()): void {
  if (!isPackageName(pkg)) throw new RefusedError(`Not a package name: ${JSON.stringify(pkg)}`);
  const why = essentialReason(pkg) ?? dynamicProtected.get(pkg) ?? null;
  if (why) throw new RefusedError(`${pkg} is protected: ${why}`);
}
