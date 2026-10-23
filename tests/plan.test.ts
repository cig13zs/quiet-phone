import { describe, expect, it } from 'vitest';
import { brandById, buildPlan, defaultSelection, describeCount, detectBrand, findCandidates, readPackages, readPhone, readProtected } from '../src/core';
import { FakeDevice } from '../src/core/fake-device';
import { fakeProfile } from '../src/core/fake-profiles';

async function setup(id = 'xiaomi') {
  const dev = new FakeDevice(fakeProfile(id));
  const phone = await readPhone(dev);
  const states = await readPackages(dev);
  const prot = await readProtected(dev);
  const brand = detectBrand(phone)!;
  return { dev, phone, states, prot, brand, cands: findCandidates(brand, states, prot) };
}

describe('reading the phone', () => {
  it('reads the name, OS and brand', async () => {
    const { phone, brand } = await setup();
    expect(phone.name).toBe('Redmi Note 13');
    expect(phone.os).toBe('HyperOS 2.0');
    expect(phone.android).toBe('15');
    expect(brand.id).toBe('xiaomi');
  });

  it('detects every demo brand', async () => {
    expect((await setup('samsung')).brand.id).toBe('samsung');
    expect((await setup('realme')).brand.id).toBe('realme');
    expect((await setup('infinix')).brand.id).toBe('transsion');
    expect(detectBrand({ brand: 'poco', manufacturer: 'xiaomi' })?.id).toBe('xiaomi');
    expect(detectBrand({ brand: 'tecno', manufacturer: 'tecno mobile limited' })?.id).toBe('transsion');
    expect(detectBrand({ brand: 'google', manufacturer: 'google' })).toBeUndefined();
  });

  it('lists package states, including removed-for-user', async () => {
    const dev = new FakeDevice({ ...fakeProfile('xiaomi'), packages: { 'com.a.b': 'enabled', 'com.c.d': 'disabled', 'com.e.f': 'removed' } });
    const states = await readPackages(dev);
    expect(Object.fromEntries(states)).toEqual({ 'com.a.b': 'enabled', 'com.c.d': 'disabled', 'com.e.f': 'removed' });
  });

  it('protects the launcher, keyboards, dialer and SMS app in use', async () => {
    const { prot } = await setup('infinix');
    expect(prot.get('com.transsion.XOSLauncher')).toMatch(/home screen/);
    expect(prot.get('com.facemoji.lite.transsion')).toMatch(/keyboard/);
    expect(prot.get('com.google.android.dialer')).toMatch(/phone app/);
    expect(prot.get('com.google.android.apps.messaging')).toMatch(/messages/);
  });
});

describe('plan building', () => {
  it('finds only listed packages that are on the phone', async () => {
    const { cands, states } = await setup();
    expect(cands.length).toBeGreaterThan(10);
    for (const c of cands) expect(states.has(c.pkg)).toBe(true);
    expect(cands.find((c) => c.pkg === 'com.miui.home')).toBeUndefined();
  });

  it('picks the 9 safe ad services on the demo Redmi', async () => {
    const { cands } = await setup();
    const sel = defaultSelection(cands);
    expect(sel.size).toBe(9);
    const plan = buildPlan(cands, sel);
    expect(plan.actions.map((a) => a.risk)).toEqual(Array(9).fill('safe'));
    expect(describeCount(plan.actions.map((a) => a.category))).toBe('9 ad services');
    expect(plan.actions[0].category).toBe('lockscreen');
  });

  it('refuses essential, unlisted and dynamically protected packages', async () => {
    const { cands } = await setup('infinix');
    const plan = buildPlan(cands, ['com.android.systemui', 'com.google.android.gms', 'com.example.random', 'com.hoffnung', 'com.facemoji.lite.transsion', 'not a pkg; reboot']);
    expect(plan.actions).toEqual([]);
    expect(plan.skipped.map((s) => s.why)).toEqual([
      expect.stringMatching(/^Protected/), expect.stringMatching(/^Protected/), 'Not on the lists for this phone.',
      expect.stringMatching(/^Protected/), expect.stringMatching(/^Protected/), expect.stringMatching(/^Protected/),
    ]);
  });

  it('marks a listed package protected when it is the keyboard in use', async () => {
    const dev = new FakeDevice({ ...fakeProfile('xiaomi'), keyboards: ['com.miui.hybrid'] });
    const prot = await readProtected(dev);
    const cands = findCandidates(brandById('xiaomi')!, await readPackages(dev), prot);
    const c = cands.find((x) => x.pkg === 'com.miui.hybrid')!;
    expect(c.protectedWhy).toMatch(/keyboard/);
    expect(defaultSelection(cands).has('com.miui.hybrid')).toBe(false);
    expect(buildPlan(cands, ['com.miui.hybrid']).actions).toEqual([]);
  });

  it('needs expert mode for expert items and skips ones already off', async () => {
    const { cands } = await setup();
    expect(buildPlan(cands, ['com.xiaomi.joyose']).actions).toEqual([]);
    expect(buildPlan(cands, ['com.xiaomi.joyose'], { expert: true }).actions.map((a) => a.pkg)).toEqual(['com.xiaomi.joyose']);
    const off = cands.map((c) => (c.pkg === 'com.miui.msa.global' ? { ...c, state: 'disabled' as const } : c));
    expect(buildPlan(off, ['com.miui.msa.global']).skipped[0].why).toBe('Already off.');
  });

  it('matches brand-specific Glance builds by pattern', async () => {
    const dev = new FakeDevice({ ...fakeProfile('realme'), packages: { ...fakeProfile('realme').packages, 'com.glance.lockscreenexample': 'enabled' } });
    const cands = findCandidates(brandById('realme')!, await readPackages(dev));
    expect(cands.find((c) => c.pkg === 'com.glance.lockscreenexample')).toMatchObject({ category: 'lockscreen', risk: 'safe' });
  });

  it('describes mixed selections plainly', () => {
    expect(describeCount(['ads', 'junk'])).toBe('2 apps and services');
    expect(describeCount(['lockscreen'])).toBe('1 ad service');
  });
});
