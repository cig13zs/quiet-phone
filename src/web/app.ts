import type { Device } from '../core/device';
import { PHONE_RESTORE_PATH } from '../core/device';
import type { JournalStore } from '../core/session';
import { Session } from '../core/session';
import type { Candidate } from '../core/plan';
import { describeCount } from '../core/plan';
import type { StepResult } from '../core/apply';
import type { Category } from '../core/types';
import { CATEGORIES, CATEGORY_NAMES } from '../core/types';
import { BRANDS, EVERY_PHONE, brandById } from '../core/data';
import { icons } from './icons';

export const REPO = 'https://github.com/cig13zs/quiet-phone';

export interface ConnectedDevice extends Device {
  disconnected?: Promise<void>;
}

export interface AppOptions {
  /** Asks for a phone. Calls `onAskPhone` when it is waiting for the "Allow USB debugging?" tap. */
  connect: (onAskPhone: () => void) => Promise<ConnectedDevice>;
  /** False when the browser has no WebUSB. */
  supported: boolean;
  store: JournalStore;
  /** Set in the demo, which runs against a pretend phone. */
  demo?: boolean;
  download?: (filename: string, text: string) => void;
  confirm?: (message: string) => boolean;
}

type Stage = 'intro' | 'connecting' | 'asking' | 'loading' | 'ready' | 'applying' | 'done' | 'restoring' | 'restored';

interface Notice {
  kind: 'good' | 'warn' | 'bad' | 'info';
  title: string;
  html?: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const RISK_TEXT = { safe: 'Safe', caution: 'Caution', expert: 'Expert' } as const;

function defaultDownload(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function mountApp(root: HTMLElement, opts: AppOptions) {
  const st = {
    stage: 'intro' as Stage,
    picked: null as string | null,
    session: null as Session | null,
    selection: new Set<string>(),
    expert: false,
    allowUninstall: true,
    run: [] as { pkg: string; label: string }[],
    results: new Map<string, StepResult>(),
    fresh: null as string | null,
    summary: '',
    notice: null as Notice | null,
  };
  const download = opts.download ?? defaultDownload;
  const confirmFn = opts.confirm ?? ((m: string) => window.confirm(m));

  // ---------- pieces ----------

  const header = () => `
    <header class="top">
      <a class="home" href="./" aria-label="Quiet Phone, start page">${icons.logo}<span class="brandname">Quiet Phone</span></a>
      ${opts.demo ? `<span class="demo-pill">${icons.info.replace('<svg', '<svg width="15" height="15"')} Demo phone<span class="wide">, nothing real changes</span></span>` : ''}
      <span class="spacer"></span>
      <a class="gh" href="${REPO}" rel="noopener">Source</a>
    </header>`;

  const noticeHtml = (n: Notice | null) => {
    if (!n) return '';
    const ic = n.kind === 'good' ? icons.shield : n.kind === 'info' ? icons.info : icons.warn;
    return `<div class="notice ${n.kind === 'info' ? '' : n.kind}" role="${n.kind === 'bad' ? 'alert' : 'status'}">${ic}<div class="body"><b>${esc(n.title)}</b>${n.html ?? ''}</div></div>`;
  };

  const brandGrid = (selected: string | null, detected: string | null) => `
    <div class="brands" role="group" aria-label="Phone brand">
      ${BRANDS.map((b) => `
        <button class="brand" type="button" data-brand="${b.id}" aria-pressed="${b.id === selected}">
          <span class="n">${esc(b.name)}</span>${b.id === detected ? '<span class="s found">✓ This phone</span>' : `<span class="s">${esc(b.sub)}</span>`}
        </button>`).join('')}
    </div>`;

  const getReady = () => {
    const b = st.picked ? brandById(st.picked) : undefined;
    const devSteps = b
      ? `<ul>${b.devOptions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
      : `<ul><li>Settings › About phone › tap <b>Build number</b> (or OS version) 7 times.</li><li>Then Developer options › turn on <b>USB debugging</b>.</li><li class="muted">Pick your brand above for the exact menu names.</li></ul>`;
    return `
    <section class="card" id="ready">
      <h2>Get your phone ready</h2>
      <p class="sub">About two minutes, once. ${b ? `Steps for ${esc(b.name)} phones.` : ''}</p>
      <ol class="steps">
        <li><strong>Turn on USB debugging</strong>${devSteps}</li>
        <li><strong>Plug the phone into this computer</strong><ul><li>Use a data cable; some charging cables carry no data.</li><li>If the phone asks what the USB connection is for, pick <b>File transfer</b>.</li></ul></li>
        <li><strong>Press Connect phone and pick your phone</strong><ul><li>Chrome shows a list of USB devices. Your phone appears by its model name.</li></ul></li>
        <li><strong>Tap Allow on the phone</strong>
          <div class="prompt-mock" aria-hidden="true"><b>Allow USB debugging?</b>The computer's RSA key fingerprint is:<div class="fp">3A:9F:0C:…:B1:7E</div><label><span class="box" style="width:16px;height:16px;border:2px solid currentColor;border-radius:4px;display:inline-block"></span> Always allow from this computer</label><div class="row"><span>Cancel</span><span>Allow</span></div></div>
          <ul><li>The key is made by this browser and stays in it. It is how the phone knows this tab.</li></ul>
        </li>
      </ol>
    </section>`;
  };

  const whatItDoes = () => `
    <section class="card">
      <h2>What it does, and what it never does</h2>
      <div class="twocol" style="margin-top:12px">
        <div><h3>Does</h3><ul>
          <li>Shows every app it will turn off, with the reason, before anything changes.</li>
          <li>Turns apps off for your user with Android's own <code>pm disable-user</code>.</li>
          <li>Keeps a restore record in this browser and on the phone.</li>
          <li>Puts everything back with one button.</li>
        </ul></div>
        <div><h3>Never</h3><ul>
          <li>Roots the phone or unlocks anything.</li>
          <li>Deletes apps from the system.</li>
          <li>Touches system parts, Google Play, your keyboard, home screen, phone or messages app.</li>
          <li>Sends anything anywhere. No server, no analytics.</li>
        </ul></div>
      </div>
    </section>`;

  const faq = () => `
    <section style="margin-top:28px">
      <div class="section-title">If something is stuck</div>
      <details class="faq"><summary>My phone isn't in Chrome's list</summary><p>Check that USB debugging is on and the cable carries data (try another cable). Set the USB mode to File transfer. On Windows the phone may need its maker's USB driver, or Google's USB driver, before Chrome can see the debugging connection.</p></details>
      <details class="faq"><summary>"Another program is using the phone"</summary><p>Only one program can hold the phone's debugging connection. Close Android Studio, scrcpy, Vysor and similar tools. If you have Android's platform tools, run <code>adb kill-server</code>. Then press Connect phone again.</p></details>
      <details class="faq"><summary>The "Allow USB debugging?" prompt never shows</summary><p>Unlock the phone and keep the screen on. Unplug and plug it back in. If it still doesn't appear, go to Developer options › Revoke USB debugging authorisations, then connect again.</p></details>
      <details class="faq"><summary>Does this need root, or void the warranty?</summary><p>No root and no unlocking. It only uses commands Android gives every phone owner through USB debugging, for your user. A factory reset also brings everything back.</p></details>
      <details class="faq"><summary>The ads came back after an update</summary><p>Big updates sometimes switch these apps back on. Connect again: Quiet Phone lists what came back and picks it for you.</p></details>
      <details class="faq"><summary>Can I do it from another Android phone?</summary><p>Yes. Chrome on Android supports WebUSB. Open this page on one phone and connect the phone you want to clean with a USB-C cable or an OTG adapter.</p></details>
      <details class="faq"><summary>Firefox or Safari?</summary><p>They don't support WebUSB, so they can't reach the phone. Use Chrome or Edge, or the command-line version: <code>npx quiet-phone</code> with Android's <code>adb</code> installed.</p></details>
      <details class="faq"><summary>What about ads inside apps I installed?</summary><p>Those come from the apps themselves. Quiet Phone deals with what the phone maker put there.</p></details>
    </section>`;

  const footer = () => `
    <footer>
      <p>Quiet Phone runs entirely in this tab. There is no server, no account and no analytics, and the page blocks requests to any other site. Package lists, with a source for every entry, are in <a href="${REPO}/tree/main/data/lists" rel="noopener">data/lists</a>.</p>
      <p class="links"><a href="${REPO}" rel="noopener">GitHub</a><a href="${REPO}/issues/new?template=phone.yml" rel="noopener">Add your phone</a><a href="${REPO}#restore" rel="noopener">How restore works</a><a href="https://ko-fi.com/jju1s" rel="noopener">Ko-fi</a></p>
      <p>Not affiliated with any phone maker. MIT licence.</p>
    </footer>`;

  const intro = () => {
    const connectBtn = opts.supported
      ? `<button class="btn primary big" type="button" data-act="connect">${icons.usb} Connect phone</button>`
      : '';
    const unsupported = opts.supported ? '' : noticeHtml({
      kind: 'warn',
      title: "This browser can't reach USB devices",
      html: `<p>Open this page in Chrome or Edge on a computer, or in Chrome on another Android phone. Firefox and Safari don't support WebUSB.</p>`,
    });
    return `
      <section class="hero">
        <p class="eyebrow">Android · Chrome or Edge · No install</p>
        <h1>Turn off your phone's lock-screen ads.</h1>
        <p class="lede">Plug your Android phone into this computer. Quiet Phone finds Glance, the phone maker's ad services and preinstalled junk, shows you exactly what it will turn off, and turns it off. One button puts it all back.</p>
        ${unsupported}
        <div class="actions">${connectBtn}<a class="btn ghost" href="?demo=xiaomi">Try the demo, no phone needed</a></div>
        <ul class="trust">
          <li>${icons.eye} Nothing leaves this tab</li>
          <li>${icons.shield} Nothing is deleted</li>
          <li>${icons.undo} Undo anytime</li>
          <li>${icons.code} Open source</li>
        </ul>
      </section>
      ${noticeHtml(st.notice)}
      <div class="section-title">Your phone</div>
      ${brandGrid(st.picked, null)}
      ${getReady()}
      ${whatItDoes()}
      ${faq()}`;
  };

  const waiting = () => {
    if (st.stage === 'asking') {
      return `<section class="card waiting" aria-live="polite">
        <div class="big-ic pulse">${icons.phoneAllow}</div>
        <h2>Check your phone</h2>
        <p class="muted">Tap <b>Allow</b> on "Allow USB debugging?". If this is your own computer, tick "Always allow" too.</p>
        <p><span class="spinner"></span></p>
      </section>`;
    }
    const text = st.stage === 'loading' ? 'Reading the apps on your phone…' : 'Waiting for you to pick the phone…';
    return `<section class="card waiting" aria-live="polite"><p><span class="spinner"></span></p><h2>${text}</h2><p class="muted">Nothing changes until you press the button at the end.</p></section>`;
  };

  const phoneCard = (s: Session) => `
    <section class="card phone">
      <div class="ic">${icons.phone}</div>
      <div class="grow">
        <div class="nm">${esc(s.phone.name || 'Android phone')}</div>
        <div class="os"><span class="dot"></span>${esc([s.phone.os, s.phone.android && `Android ${s.phone.android}`].filter(Boolean).join(' · ') || 'Connected')}</div>
      </div>
      <button class="btn small ghost" type="button" data-act="disconnect">Disconnect</button>
    </section>`;

  const rowHtml = (c: Candidate) => {
    const off = c.state !== 'enabled';
    const locked = !!c.protectedWhy;
    const checked = st.selection.has(c.pkg) && !off && !locked;
    const disabled = off || locked || (c.risk === 'expert' && !st.expert);
    const chips = [
      locked ? `<span class="chip kept">${icons.lock.replace('<svg', '<svg width="12" height="12" style="margin-right:3px"')}Kept</span>` : '',
      off && !locked ? `<span class="chip off">${c.state === 'removed' ? 'Removed' : 'Already off'}</span>` : '',
      !locked ? `<span class="chip ${c.risk}">${RISK_TEXT[c.risk]}</span>` : '',
    ].join('');
    const src = c.sources.map((u, i) => `<a href="${esc(u)}" rel="noopener noreferrer" target="_blank">source${c.sources.length > 1 ? ` ${i + 1}` : ''}</a>`).join(' · ');
    return `
      <div class="pkg ${locked ? 'locked' : ''}" data-row="${esc(c.pkg)}">
        <label class="check chk"><input type="checkbox" data-pkg="${esc(c.pkg)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} aria-label="Turn off ${esc(c.label)}"><span class="box">${icons.check}</span></label>
        <span class="lbl">${esc(c.label)}</span>
        <span class="chips">${chips}</span>
        <span class="why">${esc(locked ? `Kept on: ${c.protectedWhy}` : c.reason)}</span>
        <span class="id">${esc(c.pkg)} · ${src}</span>
      </div>`;
  };

  const groupsHtml = (cands: Candidate[]) => {
    const visible = cands.filter((c) => st.expert || c.risk !== 'expert');
    return CATEGORIES.map((cat: Category) => {
      const rows = visible.filter((c) => c.category === cat);
      if (!rows.length) return '';
      const n = rows.filter((c) => st.selection.has(c.pkg) && c.state === 'enabled' && !c.protectedWhy).length;
      return `<div class="group"><h3><span>${CATEGORY_NAMES[cat]}</span><span>${n ? `${n} picked` : ''}</span></h3><div class="rows">${rows.map(rowHtml).join('')}</div></div>`;
    }).join('');
  };

  const selectedPlan = () => st.session!.plan(st.selection, { expert: st.expert });

  const ready = (s: Session) => {
    const cands = s.candidates;
    const plan = selectedPlan();
    const n = plan.actions.length;
    const offAlready = cands.filter((c) => c.state !== 'enabled' && !c.protectedWhy).length;
    const hiddenExpert = cands.filter((c) => c.risk === 'expert').length;
    const parts: string[] = [];
    if (s.journal.entries.length) {
      parts.push(noticeHtml({
        kind: 'info',
        title: `${s.journal.entries.length} change${s.journal.entries.length === 1 ? '' : 's'} from before on this phone`,
        html: `<p>Quiet Phone turned these off earlier. You can put them all back.</p><div class="actions"><button class="btn small" type="button" data-act="restore">${icons.undo} Restore everything</button><button class="btn small ghost" type="button" data-act="export">${icons.down} Save restore file</button></div>`,
      }));
    }
    if (s.cameBack.length) {
      parts.push(noticeHtml({ kind: 'warn', title: `${s.cameBack.length} came back on`, html: `<p>An update or a settings change switched ${s.cameBack.length === 1 ? 'it' : 'them'} back on. ${s.cameBack.length === 1 ? 'It is' : 'They are'} picked again below.</p>` }));
    }
    if (!s.detected) {
      parts.push(noticeHtml({
        kind: 'warn',
        title: `No list for ${esc(s.phone.brand || 'this brand')} yet`,
        html: `<p>Pick the closest brand to check for matching apps, or <a href="${REPO}/issues/new?template=phone.yml" rel="noopener">ask for your phone</a>.</p>`,
      }));
    }
    let body: string;
    if (!s.brand) body = `<p class="muted" style="margin:0">Pick a brand to see what can be turned off.</p>`;
    else if (!cands.length) body = `<p class="muted" style="margin:0">None of the ${esc(s.brand.name)} list is on this phone. It may already be clean, or it may use names we don't know yet.</p>`;
    else {
      const meta = [`${cands.length} listed app${cands.length === 1 ? '' : 's'} found`, offAlready ? `${offAlready} already off` : '', !st.expert && hiddenExpert ? `${hiddenExpert} expert hidden` : ''].filter(Boolean).join(' · ');
      body = `
        <div class="summary"><div class="num" data-count>${n}</div><div><div class="what">${n === 1 ? 'app will be turned off' : 'apps will be turned off'}</div><div class="meta">${meta}</div></div></div>
        ${groupsHtml(cands)}
        <div class="toggles">
          <label class="toggle"><label class="check"><input type="checkbox" data-opt="uninstall" ${st.allowUninstall ? 'checked' : ''}><span class="box">${icons.check}</span></label><span><b>If the phone blocks turning an app off, remove it for my user instead</b><span class="t">Some phones refuse <code>pm disable-user</code> for their own apps. Then <code>pm uninstall -k --user 0</code> is used: the app stays in the system and Restore reinstalls it.</span></span></label>
          ${hiddenExpert ? `<label class="toggle"><label class="check"><input type="checkbox" data-opt="expert" ${st.expert ? 'checked' : ''}><span class="box">${icons.check}</span></label><span><b>Show expert items</b><span class="t">Apps that are fine for most people to keep. Turning them off can change how the phone behaves.</span></span></label>` : ''}
        </div>`;
    }
    return `
      ${phoneCard(s)}
      ${noticeHtml(st.notice)}
      ${parts.join('')}
      <div class="section-title">Brand</div>
      ${brandGrid(s.brand?.id ?? null, s.detected?.id ?? null)}
      <section class="card" id="plan">${body}</section>
      <div class="actions" style="margin-top:6px">
        <button class="btn small ghost" type="button" data-act="import">${icons.up} Load a restore file</button>
      </div>
      <div class="bar"><div class="in">
        <div class="note">Nothing changes until you press this. Everything can be put back.</div>
        <button class="btn primary big" type="button" data-act="apply" ${n ? '' : 'disabled'}>Turn off ${n}</button>
      </div></div>`;
  };

  const runRows = (verbDone: string) => `
    <div class="rows">${st.run.map(({ pkg, label }) => {
      const r = st.results.get(pkg);
      const cls = !r ? '' : r.ok ? 'ok' : 'fail';
      const ic = !r ? '<span class="spinner" style="width:18px;height:18px;border-width:2.5px"></span>' : r.ok ? icons.okCircle : icons.badCircle;
      const msg = !r ? '' : r.ok ? (r.message === 'Turned off' || r.message === 'Back on' ? verbDone : r.message) : r.message;
      return `<div class="pkg ${cls}"><span class="state-ic ${r ? (r.ok ? 'ok' : 'bad') : ''} ${st.fresh === pkg ? 'pop' : ''}">${r || st.stage === 'applying' || st.stage === 'restoring' ? ic : ''}</span><span class="lbl">${esc(label)}</span><span></span>${msg ? `<span class="res">${esc(msg)}</span>` : ''}<span class="id">${esc(pkg)}</span></div>`;
    }).join('')}</div>`;

  const running = () => {
    const done = st.results.size;
    const total = st.run.length;
    const restoring = st.stage === 'restoring';
    return `
      ${phoneCard(st.session!)}
      <section class="card" aria-live="polite">
        <div class="summary"><div class="num">${done}</div><div><div class="what">${restoring ? 'of' : 'of'} ${total} ${restoring ? 'put back' : 'turned off'}</div><div class="meta">${restoring ? 'Putting things back…' : 'Turning off…'} Keep the cable plugged in.</div></div></div>
        <div class="progress" style="margin:14px 0 16px"><i style="width:${total ? Math.round((done / total) * 100) : 0}%"></i></div>
        ${runRows(restoring ? 'Back on' : 'Off')}
      </section>`;
  };

  const doneView = () => {
    const s = st.session!;
    const ok = [...st.results.values()].filter((r) => r.ok);
    const failed = [...st.results.values()].filter((r) => !r.ok);
    const brand = s.brand;
    const tips = [...(brand?.settings ?? []), ...EVERY_PHONE];
    const phoneCopy = s.phoneCopyError
      ? `The copy on the phone could not be saved (${esc(s.phoneCopyError)}), so save the restore file now.`
      : `A copy of the restore record is on the phone too, in <code>${esc(PHONE_RESTORE_PATH.replace('/sdcard/', ''))}</code>.`;
    return `
      ${phoneCard(s)}
      <section class="card done" aria-live="polite">
        <svg class="tick" viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r="42"/><path d="M25 43.5l11 11 23-24"/></svg>
        <h2>${ok.length ? `Done. ${esc(st.summary)} off.` : 'Nothing was turned off.'}</h2>
        <p class="lead">${ok.length ? 'Restore anytime.' : 'The phone refused every change. See below.'}</p>
        <div class="actions">
          <button class="btn primary" type="button" data-act="export">${icons.down} Save restore file</button>
          <button class="btn" type="button" data-act="restore">${icons.undo} Restore everything</button>
        </div>
        <p class="fine">Lock the phone and wake it to see the difference. ${phoneCopy}</p>
      </section>
      ${failed.length ? noticeHtml({ kind: 'warn', title: `${failed.length} could not be changed`, html: `<p>${failed.map((f) => `${esc(f.label)}: ${esc(f.message)}`).join('<br>')}</p><p>On Xiaomi phones, turning on "USB debugging (Security settings)" in Developer options often helps.</p>` }) : ''}
      <section class="card tips">
        <h2>Some ads are settings, not apps</h2>
        <p class="sub">Switch these off on the phone too${brand ? ` (${esc(brand.name)})` : ''}. Menu names vary a little between versions.</p>
        ${tips.map((t) => `<h3>${esc(t.title)}</h3>${t.steps.map((x) => `<p>${esc(x)}</p>`).join('')}`).join('')}
      </section>
      <details class="card" style="padding:16px 20px"><summary style="cursor:pointer;font-weight:650">What was changed (${ok.length})</summary><div style="margin-top:12px">${runRows('Off')}</div></details>
      <div class="actions"><button class="btn ghost" type="button" data-act="back">Back to the list</button></div>`;
  };

  const restoredView = () => {
    const ok = [...st.results.values()].filter((r) => r.ok);
    const failed = [...st.results.values()].filter((r) => !r.ok);
    return `
      ${phoneCard(st.session!)}
      <section class="card done" aria-live="polite">
        <svg class="tick" viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r="42"/><path d="M25 43.5l11 11 23-24"/></svg>
        <h2>${failed.length ? 'Mostly back.' : 'Everything is back.'}</h2>
        <p class="lead">${ok.length} app${ok.length === 1 ? ' is' : 's are'} on again, as before.</p>
        <div class="actions"><button class="btn" type="button" data-act="back">Back to the list</button></div>
      </section>
      ${failed.length ? noticeHtml({ kind: 'bad', title: `${failed.length} could not be put back`, html: `<p>${failed.map((f) => `${esc(f.label)}: ${esc(f.message)}`).join('<br>')}</p><p>They stay in the restore record; try again, or save the restore file.</p>` }) : ''}`;
  };

  // ---------- render ----------

  function render() {
    let main: string;
    const s = st.session;
    const waitingStage = ['connecting', 'asking', 'loading'].includes(st.stage);
    if (st.stage === 'intro' || !s && !['connecting', 'asking', 'loading'].includes(st.stage)) main = intro();
    else if (['connecting', 'asking', 'loading'].includes(st.stage)) main = waiting();
    else if (st.stage === 'ready') main = ready(s!);
    else if (st.stage === 'applying' || st.stage === 'restoring') main = running();
    else if (st.stage === 'done') main = doneView();
    else main = restoredView();
    root.innerHTML = `<div class="wrap" data-stage="${st.stage}">${header()}<main>${main}</main>${waitingStage ? '' : footer()}</div>`;
    st.fresh = null;
  }

  // ---------- actions ----------

  async function connect() {
    st.notice = null;
    st.stage = 'connecting';
    render();
    let device: ConnectedDevice;
    try {
      device = await opts.connect(() => {
        st.stage = 'asking';
        render();
      });
    } catch (e) {
      const err = e as Error & { kind?: string };
      st.stage = 'intro';
      st.notice = connectProblem(err.kind, err.message);
      render();
      return;
    }
    st.stage = 'loading';
    render();
    try {
      const s = new Session(device, opts.store);
      await s.load();
      if (!s.brand && st.picked) s.useBrand(st.picked);
      st.session = s;
      st.selection = s.defaultSelection();
      st.stage = 'ready';
      device.disconnected?.then(() => {
        if (st.session?.device !== device) return;
        st.session = null;
        st.stage = 'intro';
        st.notice = { kind: 'warn', title: 'The phone was disconnected', html: '<p>Plug it back in and press Connect phone. Anything already changed is in the restore record.</p>' };
        render();
      });
    } catch (e) {
      st.stage = 'intro';
      st.notice = { kind: 'bad', title: "Couldn't read the phone", html: `<p>${esc((e as Error).message)}</p><p>Unplug it, plug it back in, and try again.</p>` };
    }
    render();
  }

  function connectProblem(kind: string | undefined, message: string): Notice | null {
    if (kind === 'cancelled') return { kind: 'info', title: 'No phone picked', html: "<p>If your phone wasn't in the list, check the steps below: USB debugging on, a data cable, and File transfer mode.</p>" };
    if (kind === 'busy') return { kind: 'bad', title: 'Another program is using the phone', html: '<p>Close Android Studio, scrcpy or other ADB tools. If you have platform tools, run <code>adb kill-server</code>. Then press Connect phone again.</p>' };
    if (kind === 'denied') return { kind: 'bad', title: "The phone didn't allow the connection", html: '<p>Unplug and plug it back in, unlock it, and tap Allow. No prompt? Developer options › Revoke USB debugging authorisations, then try again.</p>' };
    if (kind === 'unsupported') return { kind: 'warn', title: "This browser can't reach USB devices", html: '<p>Use Chrome or Edge.</p>' };
    return { kind: 'bad', title: "Couldn't connect", html: `<p>${esc(message)}</p><p>Check the steps below and try again.</p>` };
  }

  async function apply() {
    const s = st.session!;
    const plan = selectedPlan();
    if (!plan.actions.length) return;
    const risky = plan.actions.filter((a) => a.risk !== 'safe');
    if (risky.length && !confirmFn(`${risky.length} of these ${risky.length === 1 ? 'is' : 'are'} marked caution or expert:\n\n${risky.map((a) => `• ${a.label}`).join('\n')}\n\nTurn them off too? You can restore them later.`)) return;
    st.run = plan.actions.map((a) => ({ pkg: a.pkg, label: a.label }));
    st.results = new Map();
    st.notice = null;
    st.stage = 'applying';
    render();
    window.scrollTo?.({ top: 0 });
    try {
      const results = await s.apply(plan, {
        allowUninstall: st.allowUninstall,
        onStep: (r) => {
          st.results.set(r.pkg, r);
          st.fresh = r.pkg;
          render();
        },
      });
      const okPkgs = new Set(results.filter((r) => r.ok).map((r) => r.pkg));
      st.summary = describeCount(plan.actions.filter((a) => okPkgs.has(a.pkg)).map((a) => a.category));
      st.stage = 'done';
    } catch (e) {
      st.stage = 'ready';
      st.notice = { kind: 'bad', title: 'Stopped partway', html: `<p>${esc((e as Error).message)}</p><p>Everything changed so far is in the restore record. Reconnect to continue or to restore.</p>` };
      try {
        await s.refresh();
      } catch {
        /* the phone may be gone */
      }
      st.selection = s.defaultSelection();
    }
    render();
    window.scrollTo?.({ top: 0 });
  }

  async function restoreAll() {
    const s = st.session!;
    if (!s.journal.entries.length) {
      st.notice = { kind: 'info', title: 'Nothing to restore', html: '<p>Quiet Phone has no record of changes on this phone. If you saved a restore file, load it first.</p>' };
      st.stage = 'ready';
      render();
      return;
    }
    st.run = [...s.journal.entries].reverse().map((e) => ({ pkg: e.pkg, label: e.label }));
    st.results = new Map();
    st.notice = null;
    st.stage = 'restoring';
    render();
    window.scrollTo?.({ top: 0 });
    try {
      await s.restore({
        onStep: (r) => {
          st.results.set(r.pkg, r);
          st.fresh = r.pkg;
          render();
        },
      });
      st.stage = 'restored';
    } catch (e) {
      st.stage = 'ready';
      st.notice = { kind: 'bad', title: 'Restore stopped partway', html: `<p>${esc((e as Error).message)}</p><p>What is left is still in the restore record. Reconnect and press Restore again.</p>` };
    }
    st.selection = s.defaultSelection();
    render();
    window.scrollTo?.({ top: 0 });
  }

  function exportJournal() {
    const s = st.session!;
    const day = new Date().toISOString().slice(0, 10);
    const name = (s.phone.name || s.phone.model || 'phone').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    download(`quiet-phone-restore-${name}-${day}.json`, s.exportJournal());
  }

  function importJournal() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const added = await st.session!.importJournal(await file.text());
        st.notice = { kind: 'good', title: added ? `Loaded ${added} record${added === 1 ? '' : 's'}` : 'Nothing new in that file', html: added ? '<p>Press Restore everything to put them back.</p>' : '' };
      } catch (e) {
        st.notice = { kind: 'bad', title: "Couldn't load that file", html: `<p>${esc((e as Error).message)}</p>` };
      }
      render();
    });
    input.click();
  }

  async function disconnect() {
    const s = st.session;
    st.session = null;
    st.stage = 'intro';
    st.notice = null;
    render();
    await s?.device.close?.().catch(() => {});
  }

  root.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const brandBtn = t.closest<HTMLElement>('[data-brand]');
    if (brandBtn) {
      const id = brandBtn.dataset.brand!;
      if (st.session && st.stage === 'ready') {
        st.session.useBrand(id);
        st.selection = st.session.defaultSelection();
      } else {
        st.picked = st.picked === id ? null : id;
      }
      render();
      return;
    }
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'connect') void connect();
    else if (act === 'apply') void apply();
    else if (act === 'restore') void restoreAll();
    else if (act === 'export') exportJournal();
    else if (act === 'import') importJournal();
    else if (act === 'disconnect') void disconnect();
    else if (act === 'back') {
      st.stage = 'ready';
      st.notice = null;
      render();
    }
  });

  root.addEventListener('change', (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.dataset.pkg) {
      const pkg = t.dataset.pkg;
      if (t.checked) st.selection.add(pkg);
      else st.selection.delete(pkg);
      render();
      root.querySelector<HTMLInputElement>(`input[data-pkg="${CSS.escape(pkg)}"]`)?.focus();
    } else if (t.dataset.opt === 'uninstall') {
      st.allowUninstall = t.checked;
    } else if (t.dataset.opt === 'expert') {
      st.expert = t.checked;
      render();
    }
  });

  render();
  return { state: st, render };
}
