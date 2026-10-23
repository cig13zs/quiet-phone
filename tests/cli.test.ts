import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AdbDevice, listDevices } from '../src/cli/adb-device';
import { Session, memoryStore, PHONE_RESTORE_PATH } from '../src/core';
import { fakeProfile } from '../src/core/fake-profiles';

const ADB = path.join(__dirname, 'fixtures', 'fake-adb.mjs');
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-adb-'));
  const p = fakeProfile('xiaomi');
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({
    serial: 'ABC123', model: 'Redmi_Note_13', props: p.props, packages: p.packages, launcher: p.launcher,
    keyboard: p.keyboards[0], files: {}, blockDisable: ['com.miui.msa.global'],
  }));
  process.env.FAKE_ADB_STATE = path.join(dir, 'state.json');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const state = () => JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));

// The stand-in adb is a script with a shebang, which Windows can't run directly.
describe.skipIf(process.platform === 'win32')('local adb device', () => {
  it('lists devices', async () => {
    expect(await listDevices(ADB)).toEqual([{ serial: 'ABC123', state: 'device', model: 'Redmi_Note_13' }]);
  });

  it('runs the same plan through adb, with the fallback, and restores it', async () => {
    const s = new Session(new AdbDevice('ABC123', ADB), memoryStore());
    await s.load();
    expect(s.phone.name).toBe('Redmi Note 13');
    const results = await s.apply(s.plan(s.defaultSelection()));
    expect(results.filter((r) => r.ok)).toHaveLength(9);
    expect(results.find((r) => r.pkg === 'com.miui.msa.global')?.method).toBe('uninstall');
    expect(state().packages['com.miui.msa.global']).toBe('removed');
    expect(state().packages['com.miui.analytics']).toBe('disabled');
    expect(JSON.parse(state().files[PHONE_RESTORE_PATH]).entries).toHaveLength(9);

    const again = new Session(new AdbDevice('ABC123', ADB), memoryStore());
    await again.load();
    expect(again.journal.entries).toHaveLength(9);
    await again.restore();
    expect(state().packages['com.miui.msa.global']).toBe('enabled');
    expect(state().packages['com.miui.analytics']).toBe('enabled');
  }, 30000);

  it('refuses unsafe arguments before calling adb', async () => {
    await expect(new AdbDevice('ABC123', ADB).shell(['pm', 'disable-user', 'x; reboot'])).rejects.toThrow(/unsafe/);
  });

  it('explains a missing adb', async () => {
    await expect(listDevices('/nonexistent/adb')).rejects.toThrow(/Can't find adb/);
  });
});
