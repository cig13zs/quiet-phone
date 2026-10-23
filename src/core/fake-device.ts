import type { Device, ShellResult } from './device';
import { checkArgs } from './device';
import type { PkgState } from './types';

/**
 * A pretend phone that answers the same shell commands a real one does, with the same output
 * formats. Used by the unit tests, the end-to-end test, and the "Try it without a phone" demo.
 */
export interface FakeProfile {
  serial: string;
  props: Record<string, string>;
  packages: Record<string, PkgState>;
  launcher: string;
  keyboards: string[];
  dialer?: string;
  sms?: string;
  /** Packages where `pm disable-user` is refused, as some MIUI builds do. */
  blockDisable?: string[];
}

export interface FakeOptions {
  /** Milliseconds per command, so the demo moves at the speed of a real phone. */
  latency?: number;
  /** Throw on the nth command (1-based) to test a cable pulled mid-run. */
  disconnectAt?: number;
}

const ok = (stdout: string): ShellResult => ({ stdout, stderr: '', exitCode: 0 });
const fail = (stderr: string, exitCode = 255): ShellResult => ({ stdout: '', stderr, exitCode });

export class FakeDevice implements Device {
  readonly serial: string;
  readonly log: string[] = [];
  readonly files = new Map<string, string>();
  private pkgs: Map<string, PkgState>;
  private count = 0;

  constructor(private profile: FakeProfile, private opts: FakeOptions = {}) {
    this.serial = profile.serial;
    this.pkgs = new Map(Object.entries(profile.packages));
  }

  state(pkg: string): PkgState | undefined {
    return this.pkgs.get(pkg);
  }

  async writeFile(path: string, text: string): Promise<void> {
    await this.tick();
    this.files.set(path, text);
  }

  async readFile(path: string): Promise<string | null> {
    await this.tick();
    return this.files.get(path) ?? null;
  }

  private async tick() {
    this.count += 1;
    if (this.opts.disconnectAt && this.count >= this.opts.disconnectAt) throw new Error('The phone was disconnected.');
    if (this.opts.latency) await new Promise((r) => setTimeout(r, this.opts.latency));
  }

  async shell(args: readonly string[]): Promise<ShellResult> {
    checkArgs(args);
    await this.tick();
    this.log.push(args.join(' '));
    const [cmd, ...rest] = args;
    if (cmd === 'getprop') {
      return ok(Object.entries(this.profile.props).map(([k, v]) => `[${k}]: [${v}]`).join('\n') + '\n');
    }
    if (cmd === 'pm' && rest[0] === 'list' && rest[1] === 'packages') return this.list(rest.slice(2));
    if (cmd === 'pm' && rest[0] === 'disable-user') return this.disable(last(rest));
    if (cmd === 'pm' && rest[0] === 'enable') return this.enable(last(rest));
    if (cmd === 'pm' && rest[0] === 'uninstall') return this.uninstall(rest);
    if ((cmd === 'cmd' && rest[0] === 'package' && rest[1] === 'install-existing') || (cmd === 'pm' && rest[0] === 'install-existing')) {
      return this.installExisting(last(rest));
    }
    if (cmd === 'cmd' && rest[0] === 'package' && rest[1] === 'resolve-activity') {
      return ok(`priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true\n${this.profile.launcher}/.Launcher\n`);
    }
    if (cmd === 'settings' && rest[0] === 'get' && rest[1] === 'secure') {
      if (rest[2] === 'enabled_input_methods') return ok(this.profile.keyboards.map((k) => `${k}/.Ime`).join(':') + '\n');
      if (rest[2] === 'default_input_method') return ok(`${this.profile.keyboards[0]}/.Ime\n`);
      return ok('null\n');
    }
    if (cmd === 'cmd' && rest[0] === 'role') {
      const role = last(rest);
      const holder = role.endsWith('HOME') ? this.profile.launcher : role.endsWith('DIALER') ? this.profile.dialer : role.endsWith('SMS') ? this.profile.sms : undefined;
      return ok(holder ? `${holder}\n` : '\n');
    }
    return fail(`/system/bin/sh: ${cmd}: not found`, 127);
  }

  private list(flags: string[]): ShellResult {
    const filter = flags.find((f) => !f.startsWith('-') && f !== '0');
    const out: string[] = [];
    for (const [pkg, st] of this.pkgs) {
      if (filter && !pkg.includes(filter)) continue;
      if (st === 'removed' && !flags.includes('-u')) continue;
      if (flags.includes('-d') && st !== 'disabled') continue;
      if (flags.includes('-e') && st !== 'enabled') continue;
      out.push(`package:${pkg}`);
    }
    return ok(out.join('\n') + (out.length ? '\n' : ''));
  }

  private disable(pkg: string): ShellResult {
    const st = this.pkgs.get(pkg);
    if (!st || st === 'removed') return fail(`Error: java.lang.IllegalArgumentException: Unknown package: ${pkg}`);
    if (this.profile.blockDisable?.includes(pkg)) {
      return fail(`Exception occurred while executing 'disable-user':\njava.lang.SecurityException: Shell cannot change component state for ${pkg} to 3`);
    }
    this.pkgs.set(pkg, 'disabled');
    return ok(`Package ${pkg} new state: disabled-user\n`);
  }

  private enable(pkg: string): ShellResult {
    const st = this.pkgs.get(pkg);
    if (!st || st === 'removed') return fail(`Error: java.lang.IllegalArgumentException: Unknown package: ${pkg}`);
    this.pkgs.set(pkg, 'enabled');
    return ok(`Package ${pkg} new state: enabled\n`);
  }

  private uninstall(rest: string[]): ShellResult {
    const pkg = last(rest);
    if (!rest.includes('-k') || !rest.includes('--user')) return fail('Refusing a full uninstall in the fake phone');
    const st = this.pkgs.get(pkg);
    if (!st || st === 'removed') return ok('Failure [not installed for 0]\n');
    this.pkgs.set(pkg, 'removed');
    return ok('Success\n');
  }

  private installExisting(pkg: string): ShellResult {
    const st = this.pkgs.get(pkg);
    if (!st) return fail(`Package ${pkg} doesn't exist`, 1);
    if (st === 'removed') this.pkgs.set(pkg, 'enabled');
    return ok(`Package ${pkg} installed for user: 0\n`);
  }
}

function last(a: readonly string[]): string {
  return a[a.length - 1] ?? '';
}
