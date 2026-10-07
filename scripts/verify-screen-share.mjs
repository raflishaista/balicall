// Synthetic display/camera capture with real local LiveKit transport; no OS screen is captured.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const baseUrl = process.env.SCREEN_TEST_URL || 'http://127.0.0.1:5187';
const output = new URL('../artifacts/screenshots/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.SCREEN_TEST_BROWSER || (process.platform === 'win32' ? 'msedge' : undefined),
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const pages = [], checks = [], pageErrors = [];
const runId = Date.now(), room = `screen-check-${runId}`;

async function participant(number, unsupported = false) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await context.addInitScript(({ number, unsupported }) => {
    window.__screenTracks = []; window.__cameraTracks = []; window.__screenRequests = 0;
    window.__screenFailure = null; window.__recognitionStarts = 0;
    const capture = kind => {
      const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
      const ctx = canvas.getContext('2d');
      const draw = () => {
        ctx.fillStyle = kind === 'screen' ? '#f3f7fc' : '#173a54'; ctx.fillRect(0, 0, 1280, 720);
        ctx.fillStyle = '#086bdd'; ctx.fillRect(60, 60, 1160, 130);
        ctx.fillStyle = '#ffffff'; ctx.font = '42px sans-serif';
        ctx.fillText(kind === 'screen' ? `Deployment Review — Presenter ${number}` : `Camera ${number}`, 90, 140);
        ctx.fillStyle = kind === 'screen' ? '#173a54' : '#ffffff'; ctx.font = '28px sans-serif';
        ctx.fillText('Bali Tower Sentra · local media test', 90, 280);
        ctx.fillText(new Date().toISOString(), 90, 350);
        if (kind === 'screen') {
          ctx.fillText('01  Network deployment timeline', 90, 460);
          ctx.fillText('02  Site readiness & vendor update', 90, 520);
          ctx.strokeStyle = '#086bdd'; ctx.lineWidth = 6; ctx.strokeRect(8, 8, 1264, 704);
        }
      };
      draw(); const stream = canvas.captureStream(10), timer = setInterval(draw, 100);
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track); track.stop = () => { clearInterval(timer); stop(); };
        (kind === 'screen' ? window.__screenTracks : window.__cameraTracks).push(track);
      }
      return stream;
    };
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = constraints => constraints.video && !constraints.audio ? Promise.resolve(capture('camera')) : gum(constraints);
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: unsupported ? undefined : async options => {
      window.__screenRequests++; window.__displayOptions = options;
      if (window.__screenFailure === 'pending') await new Promise(resolve => { window.__resumeScreen = resolve; });
      if (window.__screenFailure) throw new DOMException('Synthetic picker result', window.__screenFailure);
      return capture('screen');
    } });
    class Recognition {
      start() { this.active = true; window.__recognitionStarts++; queueMicrotask(() => { if (this.active) this.onstart?.(); }); }
      stop() { this.active = false; queueMicrotask(() => this.onend?.()); }
      abort() { this.active = false; }
    }
    window.SpeechRecognition = Recognition; window.webkitSpeechRecognition = Recognition;
  }, { number, unsupported });
  const page = await context.newPage(); pages.push(page);
  page.on('pageerror', error => pageErrors.push({ participant: number, message: error.message }));
  await page.goto(baseUrl);
  assert.ok((await page.locator('body').innerText()).length > 0);
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  await page.getByRole('button', { name: 'Buat rapat', exact: true }).click();
  await page.getByLabel('NIK karyawan').fill(`SCREEN-${runId}-${number}`);
  await page.getByLabel('Nama lengkap').fill(`Screen Tester ${number}`);
  await page.getByLabel('Departemen').selectOption('IT Operations');
  await page.getByLabel('Nama ruang rapat').fill(room);
  await page.getByRole('button', { name: 'Mulai rapat', exact: true }).click();
  await page.getByText('Terhubung', { exact: true }).waitFor({ timeout: 20000 });
  return page;
}

async function frames(page, presenter) {
  await page.getByRole('region', { name: 'Layar yang dibagikan', exact: true }).getByRole('status').filter({ hasText: `Screen Tester ${presenter}` }).waitFor({ timeout: 15000 });
  await page.waitForFunction(() => { const video = document.querySelector('.screen-share-video'); return video?.videoWidth > 0 && video.readyState >= 2; }, undefined, { timeout: 20000 });
}
async function grid(page) { await page.locator('.screen-share-stage').waitFor({ state: 'detached', timeout: 15000 }); }
async function cameras(page, count) {
  await page.waitForFunction(count => {
    const videos = [...document.querySelectorAll('.participant-video')];
    return videos.length === count && videos.every(v => v.videoWidth > 0 && v.readyState >= 2);
  }, count, { timeout: 20000 });
}
async function leave(page) {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole('button', { name: 'Keluar', exact: true }).click();
  await page.getByRole('heading', { name: /^Selamat/ }).waitFor({ timeout: 15000 });
}

try {
  const first = await participant(1), second = await participant(2);
  await cameras(first, 2); await cameras(second, 2);
  assert.equal(await first.evaluate(() => window.__screenRequests), 0);
  const recognitionStarts = await first.evaluate(() => window.__recognitionStarts);
  await first.getByRole('button', { name: 'Bagikan layar', exact: true }).click();
  await frames(first, 1); await frames(second, 1);
  assert.equal(await first.evaluate(() => window.__displayOptions.audio), false);
  assert.equal(await first.getByRole('button', { name: 'Hentikan berbagi layar', exact: true }).getAttribute('aria-pressed'), 'true');
  const style = await second.locator('.screen-share-video').evaluate(v => ({ fit: getComputedStyle(v).objectFit, transform: getComputedStyle(v).transform }));
  assert.deepEqual(style, { fit: 'contain', transform: 'none' });
  assert.equal(await second.locator('.participant-tile').count(), 2);
  assert.equal(await first.getByRole('button', { name: 'Matikan mikrofon', exact: true }).count(), 1);
  assert.equal(await first.evaluate(() => window.__recognitionStarts), recognitionStarts);
  checks.push('share starts on click, sends real WebRTC frames to a second client, preserves cameras/microphone/transcription, and shows uncropped unmirrored content');
  await second.screenshot({ path: fileURLToPath(new URL('screen-share-desktop.png', output)), fullPage: true });

  await first.getByRole('button', { name: 'Matikan kamera', exact: true }).click();
  await cameras(second, 1); await frames(second, 1);
  await first.getByRole('button', { name: 'Aktifkan kamera', exact: true }).click();
  await cameras(second, 2); await frames(second, 1);
  await first.getByRole('button', { name: 'Matikan mikrofon', exact: true }).click();
  await first.getByRole('button', { name: 'Aktifkan mikrofon', exact: true }).waitFor();
  await frames(second, 1);
  await first.getByRole('button', { name: 'Aktifkan mikrofon', exact: true }).click();
  checks.push('camera toggles and microphone mute do not interrupt active screen sharing');

  await first.getByRole('button', { name: 'Hentikan berbagi layar', exact: true }).click();
  await grid(first); await grid(second);
  assert.equal(await first.evaluate(() => window.__screenTracks.every(t => t.readyState === 'ended')), true);
  checks.push('meeting stop button releases display capture and restores both participant grids');

  await first.evaluate(() => { window.__screenFailure = 'NotAllowedError'; });
  await first.getByRole('button', { name: 'Bagikan layar', exact: true }).click();
  await first.getByRole('alert').filter({ hasText: 'Berbagi layar dibatalkan' }).waitFor();
  assert.equal(await first.getByRole('button', { name: 'Bagikan layar', exact: true }).isEnabled(), true);
  await first.evaluate(() => { window.__screenFailure = null; });
  await first.getByRole('button', { name: 'Bagikan layar', exact: true }).click();
  await frames(second, 1);
  assert.equal(await first.getByRole('alert').filter({ hasText: 'Berbagi layar dibatalkan' }).count(), 0);
  await first.evaluate(() => { const track = window.__screenTracks.findLast(t => t.readyState === 'live'); track.stop(); track.dispatchEvent(new Event('ended')); });
  await grid(first); await grid(second);
  await first.getByRole('button', { name: 'Bagikan layar', exact: true }).waitFor();
  checks.push('cancelled picker can be retried; native ended event simulating browser toolbar stop restores layout and button');

  await first.getByRole('button', { name: 'Bagikan layar', exact: true }).click();
  await frames(second, 1);
  await second.getByRole('button', { name: 'Bagikan layar', exact: true }).click();
  const choice = second.getByRole('combobox', { name: 'Pilih presenter layar', exact: true });
  await choice.waitFor();
  assert.equal(await choice.locator('option').count(), 2);
  await choice.selectOption({ label: 'Screen Tester 2 (Kamu)' }); await frames(second, 2);
  await second.screenshot({ path: fileURLToPath(new URL('screen-share-presenters.png', output)), fullPage: true });
  await first.evaluate(() => { const track = window.__screenTracks.findLast(t => t.readyState === 'live'); track.stop(); track.dispatchEvent(new Event('ended')); });
  await frames(first, 2); await frames(second, 2);
  await choice.waitFor({ state: 'detached' });
  checks.push('simultaneous shares have a presenter selector; a presenter stopping falls back to the remaining share');

  const mobile = await participant(3, true);
  await frames(mobile, 2);
  await cameras(mobile, 3);
  assert.equal(await mobile.getByRole('button', { name: 'Bagikan layar', exact: true }).isDisabled(), true);
  await mobile.getByRole('status').filter({ hasText: 'Berbagi layar belum tersedia' }).waitFor();
  await mobile.setViewportSize({ width: 390, height: 844 });
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  await mobile.screenshot({ path: fileURLToPath(new URL('screen-share-mobile.png', output)), fullPage: true });
  checks.push('unsupported capture browser can receive screen share; mobile has accessible camera strip and no horizontal page overflow');

  await leave(second); await grid(first); await grid(mobile);
  assert.equal(await second.evaluate(() => window.__screenTracks.every(t => t.readyState === 'ended')), true);
  checks.push('presenter leaving stops capture and restores viewer grids');
  await first.evaluate(() => { window.__screenFailure = 'pending'; });
  await first.getByRole('button', { name: 'Bagikan layar', exact: true }).click();
  await first.waitForFunction(() => Boolean(window.__resumeScreen));
  await leave(first);
  await first.evaluate(() => { window.__screenFailure = null; window.__resumeScreen(); });
  await first.waitForFunction(() => window.__screenTracks.length >= 4 && window.__screenTracks.every(t => t.readyState === 'ended'));
  await grid(mobile);
  checks.push('leaving while the picker is pending stops late capture before publication');
  assert.deepEqual(pageErrors, []); checks.push('no uncaught browser errors or Vite overlay');
  const report = { date: new Date().toISOString(), status: 'passed', media: 'canvas camera/display fixtures, fake microphone, real local LiveKit WebRTC; speech recognition stubbed; OS picker not tested', checks, pageErrors };
  await writeFile(new URL('../artifacts/SCREEN_SHARE_VERIFICATION.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  for (const [index, page] of pages.entries()) {
    if (page.isClosed()) continue;
    await page.screenshot({ path: fileURLToPath(new URL(`screen-share-failure-${index + 1}.png`, output)), fullPage: true }).catch(() => {});
    console.log(JSON.stringify({ participant: index + 1, text: await page.locator('body').innerText(), pageErrors }, null, 2));
  }
  throw error;
} finally {
  for (const page of pages) { try { if (await page.getByRole('button', { name: 'Keluar', exact: true }).count()) await leave(page); } catch { /* Browser close still disconnects. */ } }
  await browser.close();
}
