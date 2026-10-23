// Records the media from the built site running against the demo phone (`npm run build` first):
//   docs/media/quiet-phone-short-1080x1920.mp4  vertical clip for Shorts: connect, brand, preview, apply, done
//   docs/media/hero.gif                         the same flow for the README
//   public/og.png                               1200x630 link preview (rebuild afterwards to ship it)
// The demo banner is hidden (?capture) because the clip shows the interface only; the real
// before-and-after has to be filmed on a phone. Needs ffmpeg on PATH.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serve } from './serve.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'docs', 'media');
const FRAMES = path.join(root, 'tests', '.frames');
fs.mkdirSync(OUT, { recursive: true });
execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });

const site = await serve();
const browser = await chromium.launch();

// A visible tap, so viewers can follow the clicks.
const TAP_CSS = `.qp-tap{position:fixed;z-index:99;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;
  background:rgba(23,118,90,.28);border:3px solid rgba(23,118,90,.75);pointer-events:none;animation:qptap .55s ease-out forwards}
  @keyframes qptap{from{transform:scale(.4);opacity:1}to{transform:scale(1.5);opacity:0}}`;

async function open(viewport, scale, query) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.goto(`${site.url}?${query}`);
  await page.addStyleTag({ content: TAP_CSS });
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp };
}

async function tap(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: 8 });
  await page.evaluate(([x, y]) => {
    const d = document.createElement('div');
    d.className = 'qp-tap';
    d.style.left = `${x}px`;
    d.style.top = `${y}px`;
    document.body.append(d);
    setTimeout(() => d.remove(), 700);
  }, [x, y]);
  await page.waitForTimeout(160);
  await page.mouse.click(x, y);
}

async function scrollTo(page, y, ms = 900) {
  await page.evaluate(([y, ms]) => new Promise((done) => {
    const start = window.scrollY;
    const t0 = performance.now();
    const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      window.scrollTo(0, start + (y - start) * ease(t));
      if (t < 1) requestAnimationFrame(tick);
      else done();
    };
    requestAnimationFrame(tick);
  }), [y, ms]);
}

async function record(s, name, size, fn) {
  const dir = path.join(FRAMES, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  const onFrame = ({ data, metadata, sessionId }) => {
    const file = path.join(dir, `f${String(frames.length).padStart(5, '0')}.jpg`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ file, t: metadata.timestamp });
    s.cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  };
  s.cdp.on('Page.screencastFrame', onFrame);
  await s.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: size.w, maxHeight: size.h, everyNthFrame: 1 });
  await fn();
  await s.cdp.send('Page.stopScreencast').catch(() => {});
  s.cdp.off('Page.screencastFrame', onFrame);
  frames.sort((a, b) => a.t - b.t);
  return frames.map((f, i) => ({ file: f.file, dur: i + 1 < frames.length ? Math.max(0.001, frames[i + 1].t - f.t) : 0.5 }));
}

function concatList(name, frames, holdLast) {
  const list = path.join(FRAMES, `${name}.txt`);
  const lines = ['ffconcat version 1.0'];
  frames.forEach((f, i) => lines.push(`file '${f.file}'`, `duration ${(i === frames.length - 1 ? holdLast : f.dur).toFixed(4)}`));
  lines.push(`file '${frames[frames.length - 1].file}'`);
  fs.writeFileSync(list, lines.join('\n') + '\n');
  return list;
}

// The flow both clips show. `listScroll` is how far to scroll to show the plan.
async function flow(page, { intro, listScroll, hold }) {
  await page.waitForTimeout(intro);
  await tap(page, '[data-act=connect]');
  await page.locator('[data-stage=ready]').waitFor({ timeout: 15000 });
  await page.waitForTimeout(700);
  await tap(page, '[data-brand=xiaomi]');
  await page.waitForTimeout(500);
  const top = await page.locator('#plan').evaluate((el) => el.getBoundingClientRect().top + window.scrollY - 12);
  await scrollTo(page, top, 900);
  await page.waitForTimeout(900);
  await scrollTo(page, top + listScroll, 1500);
  await page.waitForTimeout(600);
  await tap(page, '[data-act=apply]');
  await page.locator('[data-stage=done]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(hold);
}

// ---- 1. The Short: 1080x1920 from a 540x960 layout at 2x ----------------------------------------
{
  const s = await open({ width: 540, height: 960 }, 2, 'demo=xiaomi&capture&latency=95');
  const frames = await record(s, 'short', { w: 1080, h: 1920 }, () => flow(s.page, { intro: 1600, listScroll: 520, hold: 4200 }));
  await s.ctx.close();
  const list = concatList('short', frames, 0.8);
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-vf', 'fps=30,scale=1080:1920:flags=lanczos,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart', path.join(OUT, 'quiet-phone-short-1080x1920.mp4')]);
  console.log(`docs/media/quiet-phone-short-1080x1920.mp4 (${frames.length} frames)`);
}

// ---- 2. README hero GIF ---------------------------------------------------------------------------
{
  const s = await open({ width: 760, height: 620 }, 1, 'demo=xiaomi&capture&latency=70');
  const frames = await record(s, 'hero', { w: 760, h: 620 }, () => flow(s.page, { intro: 1200, listScroll: 380, hold: 2600 }));
  await s.ctx.close();
  const list = concatList('hero', frames, 1.6);
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-vf',
    'fps=12,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
    '-loop', '0', path.join(OUT, 'hero.gif')]);
  console.log(`docs/media/hero.gif (${(fs.statSync(path.join(OUT, 'hero.gif')).size / 1e6).toFixed(1)} MB)`);
}

// ---- 3. og.png: headline plus the done screen ---------------------------------------------------
{
  const s = await open({ width: 400, height: 560 }, 2, 'demo=xiaomi&capture&latency=1');
  await s.page.locator('[data-act=connect]').click();
  await s.page.locator('[data-stage=ready]').waitFor();
  await s.page.locator('[data-act=apply]').click();
  await s.page.locator('[data-stage=done]').waitFor();
  await s.page.waitForTimeout(1200);
  const shot = await s.page.screenshot();
  await s.ctx.close();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 } });
  const p = await ctx.newPage();
  await p.setContent(`<!doctype html><style>
    body{margin:0;width:1200px;height:630px;overflow:hidden;background:#f4f3ee;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#17201b;display:flex}
    .l{flex:1;padding:70px 0 0 72px}
    .logo{display:flex;align-items:center;gap:14px;font-weight:800;font-size:30px;letter-spacing:-.02em}
    h1{font-size:62px;line-height:1.02;letter-spacing:-.04em;margin:46px 0 22px;font-weight:850}
    p{font-size:25px;color:#5b655f;margin:0;line-height:1.35}
    .url{margin-top:34px;font-size:22px;font-weight:700;color:#17765a}
    .r{width:420px;position:relative}
    .phone{position:absolute;top:44px;left:20px;width:350px;border-radius:44px;background:#17201b;padding:12px;box-shadow:0 30px 70px rgba(23,32,27,.28)}
    .phone img{display:block;width:100%;border-radius:34px}
  </style>
  <div class="l"><div class="logo"><svg width="52" height="52" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#17765a"/><rect x="19" y="9" width="26" height="46" rx="6" fill="none" stroke="#fff" stroke-width="4"/><path d="M36.5 25.5a8 8 0 1 0 4 10.4 6.4 6.4 0 0 1-4-10.4z" fill="#fff"/></svg>Quiet Phone</div>
  <h1>Your phone's lock&#8209;screen ads? One browser tab turns them off.</h1>
  <p>Android, over USB, in Chrome or Edge. Nothing is deleted; one button puts it all back.</p>
  <div class="url">cig13zs.github.io/quiet-phone</div></div>
  <div class="r"><div class="phone"><img src="data:image/png;base64,${shot.toString('base64')}"></div></div>`);
  await p.waitForTimeout(200);
  await p.screenshot({ path: path.join(root, 'public', 'og.png') });
  await ctx.close();
  console.log('public/og.png');
}

await browser.close();
await site.close();
fs.rmSync(FRAMES, { recursive: true, force: true });
