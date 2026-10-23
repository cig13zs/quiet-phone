import { describe, expect, it } from 'vitest';
import { BRANDS, ESSENTIALS, LISTS, essentialReason, isPackageName, RISKS, CATEGORIES } from '../src/core';
import fs from 'node:fs';
import path from 'node:path';

describe('package lists', () => {
  const all = Object.values(LISTS);

  it('every list file in data/lists is loaded', () => {
    const files = fs.readdirSync(path.join(__dirname, '..', 'data', 'lists')).map((f) => f.replace(/\.json$/, ''));
    expect(Object.keys(LISTS).sort()).toEqual(files.sort());
  });

  for (const list of all) {
    describe(list.id, () => {
      it('has well-formed entries', () => {
        for (const e of list.packages) {
          expect(Boolean(e.id) !== Boolean(e.pattern), `${e.label}: exactly one of id or pattern`).toBe(true);
          if (e.id) expect(isPackageName(e.id), e.id).toBe(true);
          if (e.pattern) expect(() => new RegExp(e.pattern!)).not.toThrow();
          if (e.pattern) expect(e.pattern.startsWith('^'), 'patterns are anchored').toBe(true);
          expect(RISKS).toContain(e.risk);
          expect(CATEGORIES).toContain(e.category);
          expect(e.label.length).toBeGreaterThan(1);
          expect(e.reason.length, `${e.id ?? e.pattern} reason length`).toBeLessThanOrEqual(110);
          expect(e.reason).toMatch(/\.$/);
          expect(e.sources.length, `${e.id ?? e.pattern} needs a source`).toBeGreaterThan(0);
          for (const s of e.sources) expect(s).toMatch(/^https?:\/\/\S+$/);
        }
      });

      it('has no duplicates', () => {
        const ids = list.packages.map((e) => e.id ?? e.pattern);
        expect(new Set(ids).size).toBe(ids.length);
      });

      it('never lists an essential package', () => {
        for (const e of list.packages) if (e.id) expect(essentialReason(e.id), e.id).toBeNull();
      });
    });
  }

  it('no pattern can reach an essential package', () => {
    for (const list of all) {
      for (const e of list.packages) {
        if (!e.pattern) continue;
        const re = new RegExp(e.pattern);
        for (const ess of ESSENTIALS.exact) expect(re.test(ess), `${e.pattern} matches ${ess}`).toBe(false);
      }
    }
  });

  it('every brand names lists that exist and has onboarding and settings steps', () => {
    expect(BRANDS.length).toBeGreaterThanOrEqual(9);
    for (const b of BRANDS) {
      for (const l of b.lists) expect(LISTS[l], `${b.id} -> ${l}`).toBeDefined();
      expect(b.devOptions.length).toBeGreaterThanOrEqual(3);
      expect(b.settings.length).toBeGreaterThanOrEqual(2);
      expect(b.match.length).toBeGreaterThan(0);
    }
  });
});

describe('essential denylist', () => {
  it('covers the system, Play services, keyboards and financing locks', () => {
    for (const p of ['android', 'com.android.systemui', 'com.google.android.gms', 'com.android.vending', 'com.android.phone',
      'com.android.providers.media', 'com.android.inputmethod.latin', 'com.samsung.android.kgclient', 'com.payjoy.access',
      'com.google.android.devicelockcontroller', 'com.miui.home', 'com.hoffnung']) {
      expect(essentialReason(p), p).not.toBeNull();
    }
  });

  it('leaves ordinary packages alone', () => {
    expect(essentialReason('com.miui.msa.global')).toBeNull();
    expect(essentialReason('com.android.chrome')).toBeNull();
  });
});
