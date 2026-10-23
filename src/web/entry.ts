import './style.css';
import { mountApp } from './app';
import { connectWebUsb, webUsbSupported } from './webusb';
import type { Journal } from '../core/journal';
import { parseJournal, serializeJournal } from '../core/journal';
import { memoryStore } from '../core/session';
import { FakeDevice } from '../core/fake-device';
import { FAKE_PROFILES, fakeProfile } from '../core/fake-profiles';

const params = new URLSearchParams(location.search);
const demo = params.get('demo');
const capture = params.has('capture');
if (capture) document.body.classList.add('capture');

const KEY = (serial: string) => `quiet-phone:restore:${serial}`;

// The restore record for each phone, kept in this browser. Storage can be missing or blocked
// (private windows, strict settings); then the copy on the phone and the saved file still work.
const browserStore = {
  load(serial: string): Journal | null {
    try {
      const text = localStorage.getItem(KEY(serial));
      return text ? parseJournal(text) : null;
    } catch {
      return null;
    }
  },
  save(j: Journal) {
    try {
      localStorage.setItem(KEY(j.device.serial), serializeJournal(j));
    } catch {
      /* not fatal */
    }
  },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const root = document.getElementById('app')!;

if (demo !== null) {
  const id = demo in FAKE_PROFILES ? demo : 'xiaomi';
  const latency = Number(params.get('latency') ?? 70);
  mountApp(root, {
    demo: true,
    supported: true,
    store: memoryStore(),
    connect: async (onAskPhone) => {
      await sleep(500);
      onAskPhone();
      await sleep(1400);
      return new FakeDevice(fakeProfile(id), { latency });
    },
  });
} else {
  mountApp(root, { supported: webUsbSupported(), store: browserStore, connect: connectWebUsb });
}
