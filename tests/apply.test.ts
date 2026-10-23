import { describe, expect, it } from 'vitest';
import { applyPlan, buildPlan, emptyJournal, findCandidates, brandById, readPackages, restore, RefusedError, Session, memoryStore, PHONE_RESTORE_PATH, parseJournal, serializeJournal } from '../src/core';
import { FakeDevice } from '../src/core/fake-device';
import { fakeProfile } from '../src/core/fake-profiles';

const J = () => emptyJournal({ serial: 'DEMO-REDMI-NOTE-13', brand: 'redmi', model: 'Redmi Note 13' });

describe('applying a plan', () => {
  it('disables each package for user 0 and records it', async () => {
    const dev = new FakeDevice(fakeProfile('xiaomi'));
    const cands = findCandidates(brandById('xiaomi')!, await readPackages(dev));
    const plan = buildPlan(cands, ['com.miui.msa.global', 'com.miui.android.fashiongallery']);
    const { journal, results } = await applyPlan(dev, plan, J());
    expect(results.every((r) => r.ok && r.method === 'disable')).toBe(true);
    expect(dev.state('com.miui.msa.global')).toBe('disabled');
    expect(journal.entries.map((e) => [e.pkg, e.method])).toEqual([
      ['com.miui.android.fashiongallery', 'disable'],
      ['com.miui.msa.global', 'disable'],
    ]);
    expect(dev.log).toContain('pm disable-user --user 0 com.miui.msa.global');
    expect(dev.log.some((c) => c.startsWith('pm uninstall'))).toBe(false);
  });

  it('falls back to remove-for-user only when disabling is blocked, and says so', async () => {
    const dev = new FakeDevice({ ...fakeProfile('xiaomi'), blockDisable: ['com.miui.msa.global'] });
    const cands = findCandidates(brandById('xiaomi')!, await readPackages(dev));
    const { journal, results } = await applyPlan(dev, buildPlan(cands, ['com.miui.msa.global']), J());
    expect(results[0]).toMatchObject({ ok: true, method: 'uninstall' });
    expect(results[0].message).toMatch(/Removed for your user/);
    expect(dev.state('com.miui.msa.global')).toBe('removed');
    expect(journal.entries[0].method).toBe('uninstall');
    expect(dev.log).toContain('pm uninstall -k --user 0 com.miui.msa.global');
  });

  it('reports a refusal and drops the record when the fallback is off', async () => {
    const dev = new FakeDevice({ ...fakeProfile('xiaomi'), blockDisable: ['com.miui.msa.global'] });
    const cands = findCandidates(brandById('xiaomi')!, await readPackages(dev));
    const { journal, results } = await applyPlan(dev, buildPlan(cands, ['com.miui.msa.global']), J(), { allowUninstall: false });
    expect(results[0].ok).toBe(false);
    expect(results[0].message).toMatch(/SecurityException|Exception/);
    expect(journal.entries).toEqual([]);
    expect(dev.state('com.miui.msa.global')).toBe('enabled');
  });

  it('refuses a hand-made plan that names an essential package, before sending anything', async () => {
    const dev = new FakeDevice(fakeProfile('xiaomi'));
    const bad = { actions: [{ pkg: 'com.android.systemui', label: 'x', category: 'ads' as const, risk: 'safe' as const, reason: 'x.' }], skipped: [] };
    await expect(applyPlan(dev, bad, J())).rejects.toBeInstanceOf(RefusedError);
    expect(dev.log.some((c) => c.includes('disable'))).toBe(false);
    const prot = new Map([['com.miui.hybrid', 'A keyboard you have turned on.']]);
    const bad2 = { actions: [{ ...bad.actions[0], pkg: 'com.miui.hybrid' }], skipped: [] };
    await expect(applyPlan(dev, bad2, J(), { dynamicProtected: prot })).rejects.toThrow(/protected/);
  });

  it('records each change before sending it, so a pulled cable still leaves a usable record', async () => {
    const dev = new FakeDevice(fakeProfile('xiaomi'), { disconnectAt: 8 });
    const cands = findCandidates(brandById('xiaomi')!, await readPackages(dev));
    const plan = buildPlan(cands, ['com.miui.msa.global', 'com.miui.analytics', 'com.miui.hybrid']);
    let saved = J();
    await expect(applyPlan(dev, plan, J(), { onJournal: (j) => void (saved = j) })).rejects.toThrow(/disconnected/);
    expect(dev.state('com.miui.analytics')).toBe('disabled');
    const changed = ['com.miui.msa.global', 'com.miui.analytics', 'com.miui.hybrid'].filter((p) => dev.state(p) !== 'enabled');
    for (const p of changed) expect(saved.entries.map((e) => e.pkg)).toContain(p);
  });
});

describe('restore', () => {
  it('puts back disabled and removed packages and empties the journal', async () => {
    const dev = new FakeDevice({ ...fakeProfile('xiaomi'), blockDisable: ['com.miui.msa.global'] });
    const cands = findCandidates(brandById('xiaomi')!, await readPackages(dev));
    const plan = buildPlan(cands, ['com.miui.msa.global', 'com.miui.analytics', 'com.facebook.system']);
    const applied = await applyPlan(dev, plan, J());
    expect(applied.journal.entries).toHaveLength(3);
    const { journal, results } = await restore(dev, applied.journal);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(journal.entries).toEqual([]);
    for (const p of ['com.miui.msa.global', 'com.miui.analytics', 'com.facebook.system']) expect(dev.state(p)).toBe('enabled');
    expect(dev.log).toContain('cmd package install-existing --user 0 com.miui.msa.global');
    expect(dev.log).toContain('pm enable --user 0 com.miui.analytics');
  });

  it('is safe to run twice and handles packages the phone no longer has', async () => {
    const dev = new FakeDevice(fakeProfile('xiaomi'));
    const j = { ...J(), entries: [{ pkg: 'com.miui.analytics', method: 'disable' as const, label: 'A', at: '' }, { pkg: 'com.gone.app', method: 'disable' as const, label: 'G', at: '' }] };
    const r1 = await restore(dev, j);
    expect(r1.results.map((r) => r.message)).toEqual(['Not on this phone, nothing to put back', 'Back on']);
    expect(r1.journal.entries).toEqual([]);
    const r2 = await restore(dev, j);
    expect(r2.results.every((r) => r.ok)).toBe(true);
  });

  it('can restore just some packages', async () => {
    const dev = new FakeDevice(fakeProfile('xiaomi'));
    const cands = findCandidates(brandById('xiaomi')!, await readPackages(dev));
    const applied = await applyPlan(dev, buildPlan(cands, ['com.miui.analytics', 'com.miui.hybrid']), J());
    const { journal } = await restore(dev, applied.journal, { only: ['com.miui.hybrid'] });
    expect(journal.entries.map((e) => e.pkg)).toEqual(['com.miui.analytics']);
    expect(dev.state('com.miui.hybrid')).toBe('enabled');
    expect(dev.state('com.miui.analytics')).toBe('disabled');
  });
});

describe('session', () => {
  it('runs the one-button flow end to end and keeps restore copies locally and on the phone', async () => {
    const dev = new FakeDevice(fakeProfile('xiaomi'));
    const store = memoryStore();
    const s = new Session(dev, store);
    await s.load();
    expect(s.brand?.id).toBe('xiaomi');
    const plan = s.plan(s.defaultSelection());
    const results = await s.apply(plan);
    expect(results.filter((r) => r.ok)).toHaveLength(9);
    expect(store.data.get(dev.serial)?.entries).toHaveLength(9);
    expect(parseJournal(dev.files.get(PHONE_RESTORE_PATH)!).entries).toHaveLength(9);
    expect(s.candidates.filter((c) => c.state === 'disabled')).toHaveLength(9);

    // A new computer, nothing stored locally: the copy on the phone is enough to undo everything.
    const s2 = new Session(dev, memoryStore());
    await s2.load();
    expect(s2.journal.entries).toHaveLength(9);
    await s2.restore();
    expect(s2.journal.entries).toHaveLength(0);
    expect(s2.candidates.filter((c) => c.state === 'disabled')).toHaveLength(0);
  });

  it('notices packages that an update switched back on and picks them again', async () => {
    const dev = new FakeDevice(fakeProfile('xiaomi'));
    const store = memoryStore();
    const s = new Session(dev, store);
    await s.load();
    await s.apply(s.plan(['com.miui.daemon']));
    await dev.shell(['pm', 'enable', '--user', '0', 'com.miui.daemon']);
    const again = new Session(dev, store);
    await again.load();
    expect(again.cameBack).toEqual(['com.miui.daemon']);
    expect(again.defaultSelection().has('com.miui.daemon')).toBe(true);
  });

  it('imports a restore file and can undo from it', async () => {
    const dev = new FakeDevice(fakeProfile('xiaomi'));
    const s = new Session(dev, memoryStore());
    await s.load();
    await s.apply(s.plan(['com.miui.analytics']));
    const exported = s.exportJournal();
    dev.files.clear();
    const fresh = new Session(dev, memoryStore());
    await fresh.load();
    expect(fresh.journal.entries).toHaveLength(0);
    expect(await fresh.importJournal(exported)).toBe(1);
    await fresh.restore();
    expect(dev.state('com.miui.analytics')).toBe('enabled');
  });
});

describe('restore file', () => {
  it('round-trips', () => {
    const j = { ...J(), updatedAt: '2026-10-23T10:00:00.000Z', entries: [{ pkg: 'com.miui.msa.global', method: 'uninstall' as const, label: 'MSA', at: '2026-10-23T10:00:00.000Z' }] };
    expect(parseJournal(serializeJournal(j))).toEqual(j);
  });

  it('rejects files that are not restore files or carry bad package names', () => {
    expect(() => parseJournal('nope')).toThrow(/isn't JSON/);
    expect(() => parseJournal('{"format":"other"}')).toThrow(/isn't a Quiet Phone/);
    expect(() => parseJournal('{"format":"quiet-phone-restore","version":2,"entries":[]}')).toThrow(/newer/);
    expect(() => parseJournal('{"format":"quiet-phone-restore","version":1,"entries":[{"pkg":"a; reboot"}]}')).toThrow(/bad package name/);
  });
});
