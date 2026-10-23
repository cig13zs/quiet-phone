import type { Device } from './device';
import type { PkgState } from './types';
import { isPackageName } from './safety';

export interface PhoneInfo {
  serial: string;
  brand: string;
  manufacturer: string;
  model: string;
  /** What the owner would call it, e.g. "Redmi Note 13". Falls back to the model code. */
  name: string;
  android: string;
  sdk: number;
  os: string;
  fingerprint: string;
}

export function parseProps(text: string): Map<string, string> {
  const props = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\[([^\]]+)\]:\s*\[(.*)\]\s*$/.exec(line);
    if (m) props.set(m[1], m[2]);
  }
  return props;
}

function osName(p: Map<string, string>): string {
  const v = (k: string) => p.get(k)?.trim() || '';
  if (v('ro.mi.os.version.name')) return `HyperOS ${v('ro.mi.os.version.name').replace(/^OS/, '')}`.trim();
  if (v('ro.miui.ui.version.name')) return `MIUI ${v('ro.miui.ui.version.name').replace(/^V/, '')}`;
  if (v('ro.build.version.oneui')) {
    const n = Number(v('ro.build.version.oneui'));
    if (n > 0) return `One UI ${Math.floor(n / 10000)}.${Math.floor((n % 10000) / 100)}`;
  }
  if (v('ro.build.version.realmeui')) return `realme UI ${v('ro.build.version.realmeui').replace(/^V/, '')}`;
  if (v('ro.build.version.oplusrom')) return `ColorOS ${v('ro.build.version.oplusrom').replace(/^V/, '')}`;
  if (v('ro.vivo.os.version')) return `${v('ro.vivo.os.name') || 'Funtouch OS'} ${v('ro.vivo.os.version')}`;
  if (v('ro.tranos.type')) return `${v('ro.tranos.type')} ${v('ro.tranos.version')}`.trim();
  if (v('ro.build.version.magic')) return `MagicOS ${v('ro.build.version.magic').replace(/^MagicOS_/, '')}`;
  if (v('ro.build.version.emui')) return v('ro.build.version.emui').replace(/_/g, ' ');
  return '';
}

export async function readPhone(device: Device): Promise<PhoneInfo> {
  const { stdout } = await device.shell(['getprop']);
  const p = parseProps(stdout);
  const get = (...keys: string[]) => keys.map((k) => p.get(k)?.trim()).find((x) => x) ?? '';
  const model = get('ro.product.model', 'ro.product.vendor.model');
  return {
    serial: device.serial,
    brand: get('ro.product.brand', 'ro.product.vendor.brand').toLowerCase(),
    manufacturer: get('ro.product.manufacturer', 'ro.product.vendor.manufacturer').toLowerCase(),
    model,
    name: get('ro.product.marketname', 'ro.product.vendor.marketname', 'ro.vendor.oplus.market.name', 'ro.config.marketing_name') || model,
    android: get('ro.build.version.release'),
    sdk: Number(get('ro.build.version.sdk')) || 0,
    os: osName(p),
    fingerprint: get('ro.build.fingerprint'),
  };
}

function pkgLines(text: string): Set<string> {
  const out = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^package:(\S+)$/.exec(line.trim());
    if (m && isPackageName(m[1])) out.add(m[1]);
  }
  return out;
}

/**
 * The state of every package on the phone for user 0. "removed" means uninstalled for this user
 * but still in the system image, which is what `pm uninstall -k --user 0` leaves behind.
 */
export async function readPackages(device: Device): Promise<Map<string, PkgState>> {
  const all = pkgLines((await device.shell(['pm', 'list', 'packages', '-u', '--user', '0'])).stdout);
  const installed = pkgLines((await device.shell(['pm', 'list', 'packages', '--user', '0'])).stdout);
  const disabled = pkgLines((await device.shell(['pm', 'list', 'packages', '-d', '--user', '0'])).stdout);
  if (installed.size === 0) throw new Error('The phone returned no packages. Is USB debugging fully allowed?');
  const states = new Map<string, PkgState>();
  for (const pkg of new Set([...all, ...installed])) {
    states.set(pkg, !installed.has(pkg) ? 'removed' : disabled.has(pkg) ? 'disabled' : 'enabled');
  }
  return states;
}

function firstPkgs(text: string): string[] {
  // Accepts "pkg/.Cls", "pkg/cls:pkg2/cls2", "pkg;pkg2" and one per line.
  return text
    .split(/[\s:;,]+/)
    .map((s) => s.split('/')[0].trim())
    .filter(isPackageName);
}

/**
 * Packages that are essential on this particular phone: the launcher in use, every enabled
 * keyboard, and the default phone and SMS apps. Returned with the reason shown to the user.
 */
export async function readProtected(device: Device): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const tryShell = async (args: string[]) => {
    try {
      const r = await device.shell(args);
      return r.exitCode > 0 ? '' : r.stdout;
    } catch {
      return '';
    }
  };
  const home = await tryShell(['cmd', 'package', 'resolve-activity', '--brief', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.HOME']);
  const lastLine = home.trim().split(/\r?\n/).pop() ?? '';
  if (lastLine.includes('/')) for (const p of firstPkgs(lastLine)) out.set(p, 'Your home screen (launcher).');
  for (const key of ['enabled_input_methods', 'default_input_method']) {
    for (const p of firstPkgs(await tryShell(['settings', 'get', 'secure', key]))) out.set(p, 'A keyboard you have turned on.');
  }
  for (const [role, why] of [
    ['android.app.role.HOME', 'Your home screen (launcher).'],
    ['android.app.role.DIALER', 'Your phone app.'],
    ['android.app.role.SMS', 'Your messages app.'],
  ] as const) {
    for (const p of firstPkgs(await tryShell(['cmd', 'role', 'get-role-holders', '--user', '0', role]))) out.set(p, why);
  }
  return out;
}
