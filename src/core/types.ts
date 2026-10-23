export type Risk = 'safe' | 'caution' | 'expert';
export type Category = 'lockscreen' | 'ads' | 'promo' | 'junk' | 'ai';

/** One row of a package list. Exactly one of `id` or `pattern` is set. */
export interface ListEntry {
  id?: string;
  pattern?: string;
  label: string;
  category: Category;
  risk: Risk;
  reason: string;
  sources: string[];
}

export interface PackageList {
  id: string;
  name: string;
  packages: ListEntry[];
}

export interface SettingsTip {
  title: string;
  steps: string[];
}

export interface Brand {
  id: string;
  name: string;
  sub: string;
  match: string[];
  lists: string[];
  devOptions: string[];
  settings: SettingsTip[];
}

export interface Essentials {
  exact: string[];
  prefixes: string[];
  notes: Record<string, string>;
}

/** What the phone says about a package, for user 0. */
export type PkgState = 'enabled' | 'disabled' | 'removed';

export const RISKS: Risk[] = ['safe', 'caution', 'expert'];
export const CATEGORIES: Category[] = ['lockscreen', 'ads', 'promo', 'junk', 'ai'];

export const CATEGORY_NAMES: Record<Category, string> = {
  lockscreen: 'Lock-screen ads',
  ads: 'Ad and tracking services',
  promo: 'Sponsored apps and promos',
  junk: 'Preinstalled extras',
  ai: 'AI apps',
};

/** Categories that count as "ad services" in the summary line. */
export const AD_CATEGORIES: Category[] = ['lockscreen', 'ads', 'promo'];
