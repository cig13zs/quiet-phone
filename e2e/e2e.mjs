// End-to-end test of the built site (dist/), served the way GitHub Pages serves it, driven in
// Chromium against the demo phone. Then a smoke test of the built CLI against a stand-in adb.
// Run `npm run build` first.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serve } from './serve.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = await serve();
const browser = await chromium.launch();
let passed = 0;
const step = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
};

async function page(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, acceptDownloads: true, ...opts });
  const p = await ctx.newPage();
  const outside = [];
  const errors = [];
  p.on('request', (r) => {
    if (!r.url().startsWith(site.url) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) outside.push(r.url());
  });
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return { ctx, p, outside, errors };
}

try {
  await step('landing page loads with no outside requests and offers Connect', async () => {
    const { ctx, p, outside, errors } = await page();
    await p.goto(site.url);
    await p.getByRole('heading', { name: "Turn off your phone's lock-screen ads." }).waitFor();
    assert.ok(await p.locator('[data-act=connect]').isVisible());
    await p.locator('[data-brand=transsion]').click();
    assert.match(await p.locator('#ready').innerText(), /Settings › System › Developer options/);
    await p.waitForLoadState('networkidle');
    assert.deepEqual(outside, []);
    assert.deepEqual(errors, []);
    const csp = await p.locator('meta[http-equiv=Content-Security-Policy]').getAttribute('content');
    assert.match(csp, /connect-src 'self'/);
    await ctx.close();
  });

  await step('full demo flow: connect, detect, preview, apply, save restore file, restore', async () => {
    const { ctx, p, outside, errors } = await page();
    await p.goto(`${site.url}?demo=xiaomi&latency=5`);
    await p.locator('[data-act=connect]').click();
    await p.getByRole('heading', { name: 'Check your phone' }).waitFor();
    await p.locator('[data-stage=ready]').waitFor({ timeout: 10000 });
    assert.equal(await p.locator('.phone .nm').innerText(), 'Redmi Note 13');
    assert.equal(await p.locator('[data-brand=xiaomi]').getAttribute('aria-pressed'), 'true');
    assert.equal(await p.locator('input[data-pkg]:checked').count(), 9);
    assert.equal((await p.locator('[data-act=apply]').innerText()).trim(), 'Turn off 9');

    // Picking another brand swaps the list; picking Xiaomi again brings it back.
    await p.locator('[data-brand=samsung]').click();
    assert.equal(await p.locator('input[data-pkg="com.miui.msa.global"]').count(), 0);
    await p.locator('[data-brand=xiaomi]').click();
    assert.equal(await p.locator('input[data-pkg]:checked').count(), 9);

    // Untick one, tick it again.
    await p.locator('.pkg:has(input[data-pkg="com.miui.analytics"]) label.check').click();
    assert.equal((await p.locator('[data-act=apply]').innerText()).trim(), 'Turn off 8');
    await p.locator('.pkg:has(input[data-pkg="com.miui.analytics"]) label.check').click();

    await p.locator('[data-act=apply]').click();
    await p.locator('[data-stage=done]').waitFor({ timeout: 15000 });
    assert.equal(await p.locator('.done h2').innerText(), 'Done. 9 ad services off.');
    assert.match(await p.locator('.done').innerText(), /Restore anytime\./);

    const [dl] = await Promise.all([p.waitForEvent('download'), p.locator('.done [data-act=export]').click()]);
    const file = path.join(os.tmpdir(), `qp-e2e-${process.pid}.json`);
    await dl.saveAs(file);
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.rmSync(file);
    assert.equal(saved.format, 'quiet-phone-restore');
    assert.equal(saved.entries.length, 9);

    await p.locator('[data-act=back]').click();
    assert.equal(await p.locator('.chip.off').count(), 9);
    assert.match(await p.locator('.notice').first().innerText(), /9 changes from before/);
    await p.locator('.notice [data-act=restore]').click();
    await p.locator('[data-stage=restored]').waitFor({ timeout: 15000 });
    assert.match(await p.locator('.done').innerText(), /Everything is back\.\s+9 apps are on again/);
    assert.deepEqual(outside, []);
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  await step('protected and expert items stay out of the one-button plan (Infinix demo)', async () => {
    const { ctx, p } = await page();
    await p.goto(`${site.url}?demo=infinix&latency=1`);
    await p.locator('[data-act=connect]').click();
    await p.locator('[data-stage=ready]').waitFor({ timeout: 10000 });
    assert.equal(await p.locator('[data-brand=transsion]').getAttribute('aria-pressed'), 'true');
    assert.equal(await p.locator('input[data-pkg="com.hoffnung"]').count(), 0, 'essential packages are never even listed');
    assert.equal(await p.locator('input[data-pkg="com.transsion.trancare"]').count(), 0);
    assert.ok(await p.locator('input[data-pkg="com.transsion.magazineservice.xos"]').isChecked());
    await ctx.close();
  });

  await step('browsers without WebUSB get a clear message instead of a dead button', async () => {
    const { ctx, p } = await page();
    await p.addInitScript(() => Object.defineProperty(Navigator.prototype, 'usb', { get: () => undefined }));
    await p.goto(site.url);
    assert.equal(await p.locator('[data-act=connect]').count(), 0);
    assert.match(await p.locator('.notice').innerText(), /Firefox and Safari don't support WebUSB/);
    await ctx.close();
  });

  await step('phone-width layout has no sideways scroll', async () => {
    const { ctx, p } = await page({ viewport: { width: 360, height: 780 } });
    await p.goto(`${site.url}?demo=samsung&latency=1`);
    const wide = () => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok((await wide()) <= 0, 'intro');
    await p.locator('[data-act=connect]').click();
    await p.locator('[data-stage=ready]').waitFor({ timeout: 10000 });
    assert.ok((await wide()) <= 0, 'list');
    await ctx.close();
  });

  await step('CLI: scan, apply and restore through a stand-in adb', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-cli-'));
    const statePath = path.join(dir, 'state.json');
    const profile = { serial: 'E2E1', model: 'Redmi_Note_13', props: { 'ro.product.brand': 'Redmi', 'ro.product.manufacturer': 'Xiaomi', 'ro.product.marketname': 'Redmi Note 13', 'ro.build.version.release': '15' }, packages: { android: 'enabled', 'com.miui.home': 'enabled', 'com.miui.msa.global': 'enabled', 'com.miui.android.fashiongallery': 'enabled', 'com.miui.daemon': 'enabled' }, launcher: 'com.miui.home', keyboard: 'com.google.android.inputmethod.latin', files: {} };
    fs.writeFileSync(statePath, JSON.stringify(profile));
    const env = { ...process.env, FAKE_ADB_STATE: statePath, HOME: dir, USERPROFILE: dir, NO_COLOR: '1' };
    const cli = (...a) => execFileSync(process.execPath, [path.join(root, 'dist-cli', 'quiet-phone.mjs'), '--adb', path.join(root, 'tests', 'fixtures', 'fake-adb.mjs'), ...a], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const scan = JSON.parse(cli('scan', '--json'));
    assert.equal(scan.brand, 'xiaomi');
    assert.deepEqual(scan.plan.sort(), ['com.miui.android.fashiongallery', 'com.miui.msa.global']);
    assert.throws(() => cli('apply'), /needs a yes/);
    assert.match(cli('apply', '--yes'), /Done\. 2 ad services off\./);
    assert.equal(JSON.parse(fs.readFileSync(statePath, 'utf8')).packages['com.miui.msa.global'], 'disabled');
    assert.ok(fs.existsSync(path.join(dir, '.quiet-phone', 'restore-E2E1.json')));
    assert.match(cli('restore', '--yes'), /Everything is back\./);
    assert.equal(JSON.parse(fs.readFileSync(statePath, 'utf8')).packages['com.miui.msa.global'], 'enabled');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  console.log(`\nall ${passed} passed`);
} finally {
  await browser.close();
  await site.close();
}
