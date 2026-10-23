import type { Brand, Category, ListEntry, PkgState, Risk } from './types';
import { AD_CATEGORIES, CATEGORIES } from './types';
import { listsFor } from './data';
import { essentialReason, isPackageName } from './safety';

/** A listed package that is on this phone. */
export interface Candidate {
  pkg: string;
  label: string;
  category: Category;
  risk: Risk;
  reason: string;
  sources: string[];
  list: string;
  state: PkgState;
  /** Set when the package must never be changed; the UI shows it greyed out with this reason. */
  protectedWhy: string | null;
}

export interface PlanAction {
  pkg: string;
  label: string;
  category: Category;
  risk: Risk;
  reason: string;
}

export interface Plan {
  actions: PlanAction[];
  skipped: { pkg: string; why: string }[];
}

export interface PlanOptions {
  /** Expert-level packages need this on, as well as being picked. */
  expert?: boolean;
}

function matchEntry(entry: ListEntry, pkg: string): boolean {
  if (entry.id) return entry.id === pkg;
  if (entry.pattern) return new RegExp(entry.pattern).test(pkg);
  return false;
}

/** Everything on the brand's lists that this phone has, in list order, each package once. */
export function findCandidates(
  brand: Brand,
  states: ReadonlyMap<string, PkgState>,
  dynamicProtected: ReadonlyMap<string, string> = new Map(),
): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  const installed = [...states.keys()].sort();
  for (const list of listsFor(brand)) {
    for (const entry of list.packages) {
      const pkgs = entry.id ? (states.has(entry.id) ? [entry.id] : []) : installed.filter((p) => matchEntry(entry, p));
      for (const pkg of pkgs) {
        if (seen.has(pkg) || !isPackageName(pkg)) continue;
        seen.add(pkg);
        out.push({
          pkg,
          label: entry.label,
          category: entry.category,
          risk: entry.risk,
          reason: entry.reason,
          sources: entry.sources,
          list: list.id,
          state: states.get(pkg)!,
          protectedWhy: essentialReason(pkg) ?? dynamicProtected.get(pkg) ?? null,
        });
      }
    }
  }
  const order = (c: Candidate) => CATEGORIES.indexOf(c.category) * 10 + ['safe', 'caution', 'expert'].indexOf(c.risk);
  return out.sort((a, b) => order(a) - order(b));
}

/** The one-button choice: every safe package that is still on. */
export function defaultSelection(cands: readonly Candidate[]): Set<string> {
  return new Set(cands.filter((c) => c.risk === 'safe' && c.state === 'enabled' && !c.protectedWhy).map((c) => c.pkg));
}

/**
 * Turns a selection into the list of changes. Only listed, present, switched-on, unprotected
 * packages get through; everything else lands in `skipped` with the reason.
 */
export function buildPlan(cands: readonly Candidate[], selection: Iterable<string>, opts: PlanOptions = {}): Plan {
  const byPkg = new Map(cands.map((c) => [c.pkg, c]));
  const plan: Plan = { actions: [], skipped: [] };
  for (const pkg of new Set(selection)) {
    const c = byPkg.get(pkg);
    const ess = isPackageName(pkg) ? essentialReason(pkg) : 'Not a package name.';
    if (ess) plan.skipped.push({ pkg, why: `Protected: ${ess}` });
    else if (!c) plan.skipped.push({ pkg, why: 'Not on the lists for this phone.' });
    else if (c.protectedWhy) plan.skipped.push({ pkg, why: `Protected: ${c.protectedWhy}` });
    else if (c.state !== 'enabled') plan.skipped.push({ pkg, why: 'Already off.' });
    else if (c.risk === 'expert' && !opts.expert) plan.skipped.push({ pkg, why: 'Expert item; turn on expert mode to include it.' });
    else plan.actions.push({ pkg, label: c.label, category: c.category, risk: c.risk, reason: c.reason });
  }
  const order = new Map(cands.map((c, i) => [c.pkg, i]));
  plan.actions.sort((a, b) => order.get(a.pkg)! - order.get(b.pkg)!);
  return plan;
}

/** "9 ad services" when everything is ad-related, otherwise "9 apps and services". */
export function describeCount(categories: readonly Category[]): string {
  const n = categories.length;
  const allAds = n > 0 && categories.every((c) => AD_CATEGORIES.includes(c));
  if (allAds) return `${n} ad service${n === 1 ? '' : 's'}`;
  return `${n} app${n === 1 ? '' : 's'} and service${n === 1 ? '' : 's'}`;
}
