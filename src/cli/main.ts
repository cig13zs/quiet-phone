import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { AdbDevice, listDevices } from './adb-device';
import type { Device } from '../core/device';
import { PHONE_RESTORE_PATH } from '../core/device';
import type { Journal } from '../core/journal';
import { parseJournal, serializeJournal } from '../core/journal';
import type { JournalStore } from '../core/session';
import { Session } from '../core/session';
import { BRANDS, EVERY_PHONE, brandById } from '../core/data';
import { CATEGORY_NAMES, CATEGORIES } from '../core/types';
import { describeCount } from '../core/plan';
import { FakeDevice } from '../core/fake-device';
import { fakeProfile } from '../core/fake-profiles';

const VERSION = '0.1.0';

const HELP = `quiet-phone ${VERSION}
Turns off lock-screen ads, phone-maker ad services and preinstalled junk on an Android phone,
through your local adb. Every change is recorded and can be undone.

Usage
  quiet-phone scan                 Show what is on the phone and what would be turned off (default)
  quiet-phone apply                Turn off the recommended (safe) items, after you confirm
  quiet-phone restore              Put back everything Quiet Phone turned off
  quiet-phone brands               List the supported brands

Options
  --only a,b,c          Pick exactly these packages (they must be on the phone's list)
  --include-caution     Also pick the caution items
  --expert              Allow expert items (they still need --only)
  --brand ID            Use this brand's list instead of the detected one
  --no-fallback         Never use 'pm uninstall -k --user 0' when disabling is blocked
  --yes, -y             Don't ask; for scripts and agents, after the user has agreed
  --json                Machine-readable output (scan, apply, restore)
  --file PATH           restore: also use this restore file
  --serial SERIAL       Which phone, when more than one is plugged in
  --adb PATH            Path to adb (default: adb on PATH)

The web version needs no install: https://cig13zs.github.io/quiet-phone/
`;

interface Args {
  cmd: string;
  only?: string[];
  includeCaution: boolean;
  expert: boolean;
  brand?: string;
  fallback: boolean;
  yes: boolean;
  json: boolean;
  file?: string;
  serial?: string;
  adb: string;
  demo?: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { cmd: 'scan', includeCaution: false, expert: false, fallback: true, yes: false, json: false, adb: process.env.ADB || 'adb' };
  const rest = [...argv];
  const value = (flag: string) => {
    const v = rest.shift();
    if (!v || v.startsWith('--')) throw new UsageError(`${flag} needs a value`);
    return v;
  };
  let cmdSet = false;
  while (rest.length) {
    const t = rest.shift()!;
    if (t === '--only') a.only = value(t).split(',').map((s) => s.trim()).filter(Boolean);
    else if (t === '--include-caution') a.includeCaution = true;
    else if (t === '--expert') a.expert = true;
    else if (t === '--brand') a.brand = value(t);
    else if (t === '--no-fallback') a.fallback = false;
    else if (t === '--yes' || t === '-y') a.yes = true;
    else if (t === '--json') a.json = true;
    else if (t === '--file') a.file = value(t);
    else if (t === '--serial' || t === '-s') a.serial = value(t);
    else if (t === '--adb') a.adb = value(t);
    else if (t === '--demo') a.demo = value(t);
    else if (t === '--help' || t === '-h' || t === 'help') a.cmd = 'help';
    else if (t === '--version' || t === '-v') a.cmd = 'version';
    else if (!t.startsWith('-') && !cmdSet) {
      a.cmd = t;
      cmdSet = true;
    } else throw new UsageError(`Unknown option: ${t}`);
  }
  if (!['scan', 'apply', 'restore', 'brands', 'help', 'version'].includes(a.cmd)) throw new UsageError(`Unknown command: ${a.cmd}`);
  return a;
}

class UsageError extends Error {}

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = c('1');
const dim = c('2');
const green = c('32');
const yellow = c('33');
const red = c('31');
const riskColor = { safe: green, caution: yellow, expert: red } as const;

function storeDir() {
  return path.join(os.homedir(), '.quiet-phone');
}

const fileStore: JournalStore & { pathFor(serial: string): string } = {
  pathFor: (serial) => path.join(storeDir(), `restore-${serial.replace(/[^A-Za-z0-9._-]/g, '_')}.json`),
  load(serial) {
    try {
      return parseJournal(fs.readFileSync(this.pathFor(serial), 'utf8'));
    } catch {
      return null;
    }
  },
  save(j: Journal) {
    fs.mkdirSync(storeDir(), { recursive: true });
    fs.writeFileSync(this.pathFor(j.device.serial), serializeJournal(j));
  },
};

async function pickDevice(a: Args): Promise<Device> {
  if (a.demo) return new FakeDevice(fakeProfile(a.demo));
  const devices = await listDevices(a.adb);
  const usable = devices.filter((d) => d.state === 'device');
  if (a.serial) {
    const d = devices.find((x) => x.serial === a.serial);
    if (!d) throw new Error(`No phone with serial ${a.serial}. Plugged in: ${devices.map((x) => x.serial).join(', ') || 'none'}`);
    if (d.state === 'unauthorized') throw new Error('The phone has not allowed this computer yet. Unlock it and tap Allow on "Allow USB debugging?".');
    return new AdbDevice(d.serial, a.adb);
  }
  if (!usable.length) {
    if (devices.some((d) => d.state === 'unauthorized')) throw new Error('The phone has not allowed this computer yet. Unlock it and tap Allow on "Allow USB debugging?".');
    throw new Error('No phone found. Turn on USB debugging, plug the phone in with a data cable, and check `adb devices`.');
  }
  if (usable.length > 1) throw new Error(`More than one phone is connected (${usable.map((d) => d.serial).join(', ')}). Pick one with --serial.`);
  return new AdbDevice(usable[0].serial, a.adb);
}

function selectionFor(s: Session, a: Args): Set<string> {
  if (a.only) return new Set(a.only);
  const sel = s.defaultSelection();
  if (a.includeCaution) for (const c of s.candidates) if (c.risk === 'caution' && c.state === 'enabled' && !c.protectedWhy) sel.add(c.pkg);
  return sel;
}

function printScan(s: Session, sel: Set<string>, a: Args) {
  const p = s.phone;
  console.log(`${bold(p.name || p.model || 'Android phone')}  ${dim([p.os, p.android && `Android ${p.android}`, p.serial].filter(Boolean).join(' · '))}`);
  if (!s.brand) {
    console.log(yellow(`No list for "${p.brand}" yet. Try --brand with one of: ${BRANDS.map((b) => b.id).join(', ')}`));
    return;
  }
  console.log(`Brand list: ${s.brand.name}${s.detected?.id === s.brand.id ? dim(' (detected)') : ''}\n`);
  for (const cat of CATEGORIES) {
    const rows = s.candidates.filter((x) => x.category === cat && (a.expert || x.risk !== 'expert'));
    if (!rows.length) continue;
    console.log(bold(CATEGORY_NAMES[cat]));
    for (const x of rows) {
      const mark = x.protectedWhy ? dim('[kept]') : x.state !== 'enabled' ? dim('[off] ') : sel.has(x.pkg) ? green('[x]   ') : '[ ]   ';
      console.log(`  ${mark} ${x.label}  ${riskColor[x.risk](x.risk)}  ${dim(x.pkg)}`);
      console.log(`         ${dim(x.protectedWhy ? `Kept on: ${x.protectedWhy}` : x.reason)}`);
    }
    console.log('');
  }
  if (s.journal.entries.length) console.log(`${s.journal.entries.length} earlier change(s) can be restored with: quiet-phone restore`);
  if (s.cameBack.length) console.log(yellow(`Came back on since last time: ${s.cameBack.join(', ')}`));
}

async function ask(q: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(q)).trim());
  } finally {
    rl.close();
  }
}

async function confirmOrExit(a: Args, question: string): Promise<boolean> {
  if (a.yes) return true;
  if (!process.stdin.isTTY) {
    console.error('Not changing anything: this needs a yes. Run it in a terminal, or pass --yes once the phone owner has agreed.');
    process.exitCode = 2;
    return false;
  }
  return ask(question);
}

async function main(argv: string[]) {
  const a = parseArgs(argv);
  if (a.cmd === 'help') return void console.log(HELP);
  if (a.cmd === 'version') return void console.log(VERSION);
  if (a.cmd === 'brands') {
    if (a.json) return void console.log(JSON.stringify(BRANDS.map(({ id, name, sub, match }) => ({ id, name, sub, match })), null, 2));
    for (const b of BRANDS) console.log(`${b.id.padEnd(10)} ${b.name} (${b.sub})`);
    return;
  }
  if (a.brand && !brandById(a.brand)) throw new UsageError(`Unknown brand ${a.brand}. Try: ${BRANDS.map((b) => b.id).join(', ')}`);

  const device = await pickDevice(a);
  const s = new Session(device, a.demo ? { load: () => null, save: () => {} } : fileStore);
  await s.load();
  if (a.brand) s.useBrand(a.brand);

  if (a.cmd === 'scan') {
    const sel = selectionFor(s, a);
    const plan = s.plan(sel, { expert: a.expert });
    if (a.json) {
      console.log(JSON.stringify({
        phone: s.phone,
        brand: s.brand?.id ?? null,
        detected: s.detected?.id ?? null,
        candidates: s.candidates.map((x) => ({ pkg: x.pkg, label: x.label, category: x.category, risk: x.risk, reason: x.reason, state: x.state, protected: x.protectedWhy, picked: plan.actions.some((p) => p.pkg === x.pkg), sources: x.sources })),
        plan: plan.actions.map((p) => p.pkg),
        restorable: s.journal.entries.map((e) => e.pkg),
        cameBack: s.cameBack,
      }, null, 2));
      return;
    }
    printScan(s, sel, a);
    console.log(plan.actions.length ? `${bold(String(plan.actions.length))} would be turned off. Run ${bold('quiet-phone apply')} to do it.` : 'Nothing to turn off.');
    return;
  }

  if (a.cmd === 'apply') {
    const plan = s.plan(selectionFor(s, a), { expert: a.expert });
    if (!a.json) {
      printScan(s, new Set(plan.actions.map((x) => x.pkg)), a);
      for (const k of plan.skipped) console.log(yellow(`Skipped ${k.pkg}: ${k.why}`));
    }
    if (!plan.actions.length) {
      if (a.json) console.log(JSON.stringify({ results: [], skipped: plan.skipped }, null, 2));
      else console.log('Nothing to turn off.');
      return;
    }
    if (!(await confirmOrExit(a, `Turn off ${plan.actions.length}? You can restore them later. [y/N] `))) return;
    const results = await s.apply(plan, {
      allowUninstall: a.fallback,
      onStep: (r) => {
        if (!a.json) console.log(`  ${r.ok ? green('off') : red('failed')}  ${r.label}  ${dim(r.pkg)}${r.ok && r.message === 'Turned off' ? '' : `  ${r.message}`}`);
      },
    });
    const ok = results.filter((r) => r.ok);
    if (a.json) return void console.log(JSON.stringify({ results, skipped: plan.skipped, restoreFile: a.demo ? null : fileStore.pathFor(s.phone.serial) }, null, 2));
    console.log(`\n${bold(`Done. ${describeCount(plan.actions.filter((x) => ok.some((r) => r.pkg === x.pkg)).map((x) => x.category))} off.`)} Restore anytime with: quiet-phone restore`);
    if (!a.demo) console.log(dim(`Restore record: ${fileStore.pathFor(s.phone.serial)} and ${PHONE_RESTORE_PATH} on the phone.`));
    const tips = [...(s.brand?.settings ?? []), ...EVERY_PHONE];
    console.log(`\nSome ads are settings, not apps. On the phone:`);
    for (const t of tips) console.log(`  ${t.title}: ${t.steps.join(' ')}`);
    if (results.some((r) => !r.ok)) process.exitCode = 1;
    return;
  }

  if (a.cmd === 'restore') {
    if (a.file) await s.importJournal(fs.readFileSync(a.file, 'utf8'));
    const only: Set<string> | undefined = a.only ? new Set(a.only) : undefined;
    const todo = s.journal.entries.filter((e) => !only || only.has(e.pkg));
    if (!todo.length) {
      if (a.json) console.log(JSON.stringify({ results: [] }));
      else console.log('Nothing to restore: no record of changes on this phone. Pass --file if you saved a restore file.');
      return;
    }
    if (!a.json) for (const e of todo) console.log(`  ${e.label}  ${dim(e.pkg)}  ${dim(e.method === 'uninstall' ? '(reinstall for user 0)' : '(enable)')}`);
    if (!(await confirmOrExit(a, `Put back ${todo.length}? [y/N] `))) return;
    const results = await s.restore({
      only,
      onStep: (r) => {
        if (!a.json) console.log(`  ${r.ok ? green('back') : red('failed')}  ${r.label}  ${dim(r.pkg)}${r.ok ? '' : `  ${r.message}`}`);
      },
    });
    if (a.json) return void console.log(JSON.stringify({ results }, null, 2));
    const bad = results.filter((r) => !r.ok).length;
    console.log(bad ? red(`${bad} could not be put back; they stay in the restore record.`) : bold('Everything is back.'));
    if (bad) process.exitCode = 1;
  }
}

main(process.argv.slice(2)).catch((e) => {
  if (e instanceof UsageError) {
    console.error(`${e.message}\n\n${HELP}`);
    process.exitCode = 64;
  } else {
    console.error(red(e instanceof Error ? e.message : String(e)));
    process.exitCode = 1;
  }
});
