// UI checks against real local LiveKit; synthetic capture, track-loss, and permission fixtures.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const url = process.env.MEDIA_TEST_URL || 'http://127.0.0.1:5187';
const axePath = process.env.AXE_CORE_PATH;
if (!axePath) throw new Error('Set AXE_CORE_PATH to a local axe-core distribution before running.');
const output = new URL('../artifacts/screenshots/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.MEDIA_TEST_BROWSER || (process.platform === 'win32' ? 'msedge' : undefined), args: ['--autoplay-policy=no-user-gesture-required'] });
const pages = [], checks = [], errors = [], consoleErrors = [], accessibility = [], sizes = [];
const httpErrors = [], interrupted = new Set();
const runId = Date.now(), room = `media-qa-${runId}-koordinasi-jaringan-site-dan-vendor-` + 'timur-'.repeat(12);
async function participant(number, off = false) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(({ blockAudio }) => {
    window.__captures = []; window.__requests = []; window.__signalSockets = [];
    window.__devices = ['mic-a', 'mic-b', 'cam-a', 'cam-b'].map(deviceId => ({ deviceId, label: `Test ${deviceId}`, groupId: deviceId, kind: deviceId.startsWith('mic') ? 'audioinput' : 'videoinput' }));
    navigator.mediaDevices.enumerateDevices = async () => window.__devices.map(device => ({ ...device, toJSON() { return this; } }));
    window.__blockAudio = blockAudio;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function() {
      if (this.tagName === 'AUDIO' && window.__blockAudio) return Promise.reject(new DOMException('Controlled autoplay block', 'NotAllowedError'));
      return play.call(this);
    };
    const Socket = window.WebSocket;
    window.WebSocket = class extends Socket {
      constructor(...args) {
        super(...args);
        if (String(args[0]).includes(':7880/rtc')) {
          window.__signalSockets.push(this);
          this.addEventListener('open', () => { if (window.__dropSignals) this.close(4000, 'Controlled signal interruption'); });
        }
      }
    };
    const video = (deviceId, kind) => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
      const ctx = canvas.getContext('2d');
      const draw = () => { ctx.fillStyle = kind === 'screen' ? '#145d7e' : deviceId.endsWith('b') ? '#156a82' : '#213f5a'; ctx.fillRect(0, 0, 640, 360); ctx.fillStyle = '#ffffff'; ctx.font = '27px sans-serif'; ctx.fillText(`${kind} · ${deviceId}`, 190, 140); ctx.font = '18px sans-serif'; ctx.fillText(new Date().toISOString(), 165, 270); };
      draw(); const interval = setInterval(draw, 100), stream = canvas.captureStream(10);
      const track = stream.getVideoTracks()[0], stop = track.stop.bind(track), settings = track.getSettings.bind(track); let stopped = false;
      track.getSettings = () => ({ ...settings(), deviceId });
      track.stop = () => { if (!stopped) { stopped = true; clearInterval(interval); } stop(); };
      window.__captures.push({ track, kind, deviceId }); return stream;
    };
    navigator.mediaDevices.getUserMedia = async constraints => {
      const kind = constraints.video ? 'video' : 'audio', options = constraints.video || constraints.audio;
      const requested = typeof options?.deviceId === 'string' ? options.deviceId : options?.deviceId?.exact || options?.deviceId?.ideal;
      const deviceId = !requested || requested === 'default' ? (kind === 'video' ? 'cam-a' : 'mic-a') : requested;
      window.__requests.push({ kind, deviceId });
      if (window.__pauseNext === kind) { window.__pauseNext = null; await new Promise(resolve => { window.__releaseCapture = resolve; }); }
      if (kind === 'video') return video(deviceId, kind);
      const ctx = new AudioContext(), oscillator = ctx.createOscillator(), gain = ctx.createGain(), dest = ctx.createMediaStreamDestination();
      oscillator.frequency.value = deviceId.endsWith('b') ? 650 : 400; gain.gain.value = 0;
      oscillator.connect(gain); gain.connect(dest); oscillator.start(); window.__voiceGain = gain;
      const stream = dest.stream, track = stream.getAudioTracks()[0], stop = track.stop.bind(track); let stopped = false;
      track.getSettings = () => ({ deviceId });
      track.stop = () => { if (!stopped) { stopped = true; oscillator.stop(); void ctx.close().catch(() => {}); } stop(); };
      window.__captures.push({ track, kind, deviceId }); return stream;
    };
    navigator.mediaDevices.getDisplayMedia = async () => video('screen-source', 'screen');
    class Recognition { start() { this.active = true; queueMicrotask(() => { if (this.active) this.onstart?.(); }); } stop() { this.active = false; queueMicrotask(() => this.onend?.()); } abort() { this.active = false; } }
    window.SpeechRecognition = Recognition; window.webkitSpeechRecognition = Recognition;
  }, { blockAudio: number === 6 });
  const page = await context.newPage(); pages.push(page);
  page.on('pageerror', error => errors.push({ participant: number, message: error.message }));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ participant: number, message: message.text() }); });
  page.on('response', response => { if (response.status() >= 400 && response.url().includes('/api/')) httpErrors.push({ participant: number, status: response.status(), path: new URL(response.url()).pathname }); });
  await page.goto(url);
  await page.getByRole('button', { name: 'Buat rapat', exact: true }).click();
  await page.getByLabel('NIK karyawan').fill(`MEDIA-${runId}-${number}`);
  await page.getByLabel('Nama lengkap').fill(number === 3 ? 'Media Tester 3 — Koordinasi Operasional Infrastruktur dan Vendor Area Timur' : `Media Tester ${number}`);
  await page.getByLabel('Departemen').selectOption('IT Operations');
  await page.getByLabel('Nama ruang rapat').fill(room);
  if (off) {
    await page.getByRole('button', { name: 'Mikrofon saat bergabung', exact: true }).click();
    await page.getByRole('button', { name: 'Kamera saat bergabung', exact: true }).click();
  }
  if (number === 1) { await page.addScriptTag({ path: axePath }); await axe(page, 'lobby', ['.lobby-page']); }
  await page.getByRole('button', { name: 'Mulai rapat', exact: true }).click();
  await page.getByText('Terhubung', { exact: true }).waitFor({ timeout: 25000 });
  if (!off) await page.waitForFunction(() => [...document.querySelectorAll('.participant-video')].some(video => video.readyState >= 2));
  return page;
}
async function axe(page, state, include) {
  await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); });
  const result = await page.evaluate(async include => window.axe.run({ include }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } }), include);
  const violations = result.violations.map(item => ({ id: item.id, impact: item.impact, description: item.description, nodes: item.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }));
  accessibility.push({ state, axeVersion: result.testEngine.version, violations, incomplete: result.incomplete.map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) })) });
  console.log(JSON.stringify({ state, violations }));
}
async function layout(page, width, height, state) {
  await page.setViewportSize({ width, height });
  const result = await page.evaluate(() => {
    const bar = document.querySelector('.call-control-bar'), leave = document.querySelector('.leave-simple');
    const controls = [...bar.querySelectorAll('button')].map(button => {
      const rect = button.getBoundingClientRect(), parent = bar.getBoundingClientRect();
      return { label: button.getAttribute('aria-label') || button.textContent.trim(), width: rect.width, height: rect.height, withinBar: rect.left >= parent.left - 1 && rect.right <= parent.right + 1, shown: getComputedStyle(button).display !== 'none' };
    });
    return { pageFits: document.documentElement.scrollWidth <= innerWidth + 1, exitShown: getComputedStyle(leave).display !== 'none', controls };
  });
  assert.equal(result.pageFits, true); assert.equal(result.exitShown, true);
  assert.ok(result.controls.every(control => control.shown && control.withinBar && control.width >= 24 && control.height >= 44));
  sizes.push({ width, height, state, ...result });
}
async function screenshot(page, name) {
  await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); });
  await page.screenshot({ path: fileURLToPath(new URL(name, output)), fullPage: true });
}
async function leave(page) {
  if (await page.locator('.call-room').count()) { await page.getByRole('button', { name: 'Keluar', exact: true }).click(); await page.locator('.call-room').waitFor({ state: 'detached', timeout: 20000 }); }
}
async function dropSignal(page) {
  interrupted.add(pages.indexOf(page) + 1);
  await page.evaluate(() => {
    window.__dropSignals = true;
    for (const socket of window.__signalSockets) if (socket.readyState === WebSocket.OPEN) socket.close(4000, 'Controlled signal interruption');
  });
  await page.getByText('Menyambungkan kembali', { exact: true }).waitFor({ timeout: 20000 });
}
async function resumeSignal(page) {
  await page.evaluate(() => { window.__dropSignals = false; });
  await page.getByText('Terhubung', { exact: true }).waitFor({ timeout: 25000 });
}

try {
  const first = await participant(1), second = await participant(2), third = await participant(3);
  for (let index = 4; index <= 6; index++) await participant(index, true);
  await first.getByText('6 peserta', { exact: true }).waitFor();
  await first.waitForFunction(() => document.querySelectorAll('.participant-video').length === 3);
  const listener = pages[5];
  await listener.getByRole('button', { name: 'Aktifkan suara peserta', exact: true }).waitFor();
  await listener.evaluate(() => { window.__blockAudio = false; });
  await listener.getByRole('button', { name: 'Aktifkan suara peserta', exact: true }).click();
  await listener.getByRole('button', { name: 'Aktifkan suara peserta', exact: true }).waitFor({ state: 'hidden' });
  checks.push('autoplay rejection fixture exposes audio recovery button; user gesture starts existing remote audio and hides the prompt without extra renderers');
  for (const [width, height] of [[1440, 1000], [1280, 600], [1024, 768], [768, 1024], [390, 844], [320, 640], [844, 390]]) await layout(first, width, height, 'six participants');
  await layout(first, 1440, 1000, 'desktop'); await screenshot(first, 'media-qa-desktop.png');
  await axe(first, 'call transcript', ['.call-room']);
  checks.push('six-participant camera/avatar grid and all controls fit seven desktop/tablet/mobile/landscape sizes; Exit is available everywhere');

  const transcript = first.getByRole('tab', { name: 'Transkrip', exact: true }), attendance = first.getByRole('tab', { name: /Peserta/ });
  await transcript.focus(); await first.keyboard.press('ArrowRight');
  assert.equal(await attendance.getAttribute('aria-selected'), 'true'); assert.equal(await attendance.evaluate(tab => tab === document.activeElement), true);
  await first.keyboard.press('Home'); assert.equal(await transcript.getAttribute('aria-selected'), 'true');
  await first.keyboard.press('End'); assert.equal(await attendance.getAttribute('aria-selected'), 'true');
  await first.keyboard.press('ArrowLeft'); assert.equal(await transcript.getAttribute('aria-selected'), 'true');
  assert.equal(await first.getByRole('log', { name: 'Transkrip langsung' }).count(), 1);
  await first.getByRole('button', { name: 'Pengaturan perangkat', exact: true }).focus(); await first.keyboard.press('Enter');
  await first.getByRole('dialog').waitFor();
  for (let index = 0; index < 10; index++) { await first.keyboard.press(index % 2 ? 'Shift+Tab' : 'Tab'); assert.equal(await first.evaluate(() => document.querySelector('dialog').contains(document.activeElement)), true); }
  await axe(first, 'device dialog', ['.device-dialog']);
  await first.keyboard.press('Escape'); assert.equal(await first.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Pengaturan perangkat');
  checks.push('tab arrows/Home/End update focus/selection; transcript is a labelled log; device dialog traps focus and Escape restores trigger');

  const audioCheck = await first.evaluate(() => {
    const audio = [...document.querySelectorAll('audio')].flatMap(element => element.srcObject?.getAudioTracks().map(track => track.id) || []);
    const local = window.__captures.filter(capture => capture.kind === 'audio').map(capture => capture.track.id);
    return { count: audio.length, unique: new Set(audio).size, noLocalPlayback: audio.every(id => !local.includes(id)), mutedVideo: [...document.querySelectorAll('video')].every(video => video.muted) };
  });
  assert.equal(audioCheck.count, 2); assert.equal(audioCheck.unique, 2); assert.equal(audioCheck.noLocalPlayback, true); assert.equal(audioCheck.mutedVideo, true);
  checks.push('each remote microphone has one audio renderer, no local microphone playback, and camera/screen/preview videos are muted');

  await second.evaluate(() => { window.__voiceGain.gain.value = .2; });
  await first.waitForFunction(() => document.querySelector('.is-spotlight')?.getAttribute('aria-label') === 'Media Tester 2');
  await first.getByRole('button', { name: 'Bagikan layar', exact: true }).click();
  await second.locator('.screen-share-video').waitFor();
  await first.waitForFunction(() => document.querySelector('.screen-share-video')?.readyState >= 2);
  for (const [width, height] of [[1440, 1000], [1024, 768], [390, 844], [320, 640], [844, 390]]) await layout(first, width, height, 'screen share');
  await first.emulateMedia({ reducedMotion: 'reduce' }); await layout(first, 390, 844, 'mobile reduced motion');
  await screenshot(first, 'media-qa-mobile-share.png');
  const strip = first.getByRole('region', { name: 'Video peserta saat presentasi' }); await strip.focus(); await first.keyboard.press('End');
  await first.waitForFunction(() => document.querySelector('.participant-grid').scrollLeft > 0);
  assert.equal(await first.locator('.screen-share-video').evaluate(video => getComputedStyle(video).objectFit), 'contain');
  assert.equal(await first.locator('.screen-share-video').evaluate(video => getComputedStyle(video).transform), 'none');
  await first.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
  await axe(first, 'mobile screen share', ['.call-room']);
  checks.push('screen share takes main stage with contain/no mirror; mobile participant strip scrolls by keyboard; reduced motion stops animations');

  await second.evaluate(() => {
    const native = document.querySelector('.screen-share-video').srcObject.getVideoTracks()[0]; window.__lostScreen = native;
    Object.defineProperty(native, 'muted', { configurable: true, value: true }); native.dispatchEvent(new Event('mute'));
  });
  await second.getByText('Menunggu layar presenter tersambung kembali.', { exact: true }).waitFor();
  await second.evaluate(() => { delete window.__lostScreen.muted; window.__lostScreen.dispatchEvent(new Event('unmute')); });
  await second.waitForFunction(() => document.querySelector('.screen-share-video')?.readyState >= 2);
  await second.evaluate(() => {
    const native = document.querySelector('.participant-tile[aria-label="Media Tester 1"] video').srcObject.getVideoTracks()[0]; window.__lostCamera = native;
    Object.defineProperty(native, 'muted', { configurable: true, value: true }); native.dispatchEvent(new Event('mute'));
  });
  await second.locator('.participant-tile[aria-label="Media Tester 1"] .camera-placeholder').waitFor();
  await second.evaluate(() => { delete window.__lostCamera.muted; window.__lostCamera.dispatchEvent(new Event('unmute')); });
  await second.locator('.participant-tile[aria-label="Media Tester 1"] video').waitFor();
  checks.push('native mute/unmute fixtures show honest camera/screen fallback and recover without assigning media to another participant');

  await first.getByRole('button', { name: 'Hentikan berbagi layar', exact: true }).click(); await first.locator('.screen-share-stage').waitFor({ state: 'detached' });
  await layout(first, 1440, 1000, 'reconnect');
  await dropSignal(first);
  assert.equal(await first.getByRole('button', { name: 'Matikan kamera', exact: true }).isDisabled(), true);
  assert.equal(await first.getByRole('button', { name: 'Pengaturan perangkat', exact: true }).isDisabled(), true);
  await screenshot(first, 'media-qa-reconnecting.png');
  await resumeSignal(first); await first.getByRole('button', { name: 'Matikan kamera', exact: true }).waitFor();
  assert.equal(await first.getByRole('button', { name: 'Matikan kamera', exact: true }).isEnabled(), true);
  await first.waitForFunction(() => document.querySelectorAll('.participant-video').length === 3 && [...document.querySelectorAll('.participant-video')].every(video => video.readyState >= 2));
  checks.push('actual signaling WebSocket interruption displays reconnect state and disables media controls; SDK reconnect restores participants and camera controls');

  const lateCamera = pages[4];
  await lateCamera.evaluate(() => { window.__pauseNext = 'video'; });
  await lateCamera.getByRole('button', { name: 'Aktifkan kamera', exact: true }).click();
  await lateCamera.waitForFunction(() => Boolean(window.__releaseCapture));
  await dropSignal(lateCamera); await resumeSignal(lateCamera);
  await lateCamera.evaluate(() => window.__releaseCapture());
  await lateCamera.waitForFunction(() => window.__captures.some(capture => capture.kind === 'video') && window.__captures.filter(capture => capture.kind === 'video').every(capture => capture.track.readyState === 'ended'));
  assert.equal(await lateCamera.getByRole('button', { name: 'Aktifkan kamera', exact: true }).getAttribute('aria-pressed'), 'false');
  checks.push('camera permission begun before real reconnect resolves to a stopped track and is never published afterward');

  const lateMic = pages[3]; await lateMic.evaluate(() => { window.__pauseNext = 'audio'; });
  await lateMic.getByRole('button', { name: 'Aktifkan mikrofon', exact: true }).evaluate(button => { button.click(); button.click(); });
  await lateMic.waitForFunction(() => Boolean(window.__releaseCapture));
  assert.equal(await lateMic.getByRole('button', { name: 'Aktifkan mikrofon', exact: true }).getAttribute('aria-busy'), 'true');
  assert.equal(await lateMic.evaluate(() => window.__requests.filter(request => request.kind === 'audio').length), 1);
  await leave(lateMic); await lateMic.evaluate(() => window.__releaseCapture());
  await lateMic.waitForFunction(() => window.__captures.filter(capture => capture.kind === 'audio').every(capture => capture.track.readyState === 'ended'));
  await first.getByText('5 peserta', { exact: true }).waitFor();
  checks.push('rapid mic clicks produce one pending capture with busy/disabled feedback; leaving stops late permission before publication and removes participant');

  let releaseLeave, requestedLeave, leaveCount = 0;
  const leaveGate = new Promise(resolve => { releaseLeave = resolve; }), leaveRequest = new Promise(resolve => { requestedLeave = resolve; });
  await third.route('**/api/meetings/*/leave', async route => { leaveCount++; requestedLeave(); await leaveGate; await route.continue(); });
  await third.getByRole('button', { name: 'Keluar', exact: true }).evaluate(button => { button.click(); button.click(); }); await leaveRequest;
  assert.equal(await third.getByRole('button', { name: 'Matikan kamera', exact: true }).isDisabled(), true);
  assert.equal(leaveCount, 1); releaseLeave(); await third.locator('.call-room').waitFor({ state: 'detached' });
  checks.push('pending finish disables media controls and duplicate clicks send only one leave request');

  for (const page of pages) { await page.evaluate(() => { window.__dropSignals = false; }); await leave(page); await page.waitForFunction(() => window.__captures.every(capture => capture.track.readyState === 'ended')); }
  assert.deepEqual(errors, []);
  const violations = accessibility.flatMap(item => item.violations);
  const expectedTransportErrors = consoleErrors.filter(error => interrupted.has(error.participant) && /Websocket got closed during a \(re\)connection attempt/.test(error.message));
  const unexpectedConsoleErrors = consoleErrors.filter(error => !expectedTransportErrors.includes(error));
  assert.deepEqual(unexpectedConsoleErrors, []); assert.deepEqual(httpErrors, []);
  const result = { date: new Date().toISOString(), status: violations.length ? 'needs-accessibility-fixes' : 'passed', browser: { channel: process.env.MEDIA_TEST_BROWSER || (process.platform === 'win32' ? 'msedge' : 'chromium'), version: browser.version(), headless: true }, media: 'six sessions, real local LiveKit WebRTC/SFU and signaling reconnect; synthetic canvas/audio, late-permission and native mute/unmute fixtures; physical devices and real network handoff not tested', checks, sizes, accessibility, errors, consoleErrors: unexpectedConsoleErrors, expectedTransportErrors, httpErrors };
  await writeFile(new URL('../artifacts/MEDIA_EXPERIENCE_VERIFICATION.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ status: result.status, checks, violationCount: violations.length, errors, unexpectedConsoleErrors, httpErrors, expectedTransportErrorCount: expectedTransportErrors.length }, null, 2));
  assert.equal(violations.length, 0);
} catch (error) {
  for (let index = 0; index < pages.length; index++) await pages[index].screenshot({ path: fileURLToPath(new URL(`media-qa-failed-${index + 1}.png`, output)), fullPage: true }).catch(() => {});
  console.error(JSON.stringify({ status: 'failed', checks, accessibility, errors, consoleErrors, httpErrors, message: error.message, stack: error.stack }, null, 2)); process.exitCode = 1;
} finally { for (const page of pages) { await page.evaluate(() => { window.__dropSignals = false; }).catch(() => {}); await leave(page).catch(() => {}); } await browser.close(); }
