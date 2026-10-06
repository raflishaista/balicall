// Run against the local app/API/LiveKit server using synthetic Chromium media.
// Supply PLAYWRIGHT_MODULE_PATH when Playwright is installed outside the project.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const baseUrl = process.env.CAMERA_TEST_URL || 'http://127.0.0.1:5187';
const output = new URL('../docs/screenshots/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  channel: process.env.CAMERA_TEST_BROWSER || (process.platform === 'win32' ? 'msedge' : undefined),
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const pages = [];
const pageErrors = [];
const consoleMessages = [];
const runId = Date.now();
const room = `camera-check-${runId}`;
const checks = [];

async function participant(number, cameraFailure = null) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await context.addInitScript(failure => {
    window.__cameraTestFailure = failure;
    window.__cameraTestTracks = [];
    window.__cameraTestStops = [];
    window.__cameraTestRequests = [];
    window.__cameraTestRecognitionStarts = 0;
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      if (constraints.video && window.__cameraTestFailure === 'PendingPermission') {
        await new Promise(resolve => { window.__cameraTestResumePermission = resolve; });
      }
      if (constraints.video && window.__cameraTestFailure) {
        throw new DOMException('Synthetic camera failure', window.__cameraTestFailure);
      }
      let stream;
      try {
        if (constraints.video && !constraints.audio) {
          // Deterministic video fixture, independent of the host's webcam driver.
          const canvas = document.createElement('canvas');
          canvas.width = 640; canvas.height = 360;
          const ctx = canvas.getContext('2d');
          const draw = () => {
            ctx.fillStyle = '#183b55'; ctx.fillRect(0, 0, 640, 360);
            ctx.fillStyle = '#126de7'; ctx.beginPath(); ctx.arc(320, 155, 72, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#ffffff'; ctx.font = '24px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('Camera test', 320, 160);
            ctx.font = '16px sans-serif'; ctx.fillText(new Date().toISOString(), 320, 280);
          };
          draw();
          stream = canvas.captureStream(10);
          const timer = setInterval(draw, 100);
          const track = stream.getVideoTracks()[0], stop = track.stop.bind(track);
          track.stop = () => { clearInterval(timer); stop(); };
        } else stream = await getUserMedia(constraints);
      }
      catch (error) { window.__cameraTestRequests.push({ constraints, error: error.name, message: error.message }); throw error; }
      window.__cameraTestRequests.push({ constraints, videoLabels: stream.getVideoTracks().map(track => track.label) });
      for (const track of stream.getVideoTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => { window.__cameraTestStops.push(new Error('Camera stopped').stack); stop(); };
      }
      window.__cameraTestTracks.push(...stream.getVideoTracks());
      return stream;
    };
    // Isolate camera tests from the browser's external speech recognition service.
    class TestRecognition {
      start() { this.active = true; window.__cameraTestRecognitionStarts++; queueMicrotask(() => { if (this.active) this.onstart?.(); }); }
      stop() { this.active = false; queueMicrotask(() => this.onend?.()); }
      abort() { this.active = false; }
    }
    window.SpeechRecognition = TestRecognition;
    window.webkitSpeechRecognition = TestRecognition;
  }, cameraFailure);
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push({ participant: number, message: error.message }));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) consoleMessages.push({ participant: number, type: message.type(), text: message.text() }); });
  if (process.env.CAMERA_TEST_DEBUG) page.on('console', message => console.log(message.text()));
  pages.push(page);
  await page.goto(baseUrl);
  if (process.env.CAMERA_TEST_DEBUG) await page.evaluate(async () => {
    const sdkUrl = performance.getEntriesByType('resource').find(entry => entry.name.includes('/livekit-client.js'))?.name;
    if (sdkUrl) (await import(sdkUrl)).setLogLevel('debug');
  });
  await page.getByRole('button', { name: 'Buat rapat', exact: true }).click();
  await page.getByLabel('NIK karyawan').fill(`CAM-${runId}-${number}`);
  await page.getByLabel('Nama lengkap').fill(`Camera Tester ${number}`);
  await page.getByLabel('Departemen').selectOption('IT Operations');
  await page.getByLabel('Nama ruang rapat').fill(room);
  await page.getByRole('button', { name: 'Mulai rapat', exact: true }).click();
  await page.getByText('Terhubung', { exact: true }).waitFor({ timeout: 20000 });
  return page;
}

async function videoCount(page, expected) {
  await page.waitForFunction(count => {
    const videos = [...document.querySelectorAll('.participant-video')];
    return videos.length === count && videos.every(video => video.videoWidth > 0 && video.readyState >= 2);
  }, expected, { timeout: 20000 });
}

try {
  const first = await participant(1);
  await videoCount(first, 1);
  checks.push('local camera publishes and renders real synthetic video frames');

  const second = await participant(2);
  await videoCount(first, 2);
  await videoCount(second, 2);
  const orientations = await first.locator('.participant-video').evaluateAll(videos => videos.map(video => ({ local: video.classList.contains('is-local-video'), transform: getComputedStyle(video).transform })));
  assert.ok(orientations.find(video => video.local)?.transform.includes('-1'));
  assert.equal(orientations.find(video => !video.local)?.transform, 'none');
  checks.push('two participants receive local/remote video; only local preview is mirrored');
  await first.screenshot({ path: fileURLToPath(new URL('camera-on-desktop.png', output)), fullPage: true });

  const recognitionStarts = await first.evaluate(() => window.__cameraTestRecognitionStarts);
  await first.getByRole('button', { name: 'Matikan kamera', exact: true }).click();
  await videoCount(first, 1);
  await videoCount(second, 1);
  await first.locator('.participant-tile').filter({ hasText: 'Camera Tester 1' }).getByText('Kamera mati', { exact: true }).waitFor();
  assert.equal(await first.evaluate(() => window.__cameraTestTracks.every(track => track.readyState === 'ended')), true);
  assert.equal(await first.getByRole('button', { name: 'Matikan mikrofon', exact: true }).count(), 1);
  checks.push('camera off restores initials on both clients and releases the local camera without muting microphone');
  await first.screenshot({ path: fileURLToPath(new URL('camera-off-desktop.png', output)), fullPage: true });

  await first.getByRole('button', { name: 'Aktifkan kamera', exact: true }).click();
  await videoCount(first, 2);
  await videoCount(second, 2);
  assert.equal(await first.evaluate(() => window.__cameraTestRecognitionStarts), recognitionStarts);
  await first.getByRole('button', { name: 'Matikan mikrofon', exact: true }).click();
  await first.getByRole('button', { name: 'Aktifkan mikrofon', exact: true }).waitFor();
  await videoCount(second, 2);
  await first.getByRole('button', { name: 'Aktifkan mikrofon', exact: true }).click();
  checks.push('camera can be enabled again; camera toggle preserves the speech recognizer and mic mute preserves video');

  const third = await participant(3, 'NotAllowedError');
  await third.getByRole('alert').filter({ hasText: 'Izin kamera belum diberikan' }).waitFor();
  await videoCount(third, 2);
  assert.equal(await third.getByRole('button', { name: 'Matikan mikrofon', exact: true }).count(), 1);
  assert.equal(await third.getByRole('alert').filter({ hasText: 'Mikrofon tidak tersedia' }).count(), 0);
  checks.push('initial camera permission denial keeps audio connected and displays a camera-specific error');

  await third.evaluate(() => { window.__cameraTestFailure = 'NotFoundError'; });
  await third.getByRole('button', { name: 'Coba kamera lagi', exact: true }).click();
  await third.getByRole('alert').filter({ hasText: 'Kamera tidak ditemukan' }).waitFor();
  checks.push('missing camera is handled with an audio fallback');

  await third.evaluate(() => { window.__cameraTestFailure = null; });
  await third.getByRole('button', { name: 'Coba kamera lagi', exact: true }).click();
  await videoCount(third, 3);
  await videoCount(first, 3);
  assert.equal(await third.getByRole('alert').filter({ hasText: /Izin kamera|Kamera tidak ditemukan/ }).count(), 0);
  checks.push('retry after camera permission/device failure restores video and clears the error');

  await third.evaluate(() => {
    window.__cameraTestFailure = 'NotFoundError';
    const track = window.__cameraTestTracks.findLast(track => track.readyState === 'live');
    track.stop(); track.dispatchEvent(new Event('ended'));
  });
  await third.getByRole('button', { name: 'Aktifkan kamera', exact: true }).waitFor();
  await videoCount(first, 2);
  await third.locator('.participant-tile').filter({ hasText: 'Camera Tester 3' }).getByText('Kamera mati', { exact: true }).waitFor();
  assert.equal(await third.getByRole('button', { name: 'Matikan mikrofon', exact: true }).count(), 1);
  await third.evaluate(() => { window.__cameraTestFailure = null; });
  await third.getByRole('button', { name: 'Aktifkan kamera', exact: true }).click();
  await videoCount(first, 3);
  await videoCount(third, 3);
  checks.push('interrupted camera track falls back to initials, preserves microphone, and can be restored');

  await third.setViewportSize({ width: 390, height: 844 });
  await third.screenshot({ path: fileURLToPath(new URL('camera-mobile.png', output)), fullPage: true });
  assert.equal(await third.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  checks.push('three-participant mobile layout has no horizontal overflow');

  await first.getByRole('button', { name: 'Keluar', exact: true }).click();
  await first.getByRole('heading', { name: /^Selamat/ }).waitFor({ timeout: 15000 });
  assert.equal(await first.evaluate(() => window.__cameraTestTracks.every(track => track.readyState === 'ended')), true);
  await videoCount(second, 2);
  checks.push('leaving releases camera tracks and removes the participant video from the other client');

  const latePermission = await participant(4, 'PendingPermission');
  await latePermission.waitForFunction(() => Boolean(window.__cameraTestResumePermission));
  await latePermission.getByRole('button', { name: 'Keluar', exact: true }).click();
  await latePermission.getByRole('heading', { name: /^Selamat/ }).waitFor();
  await latePermission.evaluate(() => { window.__cameraTestFailure = null; window.__cameraTestResumePermission(); });
  await latePermission.waitForFunction(() => window.__cameraTestTracks.length > 0 && window.__cameraTestTracks.every(track => track.readyState === 'ended'), undefined, { timeout: 10000 });
  checks.push('initial camera permission resolving after leaving does not leave an active camera track');
  assert.deepEqual(pageErrors, []);
  checks.push('no uncaught browser errors');
  const report = { date: new Date().toISOString(), status: 'passed', browser: process.env.CAMERA_TEST_BROWSER || (process.platform === 'win32' ? 'msedge' : 'chromium'), media: 'canvas camera fixture and Chromium fake microphone with real local LiveKit WebRTC transport; speech recognition stubbed', checks, pageErrors };
  await writeFile(new URL('../docs/CAMERA_VERIFICATION.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  for (const [index, page] of pages.entries()) {
    if (page.isClosed()) continue;
    await page.screenshot({ path: fileURLToPath(new URL(`camera-failure-${index + 1}.png`, output)), fullPage: true }).catch(() => {});
    console.log(JSON.stringify({ participant: index + 1, diagnostics: await page.evaluate(() => ({
      text: document.body.innerText,
      stops: window.__cameraTestStops,
      requests: window.__cameraTestRequests,
      tracks: window.__cameraTestTracks.map(track => ({ readyState: track.readyState, muted: track.muted, enabled: track.enabled })),
      videos: [...document.querySelectorAll('video')].map(video => ({ width: video.videoWidth, readyState: video.readyState, error: video.error?.message })),
    })), pageErrors, consoleMessages }, null, 2));
  }
  throw error;
} finally {
  // Leave through the app so test attendees do not remain in the attendance store.
  for (const page of pages) {
    try {
      await page.setViewportSize({ width: 1440, height: 960 });
      const leave = page.getByRole('button', { name: 'Keluar', exact: true });
      if (await leave.count()) {
        await leave.click({ timeout: 3000 });
        await page.getByRole('heading', { name: /^Selamat/ }).waitFor({ timeout: 5000 });
      }
    } catch { /* Browser close still disconnects media if app cleanup failed. */ }
  }
  await browser.close();
}
