// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { mountApp } from '../src/web/app';
import { FakeDevice } from '../src/core/fake-device';
import { fakeProfile } from '../src/core/fake-profiles';
import { memoryStore } from '../src/core/session';
import { parseJournal } from '../src/core/journal';

async function until(fn: () => unknown, ms = 3000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

function setup(profile = 'xiaomi', extra: Partial<ReturnType<typeof fakeProfile>> = {}) {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  const dev = new FakeDevice({ ...fakeProfile(profile), ...extra });
  const downloads: { name: string; text: string }[] = [];
  const confirms: string[] = [];
  const app = mountApp(root, {
    supported: true,
    store: memoryStore(),
    connect: async (ask) => {
      ask();
      return dev;
    },
    download: (name, text) => downloads.push({ name, text }),
    confirm: (m) => (confirms.push(m), true),
  });
  const stage = () => root.querySelector<HTMLElement>('[data-stage]')?.dataset.stage;
  const click = (sel: string) => root.querySelector<HTMLElement>(sel)!.click();
  return { root, dev, app, stage, click, downloads, confirms };
}

describe('web app against a fake phone', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('starts on the intro with per-brand setup steps', () => {
    const { root, click } = setup();
    expect(root.textContent).toContain("Turn off your phone's lock-screen ads.");
    click('[data-brand=samsung]');
    expect(root.querySelector('#ready')!.textContent).toContain('Software information');
    click('[data-brand=transsion]');
    expect(root.querySelector('#ready')!.textContent).toContain('Settings › System › Developer options');
  });

  it('connects, detects the brand, previews 9, applies, and says so', async () => {
    const t = setup();
    t.click('[data-act=connect]');
    await until(() => t.stage() === 'ready');
    expect(t.root.querySelector('.phone .nm')!.textContent).toBe('Redmi Note 13');
    expect(t.root.querySelector('[data-brand=xiaomi]')!.getAttribute('aria-pressed')).toBe('true');
    expect(t.root.querySelectorAll('input[data-pkg]:checked')).toHaveLength(9);
    expect(t.root.querySelector('[data-act=apply]')!.textContent).toContain('Turn off 9');
    expect(t.dev.log.some((c) => c.startsWith('pm disable'))).toBe(false);

    t.click('[data-act=apply]');
    await until(() => t.stage() === 'done');
    expect(t.root.querySelector('.done h2')!.textContent).toBe('Done. 9 ad services off.');
    expect(t.root.textContent).toContain('Restore anytime.');
    expect(t.confirms).toEqual([]);
    expect(t.root.textContent).toContain('Some ads are settings, not apps');

    t.click('.done [data-act=export]');
    expect(t.downloads[0].name).toMatch(/^quiet-phone-restore-redmi-note-13-\d{4}-\d\d-\d\d\.json$/);
    expect(parseJournal(t.downloads[0].text).entries).toHaveLength(9);

    t.click('.done [data-act=restore]');
    await until(() => t.stage() === 'restored');
    expect(t.root.textContent).toContain('Everything is back.');
    expect(t.dev.state('com.miui.msa.global')).toBe('enabled');
  });

  it('asks before turning off a caution item and keeps protected rows locked', async () => {
    const t = setup('xiaomi', { keyboards: ['com.miui.hybrid'] });
    t.click('[data-act=connect]');
    await until(() => t.stage() === 'ready');
    const hybrid = t.root.querySelector<HTMLInputElement>('input[data-pkg="com.miui.hybrid"]')!;
    expect(hybrid.disabled).toBe(true);
    expect(hybrid.closest('.pkg')!.textContent).toContain('Kept on: A keyboard you have turned on.');
    const daemon = t.root.querySelector<HTMLInputElement>('input[data-pkg="com.miui.daemon"]')!;
    daemon.checked = true;
    daemon.dispatchEvent(new Event('change', { bubbles: true }));
    expect(t.root.querySelector('[data-act=apply]')!.textContent).toContain('Turn off 9');
    t.click('[data-act=apply]');
    await until(() => t.stage() === 'done');
    expect(t.confirms[0]).toContain('MIUI Daemon');
    expect(t.dev.state('com.miui.daemon')).toBe('disabled');
    expect(t.dev.state('com.miui.hybrid')).toBe('enabled');
    expect(t.root.querySelector('.done h2')!.textContent).toBe('Done. 9 ad services off.');
  });

  it('hides expert items until expert mode is on', async () => {
    const t = setup();
    t.click('[data-act=connect]');
    await until(() => t.stage() === 'ready');
    expect(t.root.querySelector('input[data-pkg="com.xiaomi.joyose"]')).toBeNull();
    const ex = t.root.querySelector<HTMLInputElement>('input[data-opt=expert]')!;
    ex.checked = true;
    ex.dispatchEvent(new Event('change', { bubbles: true }));
    expect(t.root.querySelector('input[data-pkg="com.xiaomi.joyose"]')).not.toBeNull();
  });

  it('shows a clear message when the phone is busy in another ADB tool', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    mountApp(root, {
      supported: true,
      store: memoryStore(),
      connect: async () => {
        throw Object.assign(new Error('busy'), { kind: 'busy' });
      },
    });
    root.querySelector<HTMLElement>('[data-act=connect]')!.click();
    await until(() => root.textContent!.includes('Another program is using the phone'));
    expect(root.textContent).toContain('adb kill-server');
  });

  it('tells Firefox and Safari users what to use instead', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    mountApp(root, { supported: false, store: memoryStore(), connect: async () => { throw new Error('no'); } });
    expect(root.querySelector('[data-act=connect]')).toBeNull();
    expect(root.textContent).toContain("Firefox and Safari don't support WebUSB");
  });
});
