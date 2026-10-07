// Synthetic devices/permissions/sinks; actual LiveKit room, WebRTC, and MediaRecorder.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const baseUrl = process.env.DEVICE_TEST_URL || 'http://127.0.0.1:5187';
const output = new URL('../artifacts/screenshots/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.DEVICE_TEST_BROWSER || (process.platform === 'win32' ? 'msedge' : undefined), args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const pages = [], checks = [], errors = [], uploads = [];
const runId = Date.now(), room = `devices-check-${runId}`;

async function participant(number, unsupportedOutput = false) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await context.addInitScript(({ unsupportedOutput }) => {
    window.__devices = [
      { kind: 'audioinput', deviceId: 'mic-a', groupId: 'a', label: 'Microphone A' },
      { kind: 'audioinput', deviceId: 'mic-b', groupId: 'b', label: 'Headset microphone B' },
      { kind: 'videoinput', deviceId: 'camera-a', groupId: 'c', label: 'Camera A' },
      { kind: 'videoinput', deviceId: 'camera-b', groupId: 'd', label: 'USB Camera B' },
      { kind: 'audiooutput', deviceId: 'default', groupId: 'a', label: 'Default speaker' },
      { kind: 'audiooutput', deviceId: 'speaker-b', groupId: 'b', label: 'Headphones B' },
    ];
    window.__mediaTracks = []; window.__requests = []; window.__sinkCalls = []; window.__recorders = [];
    window.__failure = null; window.__recognitionStarts = 0;
    navigator.mediaDevices.enumerateDevices = async () => window.__devices.map(d => ({ ...d, toJSON() { return this; } }));
    navigator.mediaDevices.getUserMedia = async constraints => {
      const kind = constraints.video ? 'videoinput' : 'audioinput';
      const option = constraints.video || constraints.audio;
      const requested = typeof option?.deviceId === 'string' ? option.deviceId : option?.deviceId?.exact || option?.deviceId?.ideal;
      const id = !requested || requested === 'default' ? window.__devices.find(d => d.kind === kind)?.deviceId : requested;
      window.__requests.push({ kind, id });
      if (window.__pendingDevice === id) await new Promise(resolve => { window.__resumeDeviceCapture = resolve; });
      if (window.__failure === id) { window.__failure = null; throw new DOMException('Synthetic permission denial', 'NotAllowedError'); }
      if (!window.__devices.some(d => d.kind === kind && d.deviceId === id)) throw new DOMException('Synthetic device unplugged', 'NotFoundError');
      let stream, cleanup;
      if (constraints.video) {
        const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
        const ctx = canvas.getContext('2d');
        const draw = () => { ctx.fillStyle = id === 'camera-b' ? '#006b9f' : '#173a54'; ctx.fillRect(0, 0, 640, 360); ctx.fillStyle = '#ffffff'; ctx.font = '28px sans-serif'; ctx.fillText(id, 220, 150); ctx.font = '16px sans-serif'; ctx.fillText(new Date().toISOString(), 180, 260); };
        draw(); const timer = setInterval(draw, 100); stream = canvas.captureStream(10); cleanup = () => clearInterval(timer);
      } else {
        const ctx = new AudioContext(), oscillator = ctx.createOscillator(), gain = ctx.createGain(), dest = ctx.createMediaStreamDestination();
        gain.gain.value = .15; oscillator.frequency.value = id === 'mic-b' ? 650 : 440;
        oscillator.connect(gain); gain.connect(dest); oscillator.start(); stream = dest.stream;
        cleanup = () => { oscillator.stop(); void ctx.close().catch(() => {}); };
      }
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track), settings = track.getSettings.bind(track);
        let stopped = false;
        track.getSettings = () => ({ ...settings(), deviceId: id, groupId: id });
        track.stop = () => { if (!stopped) { stopped = true; cleanup(); } stop(); };
        window.__mediaTracks.push(track);
      }
      return stream;
    };
    navigator.mediaDevices.getDisplayMedia = async () => navigator.mediaDevices.getUserMedia({ video: true });
    if (unsupportedOutput) delete HTMLMediaElement.prototype.setSinkId;
    else HTMLMediaElement.prototype.setSinkId = async function(id) { this.__fixtureSink = id; window.__sinkCalls.push({ id, tag: this.tagName }); };
    class Recognition {
      start() { this.active = true; window.__recognitionStarts++; queueMicrotask(() => { if (this.active) this.onstart?.(); }); }
      stop() { this.active = false; queueMicrotask(() => this.onend?.()); }
      abort() { this.active = false; }
    }
    window.SpeechRecognition = Recognition; window.webkitSpeechRecognition = Recognition;
    const Recorder = window.MediaRecorder;
    window.MediaRecorder = class extends Recorder { constructor(stream, options) { super(stream, options); window.__recorders.push({ recorder: this, trackIds: stream.getTracks().map(t => t.id) }); } };
  }, { unsupportedOutput });
  const page = await context.newPage(); pages.push(page);
  page.on('pageerror', error => errors.push({ participant: number, message: error.message }));
  // Enable only the server recorder UI; no office STT/LLM is called by this test.
  await page.route('**/api/health', async route => { const response = await route.fetch(); await route.fulfill({ response, json: { ...await response.json(), sttConfigured: true } }); });
  if (number === 1) await page.route('**/api/token', async route => { const response = await route.fetch(); await route.fulfill({ response, json: { ...await response.json(), sttProvider: 'server' } }); });
  await page.route('**/api/meetings/*/audio', async route => {
    uploads.push({ participant: number, bytes: route.request().postDataBuffer()?.length || 0 });
    await route.fulfill({ json: { accepted: true } });
  });
  await page.goto(baseUrl);
  await page.getByRole('button', { name: 'Buat rapat', exact: true }).click();
  await page.getByLabel('NIK karyawan').fill(`DEV-${runId}-${number}`);
  await page.getByLabel('Nama lengkap').fill(`Device Tester ${number}`);
  await page.getByLabel('Departemen').selectOption('IT Operations');
  await page.getByLabel('Nama ruang rapat').fill(room);
  await page.getByRole('button', { name: 'Mulai rapat', exact: true }).click();
  await page.getByText('Terhubung', { exact: true }).waitFor({ timeout: 20000 });
  return page;
}

async function cameraFrames(page, count) {
  await page.waitForFunction(count => {
    const videos = [...document.querySelectorAll('.participant-video')];
    return videos.length === count && videos.every(v => v.readyState >= 2 && v.videoWidth > 0);
  }, count, { timeout: 20000 });
}
async function open(page) { await page.getByRole('button', { name: 'Pengaturan perangkat', exact: true }).click(); await page.getByRole('dialog', { name: 'Perangkat audio & video', exact: true }).waitFor(); }
async function close(page) { await page.getByRole('button', { name: 'Tutup pengaturan perangkat', exact: true }).click(); }
async function select(page, label, value, message) {
  await page.getByLabel(label, { exact: true }).selectOption(value);
  await page.getByRole('status').filter({ hasText: message }).waitFor();
}
async function leave(page) {
  const dialog = page.getByRole('dialog', { name: 'Perangkat audio & video', exact: true }); if (await dialog.count()) await close(page);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole('button', { name: 'Keluar', exact: true }).click();
  await page.getByRole('heading', { name: /^Selamat/ }).waitFor({ timeout: 15000 });
}

try {
  const first = await participant(1), second = await participant(2, true);
  await cameraFrames(first, 2); await cameraFrames(second, 2);
  await open(first);
  assert.equal(await first.getByLabel('Mikrofon', { exact: true }).inputValue(), 'mic-a');
  assert.equal(await first.getByLabel('Kamera', { exact: true }).inputValue(), 'camera-a');
  assert.equal(await first.getByLabel('Speaker / headphone', { exact: true }).inputValue(), 'default');
  assert.equal(await first.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Tutup pengaturan perangkat');
  for (let i = 0; i < 10; i++) { await first.keyboard.press('Tab'); assert.equal(await first.evaluate(() => document.querySelector('dialog').contains(document.activeElement)), true); }
  await first.keyboard.press('Escape');
  assert.equal(await first.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Pengaturan perangkat');
  checks.push('native modal shows actual choices, traps keyboard focus, Escape closes, and returns focus to trigger');

  await first.getByRole('button', { name: 'Bagikan layar', exact: true }).click();
  await second.locator('.screen-share-video').waitFor();
  await open(first);
  await select(first, 'Kamera', 'camera-b', 'Kamera berhasil dipilih');
  await cameraFrames(second, 2);
  assert.equal(await first.getByLabel('Kamera', { exact: true }).inputValue(), 'camera-b');
  const beforeUpload = uploads.length;
  await select(first, 'Mikrofon', 'mic-b', 'Mikrofon berhasil dipilih');
  await first.waitForFunction(() => {
    const active = window.__recorders.filter(r => r.recorder.state === 'recording');
    const track = window.__mediaTracks.findLast(t => t.kind === 'audio' && t.readyState === 'live');
    return active.length === 1 && active[0].trackIds[0] === track.id && track.getSettings().deviceId === 'mic-b';
  });
  assert.ok(uploads.length > beforeUpload); assert.ok(uploads.every(upload => upload.bytes > 0));
  await first.waitForFunction(() => parseFloat(document.querySelector('.device-input-meter b')?.style.width) > 0);
  assert.equal(await first.getByLabel('Mikrofon', { exact: true }).inputValue(), 'mic-b');
  assert.equal(await second.locator('.screen-share-video').count(), 1);
  checks.push('active camera/mic switch through SDK without leaving; remote video and screen share survive; microphone meter stays active; real server-mode MediaRecorder flushes old audio and records new microphone exactly once');

  await select(first, 'Speaker / headphone', 'speaker-b', 'Speaker berhasil dipilih');
  assert.equal(await first.locator('audio').evaluateAll(elements => elements.every(el => el.__fixtureSink === 'speaker-b')), true);
  await first.screenshot({ path: fileURLToPath(new URL('device-settings-desktop.png', output)), fullPage: true });
  const third = await participant(3);
  await cameraFrames(first, 3);
  await first.waitForFunction(() => document.querySelectorAll('audio').length === 2 && [...document.querySelectorAll('audio')].every(el => el.__fixtureSink === 'speaker-b'));
  checks.push('selected speaker applied to current and newly joined remote audio tracks through a simulated setSinkId; no extra audio renderers');

  await first.evaluate(() => { window.__failure = 'camera-a'; });
  await first.getByLabel('Kamera', { exact: true }).selectOption('camera-a');
  await first.getByRole('alert').filter({ hasText: 'Pilihan sebelumnya dipulihkan' }).waitFor();
  assert.equal(await first.getByLabel('Kamera', { exact: true }).inputValue(), 'camera-b');
  await cameraFrames(second, 3);
  checks.push('permission failure during active camera switch recovers prior device and reports failure without claiming requested camera is active');

  await first.evaluate(() => { window.__devices = window.__devices.filter(d => d.deviceId !== 'mic-b'); navigator.mediaDevices.dispatchEvent(new Event('devicechange')); });
  await first.getByText('Perangkat tidak ditemukan dalam daftar. Pilih perangkat lain atau sambungkan kembali.').waitFor();
  await select(first, 'Mikrofon', 'mic-a', 'Mikrofon berhasil dipilih');
  await first.evaluate(() => { window.__devices.push({ kind: 'audioinput', deviceId: 'mic-b', groupId: 'b', label: '' }); navigator.mediaDevices.dispatchEvent(new Event('devicechange')); });
  await first.getByLabel('Mikrofon', { exact: true }).getByRole('option', { name: 'Mikrofon 2', exact: true }).waitFor({ state: 'attached' });
  checks.push('devicechange updates unplug/replug list, missing choice is disclosed, alternate microphone restores recording, and hidden labels get readable fallback');

  await close(first);
  await first.getByRole('button', { name: 'Matikan kamera', exact: true }).click();
  await first.getByRole('button', { name: 'Matikan mikrofon', exact: true }).click();
  await first.getByRole('button', { name: 'Aktifkan mikrofon', exact: true }).waitFor();
  const captures = await first.evaluate(() => window.__requests.length);
  await open(first);
  await select(first, 'Kamera', 'camera-a', 'Kamera berhasil dipilih. Kamera tetap nonaktif');
  await select(first, 'Mikrofon', 'mic-b', 'Mikrofon berhasil dipilih. Mikrofon tetap nonaktif');
  assert.equal(await first.evaluate(() => window.__requests.length), captures);
  await close(first);
  await first.getByRole('button', { name: 'Aktifkan kamera', exact: true }).click();
  await first.getByRole('button', { name: 'Aktifkan mikrofon', exact: true }).click();
  await cameraFrames(second, 3);
  await first.waitForFunction(() => window.__mediaTracks.some(t => t.kind === 'audio' && t.readyState === 'live' && t.getSettings().deviceId === 'mic-b'));
  checks.push('device choices while mic/camera are off do not acquire media or unmute; selected devices used when enabled again');

  await open(second);
  assert.equal(await second.getByLabel('Speaker / headphone', { exact: true }).isDisabled(), true);
  await second.getByText('Browser ini belum mendukung pemilihan speaker. Atur output melalui pengaturan suara sistem.').waitFor();
  await second.getByText('Transkripsi browser memakai input yang dipilih oleh browser dan belum tentu mengikuti mikrofon rapat ini. Mode transkripsi server mengikuti track mikrofon rapat.').waitFor();
  await second.setViewportSize({ width: 390, height: 844 });
  const bounds = await second.getByRole('dialog').boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y >= 0 && bounds.y + bounds.height <= 845);
  await second.screenshot({ path: fileURLToPath(new URL('device-settings-mobile.png', output)), fullPage: true });
  checks.push('unsupported output control is disabled with system guidance; browser-STT limitation explicit; modal fits 390px mobile');

  await open(first);
  await first.evaluate(() => { window.__pendingDevice = 'camera-b'; });
  await first.getByLabel('Kamera', { exact: true }).selectOption('camera-b');
  await first.waitForFunction(() => Boolean(window.__resumeDeviceCapture));
  await leave(first);
  await first.evaluate(() => { window.__pendingDevice = null; window.__resumeDeviceCapture(); });
  await first.waitForFunction(() => window.__mediaTracks.every(t => t.readyState === 'ended'));
  await cameraFrames(second, 2);
  checks.push('leaving during a pending camera switch releases late capture, all previously acquired media, and the remote participant');
  assert.deepEqual(errors, []); checks.push('no uncaught browser errors');
  const report = { date: new Date().toISOString(), status: 'passed', media: 'synthetic enumerated devices, canvas video, oscillator microphones, simulated output sinks/permission failure/hotplug; real local LiveKit WebRTC and MediaRecorder; audio API responses stubbed; physical devices and speakers not tested', checks, errors };
  await writeFile(new URL('../artifacts/DEVICE_SETTINGS_VERIFICATION.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  for (const [index, page] of pages.entries()) {
    if (page.isClosed()) continue;
    await page.screenshot({ path: fileURLToPath(new URL(`device-settings-failure-${index + 1}.png`, output)), fullPage: true }).catch(() => {});
    console.log(JSON.stringify({ participant: index + 1, text: await page.locator('body').innerText(), errors }, null, 2));
  }
  throw error;
} finally {
  for (const page of pages) { try { if (await page.getByRole('button', { name: 'Keluar', exact: true }).count()) await leave(page); } catch { /* Browser close disconnects. */ } }
  await browser.close();
}
