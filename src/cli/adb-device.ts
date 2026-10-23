import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Device, ShellResult } from '../core/device';
import { checkArgs } from '../core/device';

function run(adb: string, args: string[]): Promise<ShellResult> {
  return new Promise((resolve, reject) => {
    execFile(adb, args, { maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error(`Can't find adb (${adb}). Install Android platform tools, or pass --adb <path>.`));
        return;
      }
      const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
      resolve({ stdout, stderr, exitCode: code });
    });
  });
}

export interface AdbListing {
  serial: string;
  state: string;
  model: string;
}

export async function listDevices(adb: string): Promise<AdbListing[]> {
  const r = await run(adb, ['devices', '-l']);
  if (r.exitCode !== 0) throw new Error(`adb devices failed: ${r.stderr.trim() || r.stdout.trim()}`);
  return r.stdout
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [serial, state, ...rest] = l.split(/\s+/);
      const model = rest.find((x) => x.startsWith('model:'))?.slice(6) ?? '';
      return { serial, state, model };
    });
}

/** A phone reached through the local `adb` binary. */
export class AdbDevice implements Device {
  constructor(readonly serial: string, private adb = 'adb') {}

  async shell(args: readonly string[]): Promise<ShellResult> {
    checkArgs(args);
    return run(this.adb, ['-s', this.serial, 'shell', ...args]);
  }

  async writeFile(remote: string, text: string): Promise<void> {
    checkArgs([remote]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quiet-phone-'));
    const local = path.join(dir, 'restore.json');
    try {
      fs.writeFileSync(local, text);
      const r = await run(this.adb, ['-s', this.serial, 'push', local, remote]);
      if (r.exitCode !== 0) throw new Error(r.stderr.trim() || r.stdout.trim() || 'adb push failed');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  async readFile(remote: string): Promise<string | null> {
    const r = await this.shell(['cat', remote]);
    if (r.exitCode !== 0 || /No such file/.test(r.stdout + r.stderr)) return null;
    return r.stdout;
  }
}
