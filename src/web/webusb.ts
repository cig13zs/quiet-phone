import { Adb, AdbDaemonTransport } from '@yume-chan/adb';
import { AdbDaemonWebUsbDevice, AdbDaemonWebUsbDeviceManager } from '@yume-chan/adb-daemon-webusb';
import AdbWebCredentialStore from '@yume-chan/adb-credential-web';
import { ReadableStream } from '@yume-chan/stream-extra';
import type { Device, ShellResult } from '../core/device';
import { checkArgs } from '../core/device';

export type ConnectProblem = 'cancelled' | 'busy' | 'unsupported' | 'denied' | 'other';

export class ConnectError extends Error {
  constructor(readonly kind: ConnectProblem, message: string) {
    super(message);
  }
}

export function webUsbSupported(): boolean {
  return typeof navigator !== 'undefined' && 'usb' in navigator && !!AdbDaemonWebUsbDeviceManager.BROWSER;
}

/** A phone reached over WebUSB with Tango (ya-webadb). Nothing leaves the browser. */
class WebUsbDevice implements Device {
  constructor(private adb: Adb) {}

  get serial(): string {
    return this.adb.serial;
  }

  get disconnected(): Promise<void> {
    return this.adb.disconnected;
  }

  async shell(args: readonly string[]): Promise<ShellResult> {
    checkArgs(args);
    const sp = this.adb.subprocess.shellProtocol;
    if (sp?.isSupported) return sp.spawnWaitText(args);
    const out = await this.adb.subprocess.noneProtocol.spawnWaitText(args);
    return { stdout: out, stderr: '', exitCode: -1 };
  }

  async writeFile(path: string, text: string): Promise<void> {
    checkArgs([path]);
    const bytes = new TextEncoder().encode(text);
    const sync = await this.adb.sync();
    try {
      await sync.write({
        filename: path,
        file: new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(bytes);
            c.close();
          },
        }),
      });
    } finally {
      await sync.dispose();
    }
  }

  async readFile(path: string): Promise<string | null> {
    const r = await this.shell(['cat', path]);
    if (r.exitCode > 0 || /No such file/.test(r.stdout + r.stderr)) return null;
    return r.stdout;
  }

  async close(): Promise<void> {
    await this.adb.close();
  }
}

/**
 * Asks Chrome for the phone, opens its ADB interface and waits for the "Allow USB debugging?"
 * tap. `onAskPhone` fires just before that wait, so the page can say "check your phone".
 */
export async function connectWebUsb(onAskPhone: () => void): Promise<Device & { disconnected: Promise<void> }> {
  const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
  if (!manager) throw new ConnectError('unsupported', "This browser can't reach USB devices.");
  const usb = await manager.requestDevice();
  if (!usb) throw new ConnectError('cancelled', 'No phone was picked.');
  let connection;
  try {
    connection = await usb.connect();
  } catch (e) {
    if (e instanceof AdbDaemonWebUsbDevice.DeviceBusyError) {
      throw new ConnectError('busy', 'Another program is already using this phone over ADB.');
    }
    throw new ConnectError('other', (e as Error).message || String(e));
  }
  onAskPhone();
  try {
    const transport = await AdbDaemonTransport.authenticate({
      serial: usb.serial,
      connection,
      credentialStore: new AdbWebCredentialStore('Quiet Phone'),
    });
    return new WebUsbDevice(new Adb(transport)) as WebUsbDevice & { disconnected: Promise<void> };
  } catch (e) {
    throw new ConnectError('denied', (e as Error).message || 'The phone did not allow USB debugging.');
  }
}
