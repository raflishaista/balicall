// Synthetic capture/devices/permissions, real browser preview and local LiveKit WebRTC.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const url = process.env.PREJOIN_TEST_URL || 'http://127.0.0.1:5187';
const output = new URL('../artifacts/screenshots/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PREJOIN_TEST_BROWSER || (process.platform === 'win32' ? 'msedge' : undefined), args: ['--autoplay-policy=no-user-gesture-required'] });
const pages = [], errors = [], checks = [], runId = Date.now(), room = `prejoin-check-${runId}`;
async function setup(number) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await context.addInitScript(() => {
    window.__devices = ['mic-a', 'mic-b', 'camera-a', 'camera-b'].map(deviceId => ({ kind: deviceId.startsWith('mic') ? 'audioinput' : 'videoinput', deviceId, groupId: deviceId, label: `Test ${deviceId}` }));
    window.__captures = []; window.__requests = []; window.__contexts = [];
    navigator.mediaDevices.enumerateDevices = async () => window.__devices.map(device => ({ ...device, toJSON() { return this; } }));
    const Audio = window.AudioContext;
    window.AudioContext = class extends Audio { constructor(...args) { super(...args); window.__contexts.push(this); } };
    navigator.mediaDevices.getUserMedia = async constraints => {
      const kind = constraints.video ? 'videoinput' : 'audioinput', option = constraints.video || constraints.audio;
      const requested = typeof option?.deviceId === 'string' ? option.deviceId : option?.deviceId?.exact || option?.deviceId?.ideal;
      const id = !requested || requested === 'default' ? window.__devices.find(device => device.kind === kind)?.deviceId : requested;
      window.__requests.push({ kind, id });
      if (window.__waitFor === kind) { window.__waitFor = null; await new Promise(resolve => { window.__resolveCapture = resolve; }); }
      if (window.__deny === kind) throw new DOMException('Synthetic permission denial', 'NotAllowedError');
      if (!window.__devices.some(device => device.deviceId === id && device.kind === kind)) throw new DOMException('Synthetic device absent', 'NotFoundError');
      let stream, clean;
      if (constraints.video) {
        const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 540;
        const ctx = canvas.getContext('2d');
        const draw = () => { ctx.fillStyle = id === 'camera-b' ? '#176594' : '#163d56'; ctx.fillRect(0, 0, 960, 540); ctx.fillStyle = '#ffffff'; ctx.font = '40px sans-serif'; ctx.fillText(`Preview ${id}`, 310, 220); ctx.font = '22px sans-serif'; ctx.fillText(new Date().toISOString(), 290, 360); };
        draw(); const interval = setInterval(draw, 100); stream = canvas.captureStream(10); clean = () => clearInterval(interval);
      } else {
        const ctx = new AudioContext(), oscillator = ctx.createOscillator(), gain = ctx.createGain(), dest = ctx.createMediaStreamDestination();
        oscillator.frequency.value = id === 'mic-b' ? 650 : 440; gain.gain.value = .2; oscillator.connect(gain); gain.connect(dest); oscillator.start();
        stream = dest.stream; clean = () => { oscillator.stop(); void ctx.close().catch(() => {}); };
      }
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track), settings = track.getSettings.bind(track); let stopped = false;
        track.getSettings = () => ({ ...settings(), deviceId: id });
        track.stop = () => { if (!stopped) { stopped = true; clean(); } stop(); };
        window.__captures.push({ track, deviceId: id, kind });
      }
      return stream;
    };
    class Recognition { start() { this.active = true; queueMicrotask(() => { if (this.active) this.onstart?.(); }); } stop() { this.active = false; queueMicrotask(() => this.onend?.()); } abort() { this.active = false; } }
    window.SpeechRecognition = Recognition; window.webkitSpeechRecognition = Recognition;
  });
  const page = await context.newPage(); pages.push(page);
  page.on('pageerror', error => errors.push({ participant: number, message: error.message }));
  page.on('console', message => { if (message.type() === 'error' && !/Synthetic permission denial/.test(message.text())) errors.push({ participant: number, message: message.text() }); });
  await page.goto(url); await lobby(page, number);
  return page;
}
async function lobby(page, number) {
  await page.getByRole('button', { name: 'Buat rapat', exact: true }).click();
  await page.getByLabel('NIK karyawan').fill(`PREF-${runId}-${number}`);
  await page.getByLabel('Nama lengkap').fill(`Preview Tester ${number}`);
  await page.getByLabel('Departemen').selectOption('IT Operations');
  await page.getByLabel('Nama ruang rapat').fill(room);
}
async function join(page) {
  await page.getByRole('button', { name: 'Mulai rapat', exact: true }).click();
  await page.getByText('Terhubung', { exact: true }).waitFor({ timeout: 20000 });
}
async function leave(page) {
  if (await page.locator('.call-room').count()) { await page.getByRole('button', { name: 'Keluar', exact: true }).click(); await page.locator('.call-room').waitFor({ state: 'detached', timeout: 20000 }); }
}
const selected = async page => { await page.getByLabel('Mikrofon sebelum bergabung').selectOption('mic-b'); await page.getByLabel('Kamera sebelum bergabung').selectOption('camera-b'); };
const frames = async page => page.waitForFunction(() => { const video = document.querySelector('.prejoin-video'); return video?.readyState >= 2 && video.videoWidth > 0; });
const finishAnimations = async page => page.evaluate(async () => { await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); });

try {
  const first = await setup(1);
  assert.equal(await first.evaluate(() => window.__requests.length), 0);
  await selected(first); assert.equal(await first.evaluate(() => window.__requests.length), 0);
  assert.equal(await first.locator('vite-error-overlay').count(), 0);
  checks.push('opening lobby and selecting devices request no capture; labels and keyboard-accessible choices render without overlay');
  await first.getByRole('button', { name: 'Preview kamera', exact: true }).click(); await frames(first);
  await first.getByRole('button', { name: 'Uji suara', exact: true }).click();
  await first.waitForFunction(() => Number(document.querySelector('[aria-label="Level mikrofon"]')?.getAttribute('aria-valuenow')) > 0);
  assert.equal(await first.locator('.prejoin-video').evaluate(video => video.muted), true);
  assert.equal(await first.locator('.prejoin-video').evaluate(video => getComputedStyle(video).transform), 'matrix(-1, 0, 0, 1, 0, 0)');
  assert.deepEqual(await first.evaluate(() => window.__requests.map(request => request.id)), ['camera-b', 'mic-b']);
  await finishAnimations(first);
  await first.screenshot({ path: fileURLToPath(new URL('prejoin-desktop.png', output)), fullPage: true });
  await first.setViewportSize({ width: 390, height: 844 }); await first.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await first.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await first.screenshot({ path: fileURLToPath(new URL('prejoin-mobile.png', output)), fullPage: true });
  await first.setViewportSize({ width: 1440, height: 1100 });
  checks.push('selected camera-b preview plays muted with local mirror and microphone-b drives real analyser meter; desktop/mobile fit');

  const previewTracks = await first.evaluate(() => window.__captures.map(capture => capture.track.id));
  let releaseToken, tokenStarted;
  const tokenGate = new Promise(resolve => { releaseToken = resolve; }), tokenRequest = new Promise(resolve => { tokenStarted = resolve; });
  await first.route('**/api/token', async route => { const response = await route.fetch(); tokenStarted(); await tokenGate; await route.fulfill({ response }); });
  await first.getByRole('button', { name: 'Mulai rapat', exact: true }).click(); await tokenRequest;
  assert.equal(await first.evaluate(ids => window.__captures.filter(capture => ids.includes(capture.track.id)).every(capture => capture.track.readyState === 'ended'), previewTracks), true);
  await first.waitForFunction(() => window.__contexts.every(context => context.state === 'closed'));
  assert.equal(await first.getByLabel('Kamera sebelum bergabung').isDisabled(), true);
  releaseToken(); await first.getByText('Terhubung', { exact: true }).waitFor({ timeout: 20000 });
  await first.waitForFunction(() => window.__captures.some(capture => capture.deviceId === 'camera-b' && capture.track.readyState === 'live'));
  await first.getByRole('button', { name: 'Pengaturan perangkat', exact: true }).click();
  assert.equal(await first.getByLabel('Mikrofon', { exact: true }).inputValue(), 'mic-b');
  assert.equal(await first.getByLabel('Kamera', { exact: true }).inputValue(), 'camera-b');
  await first.keyboard.press('Escape');
  checks.push('preview tracks and analyser contexts close before token response; selected inputs become actual in-call devices');

  const second = await setup(2); await selected(second);
  await second.getByRole('button', { name: 'Mikrofon saat bergabung', exact: true }).click();
  await second.getByRole('button', { name: 'Kamera saat bergabung', exact: true }).click();
  await join(second);
  assert.equal(await second.evaluate(() => window.__requests.length), 0);
  assert.equal(await second.getByRole('button', { name: 'Aktifkan kamera', exact: true }).count(), 1);
  assert.equal(await second.getByRole('button', { name: 'Aktifkan mikrofon', exact: true }).count(), 1);
  await second.waitForFunction(() => [...document.querySelectorAll('.participant-video')].some(video => video.readyState >= 2));
  await second.getByRole('button', { name: 'Aktifkan kamera', exact: true }).click();
  await second.getByRole('button', { name: 'Aktifkan mikrofon', exact: true }).click();
  await second.waitForFunction(() => window.__captures.filter(capture => capture.track.readyState === 'live').length >= 2);
  assert.deepEqual(await second.evaluate(() => window.__requests.map(request => request.id)), ['camera-b', 'mic-b']);
  checks.push('camera-off and muted join acquires no input but receives remote video; enabling later uses saved camera-b/mic-b preferences');

  const third = await setup(3);
  await third.evaluate(() => { window.__deny = 'videoinput'; });
  await third.getByRole('button', { name: 'Preview kamera', exact: true }).click();
  await third.getByRole('alert').filter({ hasText: 'izin belum diberikan' }).waitFor();
  assert.equal(await third.getByRole('button', { name: 'Kamera saat bergabung', exact: true }).getAttribute('aria-pressed'), 'false');
  await join(third); await third.waitForFunction(() => window.__captures.some(capture => capture.kind === 'audioinput' && capture.track.readyState === 'live'));
  assert.equal(await third.evaluate(() => window.__requests.filter(request => request.kind === 'videoinput').length), 1);
  await first.getByText('3 peserta', { exact: true }).waitFor();
  checks.push('camera permission denial disables initial camera while audio-only join succeeds with three real LiveKit participants');

  const cancel = await setup(4);
  await cancel.evaluate(() => { window.__waitFor = 'videoinput'; });
  await cancel.getByRole('button', { name: 'Preview kamera', exact: true }).click();
  await cancel.getByRole('button', { name: 'Batalkan preview', exact: true }).waitFor();
  await cancel.getByRole('button', { name: 'Beranda', exact: true }).click();
  await cancel.evaluate(() => window.__resolveCapture());
  await cancel.waitForFunction(() => window.__captures.length === 1 && window.__captures.every(capture => capture.track.readyState === 'ended'));
  await lobby(cancel, 4);
  assert.equal(await cancel.getByRole('button', { name: 'Preview kamera', exact: true }).count(), 1);
  await cancel.getByRole('button', { name: 'Preview kamera', exact: true }).click(); await frames(cancel);
  await cancel.evaluate(() => { window.__devices = window.__devices.filter(device => device.deviceId !== 'camera-a'); navigator.mediaDevices.dispatchEvent(new Event('devicechange')); });
  await cancel.getByRole('alert').filter({ hasText: 'terputus' }).waitFor();
  assert.equal(await cancel.locator('.prejoin-video').isHidden(), true);
  checks.push('cancel/navigation cleans late capture and returning lobby works; unplugging active camera clears preview and disables call camera');

  await cancel.evaluate(() => { window.__deny = 'audioinput'; });
  await cancel.getByRole('button', { name: 'Uji suara', exact: true }).click();
  await cancel.getByRole('alert').filter({ hasText: 'Mikrofon: izin' }).waitFor();
  assert.equal(await cancel.getByRole('button', { name: 'Mikrofon saat bergabung', exact: true }).getAttribute('aria-pressed'), 'false');
  await cancel.evaluate(() => { window.__deny = null; });
  await cancel.getByRole('button', { name: 'Uji suara', exact: true }).click();
  await cancel.getByRole('button', { name: 'Hentikan uji', exact: true }).waitFor();
  await cancel.getByRole('button', { name: 'Hentikan uji', exact: true }).click();
  assert.equal(await cancel.getByRole('button', { name: 'Mikrofon saat bergabung', exact: true }).getAttribute('aria-pressed'), 'true');
  await cancel.waitForFunction(() => window.__captures.every(capture => capture.track.readyState === 'ended') && window.__contexts.every(context => context.state === 'closed'));
  checks.push('microphone denial disables initial mic; explicit test retry succeeds; stopping test retains call preference and releases track/analyser');

  let releaseCancelled, startedCancelled;
  const cancelGate = new Promise(resolve => { releaseCancelled = resolve; }), cancelRequest = new Promise(resolve => { startedCancelled = resolve; });
  await cancel.route('**/api/token', async route => { startedCancelled(); await cancelGate; await route.fulfill({ status: 500, json: { error: 'Cancelled synthetic token request' } }); });
  await cancel.getByRole('button', { name: 'Mulai rapat', exact: true }).click(); await cancelRequest;
  await cancel.getByRole('button', { name: 'Beranda', exact: true }).click(); releaseCancelled();
  await cancel.waitForResponse(response => response.url().endsWith('/api/token'));
  await cancel.getByRole('button', { name: 'Buat rapat', exact: true }).click();
  assert.equal(await cancel.getByRole('alert').count(), 0);
  // Expected HTTP 500 from the explicitly cancelled token fixture above is not a UI exception.
  const expectedCancelledErrors = errors.filter(error => error.participant === 4 && /500 \(Internal Server Error\)/.test(error.message));
  assert.ok(expectedCancelledErrors.length <= 1);
  const unexpected = errors.filter(error => !expectedCancelledErrors.includes(error));
  await cancel.unroute('**/api/token');
  let releaseSuccess, successStarted;
  const successGate = new Promise(resolve => { releaseSuccess = resolve; }), successRequest = new Promise(resolve => { successStarted = resolve; });
  await cancel.route('**/api/token', async route => { successStarted(); await successGate; await route.fulfill({ json: { token: 'cancelled-token-fixture', url: 'ws://127.0.0.1:7880', meetingId: 'cancelled-fixture', sttProvider: 'browser' } }); });
  await cancel.getByRole('button', { name: 'Mulai rapat', exact: true }).click(); await successRequest;
  await cancel.getByRole('button', { name: 'Beranda', exact: true }).click();
  const successResponse = cancel.waitForResponse(response => response.url().endsWith('/api/token'));
  releaseSuccess(); await successResponse;
  await cancel.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await cancel.locator('.call-room').count(), 0); assert.equal(await cancel.locator('.lobby-page').count(), 0);
  await cancel.getByRole('button', { name: 'Buat rapat', exact: true }).click();
  assert.equal(await cancel.getByRole('alert').count(), 0);
  checks.push('navigation invalidates pending join so late success/failure cannot reopen call or contaminate a fresh lobby');

  for (const page of [third, second, first]) { await leave(page); await page.waitForFunction(() => window.__captures.every(capture => capture.track.readyState === 'ended')); }
  checks.push('leaving all participants releases call media; no uncaught browser errors or unexpected console errors');
  assert.deepEqual(errors.filter(error => !expectedCancelledErrors.includes(error)), []);
  const result = { date: new Date().toISOString(), status: 'passed', media: 'synthetic canvas camera, oscillator microphone, device/permission/hotplug fixtures; real browser analyser/preview and local LiveKit WebRTC; speech recognition stubbed; physical hardware not tested', checks, errors: unexpected };
  await writeFile(new URL('../artifacts/PREJOIN_VERIFICATION.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  for (let index = 0; index < pages.length; index++) await pages[index].screenshot({ path: fileURLToPath(new URL(`prejoin-failed-${index + 1}.png`, output)), fullPage: true }).catch(() => {});
  console.error(JSON.stringify({ status: 'failed', checks, errors, message: error.message }, null, 2)); process.exitCode = 1;
} finally { for (const page of pages) await leave(page).catch(() => {}); await browser.close(); }
