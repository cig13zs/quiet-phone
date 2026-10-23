/**
 * Everything Quiet Phone needs from a phone. The browser talks to it over WebUSB, the CLI through
 * the local `adb` binary, and the tests and the demo through FakeDevice.
 */
export interface ShellResult {
  stdout: string;
  stderr: string;
  /** -1 when the transport can't report it (very old Android). Callers read the output instead. */
  exitCode: number;
}

export interface Device {
  readonly serial: string;
  /** Runs a command. Every argument is checked by `checkArgs` first, so nothing is ever quoted. */
  shell(args: readonly string[]): Promise<ShellResult>;
  /** Writes a small text file to shared storage on the phone. */
  writeFile(path: string, text: string): Promise<void>;
  /** Reads a small text file from the phone, or null if it isn't there. */
  readFile(path: string): Promise<string | null>;
  close?(): Promise<void>;
}

const SAFE_ARG = /^[A-Za-z0-9._:/=-]+$/;

/** Rejects anything a shell could read as more than one plain word. */
export function checkArgs(args: readonly string[]): void {
  if (args.length === 0) throw new Error('Empty command');
  for (const a of args) {
    if (!SAFE_ARG.test(a)) throw new Error(`Refusing to send an unsafe shell argument: ${JSON.stringify(a)}`);
  }
}

export const PHONE_RESTORE_PATH = '/sdcard/Download/quiet-phone-restore.json';
