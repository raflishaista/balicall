// Preferences UI -> local storage -> reload -> prejoin -> actual LiveKit room.
// Media and recognition are fixtures. No company DB or Office LLM requests.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.DATABASE_URL = '';
const { createApp } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const key = 'sentra.meeting-preferences.v1';
const output = process.env.SETTINGS_SCREENSHOT_DIR || fileURLToPath(new URL('../artifacts/screenshots/', import.meta.url));
await mkdir(output, { recursive: true });
const reportPath = process.env.SETTINGS_REPORT_PATH || fileURLToPath(new URL('../artifacts/verification/SETTINGS_VERIFICATION.json', import.meta.url));
await mkdir(dirname(reportPath), { recursive: true });
const dataDirectory = await mkdtemp(join(tmpdir(), 'balicall-settings-test-'));
const config = { ...loadConfig({ LLM_PROVIDER: 'demo' }), dataFile: join(dataDirectory, 'meetings.json') };
const { app, store } = createApp(config);
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
config.corsOrigins.push(url);
const report = { status: 'failed', timestamp: new Date().toISOString(), checks: [], pageErrors: [], accessibility: [], source: 'workspace settings, scheduling and grid-first media layout', media: 'synthetic', database: 'disabled', llm: 'demo / simulated responses' };
let browser;
const sessions = [];
async function fixture(context) {
  await context.addInitScript(() => {
    window.__captures = []; window.__captureRequests = [];
    window.__devices = ['mic-a', 'mic-b', 'cam-a', 'cam-b', 'speaker-b'].map(deviceId => ({ deviceId, groupId: deviceId, label: `Test ${deviceId}`, kind: deviceId.startsWith('mic') ? 'audioinput' : deviceId.startsWith('cam') ? 'videoinput' : 'audiooutput' }));
    navigator.mediaDevices.enumerateDevices = async () => window.__devices.map(device => ({ ...device, toJSON() { return this; } }));
    HTMLMediaElement.prototype.setSinkId = async function(id) { window.__lastOutput = id; };
    navigator.mediaDevices.getUserMedia = async constraints => {
      window.__captureRequests.push(constraints);
      let stream, cleanup;
      const kind = constraints.video ? 'video' : 'audio';
      const capture = constraints.video || constraints.audio;
      const id = capture.deviceId?.exact || capture.deviceId?.ideal || (kind === 'video' ? 'cam-a' : 'mic-a');
      if (kind === 'video') {
        const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
        const draw = () => { const ctx = canvas.getContext('2d'); ctx.fillStyle = '#173f65'; ctx.fillRect(0, 0, 640, 360); ctx.fillStyle = '#fff'; ctx.font = '24px sans-serif'; ctx.fillText(`TEST camera ${id}`, 160, 180); };
        draw(); stream = canvas.captureStream(10); const timer = setInterval(draw, 100); cleanup = () => clearInterval(timer);
      } else {
        const ctx = new AudioContext(), osc = ctx.createOscillator(), gain = ctx.createGain(), dest = ctx.createMediaStreamDestination();
        gain.gain.value = 0; osc.connect(gain); gain.connect(dest); osc.start(); await ctx.resume(); stream = dest.stream;
        cleanup = () => { osc.stop(); void ctx.close().catch(() => {}); };
      }
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track); let stopped = false;
        track.getSettings = () => ({ deviceId: id, width: 640, height: 360, frameRate: 10, sampleRate: 48000, channelCount: 1 });
        track.stop = () => { if (!stopped) { stopped = true; cleanup(); } stop(); }; window.__captures.push(track);
      }
      return stream;
    };
    class Recognition {
      start() { this.active = true; window.__recognizer = this; queueMicrotask(() => this.onstart?.()); }
      stop() { this.active = false; queueMicrotask(() => this.onend?.()); }
      abort() { this.active = false; }
      emitFinal(text) { this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] }); }
    }
    window.SpeechRecognition = Recognition; window.webkitSpeechRecognition = Recognition;
  });
}
async function checkLayout(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No page overflow');
}
async function accessibility(page, state) {
  if (!process.env.AXE_CORE_PATH) return;
  await page.addScriptTag({ path: process.env.AXE_CORE_PATH });
  const results = await page.evaluate(async () => { const result = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } }); return { violations: result.violations.map(item => ({ id: item.id, impact: item.impact, targets: item.nodes.map(node => node.target) })), incomplete: result.incomplete.map(item => item.id) }; });
  report.accessibility.push({ state, ...results });
  assert.equal(results.violations.length, 0, JSON.stringify(results.violations));
}
async function joinRoom(page, roomName = `settings-qa-${Date.now()}`) {
  await page.getByLabel('NIK karyawan').fill('BT-10492');
  await page.getByLabel('Nama lengkap').fill('P1 Settings QA');
  await page.getByLabel('Departemen').selectOption('IT Operations');
  await page.locator('.lobby-card input').last().fill(roomName);
  const tokenResponse = page.waitForResponse(r => r.url().endsWith('/api/token'));
  await page.locator('.lobby-submit').click();
  const session = await (await tokenResponse).json(); sessions.push(session);
  await page.getByText('Terhubung', { exact: true }).waitFor({ timeout: 25000 });
  return session;
}
async function addLine(page, session) {
  await page.request.post(`${url}/api/meetings/${session.meetingId}/transcript`, { headers: { Authorization: `Bearer ${session.token}` }, data: { text: 'Fixture notulen: periksa konfigurasi perangkat rapat.' } });
  await page.locator('.live-transcript-entry').waitFor();
}
try {
  const health = await (await fetch(url + '/api/health')).json();
  assert.equal(health.livekitStatus, 'reachable'); assert.equal(health.llmEffectiveProvider, 'demo'); assert.equal(health.database.configured, false);
  browser = await chromium.launch({ headless: true, channel: process.env.SETTINGS_TEST_BROWSER || 'msedge', args: ['--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); await fixture(context);
  const page = await context.newPage(); page.on('pageerror', error => report.pageErrors.push(error.message));
  page.setDefaultTimeout(10000);
  await page.goto(url); await page.getByRole('button', { name: 'Pengaturan', exact: true }).click();
  await page.getByRole('heading', { name: 'Pengaturan', exact: true }).waitFor();
  await checkLayout(page); await accessibility(page, 'overview-desktop');
  await page.screenshot({ path: join(output, 'settings-overview-desktop.png'), fullPage: true });
  await page.getByLabel('Cari pengaturan').fill('Audio'); assert.equal(await page.locator('.settings-category').count(), 1);
  await page.getByLabel('Cari pengaturan').fill('tidak-ada'); await page.getByText('Pengaturan tidak ditemukan. Coba kata lain.').waitFor();
  await page.getByLabel('Cari pengaturan').fill('');
  report.checks.push('Overview, category search, planned integration labels and no-capture navigation');
  await page.getByRole('button', { name: /Audio & Video.*Tersedia/ }).click();
  await page.getByLabel('Mikrofon default', { exact: true }).selectOption('mic-b');
  await page.getByLabel('Kamera default', { exact: true }).selectOption('cam-b');
  await page.getByLabel('Speaker / headset default', { exact: true }).selectOption('speaker-b');
  await page.getByRole('switch', { name: /Aktifkan mikrofon saat bergabung/ }).uncheck();
  await page.getByRole('switch', { name: /Aktifkan kamera saat bergabung/ }).uncheck();
  assert.equal(await page.evaluate(() => window.__captureRequests.length), 0);
  await page.getByRole('button', { name: 'Simpan perubahan', exact: true }).click();
  await page.getByText('Preferensi tersimpan', { exact: true }).waitFor();
  await accessibility(page, 'audio-video-desktop');
  await page.screenshot({ path: join(output, 'settings-audio-video-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Tampilan Rapat', exact: true }).click();
  await page.getByRole('switch', { name: /Cerminkan video kamera sendiri/ }).uncheck();
  await page.getByRole('switch', { name: /Kurangi animasi/ }).check();
  await page.getByRole('button', { name: 'Simpan perubahan', exact: true }).click();
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
  assert.equal(saved.preferences.outputId, 'speaker-b'); assert.equal(saved.preferences.mirrorLocalVideo, false);
  await page.reload(); await page.getByRole('button', { name: 'Pengaturan', exact: true }).click();
  await page.getByRole('button', { name: /Tampilan Rapat.*Tersedia/ }).click();
  assert.equal(await page.getByRole('switch', { name: /Cerminkan video kamera sendiri/ }).isChecked(), false);
  await page.getByRole('switch', { name: /Cerminkan video kamera sendiri/ }).focus();
  await page.keyboard.press('Space');
  assert.equal(await page.getByRole('switch', { name: /Cerminkan video kamera sendiri/ }).isChecked(), true);
  await page.getByRole('button', { name: 'Batal', exact: true }).click();
  assert.equal(await page.getByRole('switch', { name: /Cerminkan video kamera sendiri/ }).isChecked(), false);
  assert.equal(await page.locator('.app-root.reduce-motion').count(), 1);
  await accessibility(page, 'display-desktop');
  await page.screenshot({ path: join(output, 'settings-display-desktop.png'), fullPage: true });
  report.checks.push('Explicit save, reload persistence, keyboard Space on switch, cancellation, reduced motion and media preferences survive reload');
  await page.setViewportSize({ width: 390, height: 844 }); await checkLayout(page); await accessibility(page, 'display-mobile');
  await page.screenshot({ path: join(output, 'settings-display-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Semua pengaturan', exact: true }).click(); await checkLayout(page);
  await page.screenshot({ path: join(output, 'settings-overview-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: /Audio & Video.*Tersedia/ }).click(); await checkLayout(page);
  await page.screenshot({ path: join(output, 'settings-audio-video-mobile.png'), fullPage: true });
  report.checks.push('Overview, Audio & Video and Display have no horizontal overflow at 390px');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Simpan & periksa perangkat', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Mikrofon saat bergabung' }).getAttribute('aria-pressed'), 'false');
  assert.equal(await page.getByLabel('Kamera sebelum bergabung').inputValue(), 'cam-b');
  await page.locator('.workspace-sidebar').getByRole('button', { name: 'Beranda', exact: true }).click();
  await page.locator('.quick-actions').getByRole('button', { name: /Jadwal rapat/ }).click();
  await page.getByRole('heading', { name: 'Jadwal Rapat & Reservasi Ruang', exact: true }).waitFor();
  await page.getByText('Workspace / Jadwal rapat', { exact: true }).waitFor();
  const scheduleTitle = 'QA Integrasi Jadwal dan Pengaturan';
  const scheduledRoom = `settings-schedule-qa-${Date.now()}`;
  const future = new Date(); future.setDate(future.getDate() + 1);
  const futureDate = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
  await page.getByLabel('Judul / Topik Pertemuan').fill(scheduleTitle);
  // Use an explicit room code; the existing main auto-slug issue is tracked separately.
  await page.getByLabel('Nama / Kode Ruang').fill(scheduledRoom);
  await page.getByLabel('Tanggal Rapat').fill(futureDate);
  await page.getByLabel('Waktu Mulai').fill('10:00');
  await page.getByLabel('Waktu Selesai').fill('11:00');
  await page.getByLabel('NIK Penyelenggara').fill('BT-10492');
  await page.getByLabel('Nama Penyelenggara').fill('P1 Settings QA');
  await page.locator('.schedule-page select').selectOption('IT Operations');
  const createResponse = page.waitForResponse(response => response.url().endsWith('/api/schedules') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Jadwalkan Rapat Sekarang', exact: true }).click();
  const createdSchedule = await (await createResponse).json();
  assert.equal(createdSchedule.schedule.roomName, scheduledRoom);
  await page.locator('.schedule-card-item').filter({ hasText: scheduleTitle }).waitFor();
  await checkLayout(page);
  await page.screenshot({ path: join(output, 'settings-schedule-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await checkLayout(page);
  await page.locator('.workspace-sidebar').getByRole('button', { name: 'Pengaturan', exact: true }).click();
  await page.getByText('Workspace / Pengaturan', { exact: true }).waitFor();
  await page.getByRole('button', { name: /Tampilan Rapat.*Tersedia/ }).click();
  assert.equal(await page.getByRole('switch', { name: /Cerminkan video kamera sendiri/ }).isChecked(), false);
  await page.locator('.workspace-sidebar').getByRole('button', { name: 'Jadwal rapat', exact: true }).click();
  await checkLayout(page);
  await page.screenshot({ path: join(output, 'settings-schedule-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.schedule-card-item').filter({ hasText: scheduleTitle }).getByRole('button', { name: 'Gabung Sekarang', exact: true }).click();
  await page.getByText('Workspace / Ruang rapat', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Kode / nama ruang').inputValue(), scheduledRoom);
  assert.equal(await page.getByRole('button', { name: 'Mikrofon saat bergabung', exact: true }).getAttribute('aria-pressed'), 'false');
  assert.equal(await page.getByRole('button', { name: 'Kamera saat bergabung', exact: true }).getAttribute('aria-pressed'), 'false');
  report.checks.push('Scheduling UI creates its own fixture via API, both sidebar menus and breadcrumbs work at desktop/mobile, saved settings survive navigation, scheduled join receives room code and media defaults');
  const first = await joinRoom(page, scheduledRoom);
  assert.equal(await page.evaluate(() => window.__captureRequests.length), 0);
  assert.equal(await page.getByRole('button', { name: 'Grid', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Lainnya', exact: true }).click();
  let releaseRecording;
  const recordingHeld = new Promise(resolve => { releaseRecording = resolve; });
  await page.route('**/recording/start', async route => {
    assert.equal(route.request().headers().authorization, `Bearer ${first.token}`);
    assert.equal(new URL(route.request().url()).pathname, `/api/meetings/${first.meetingId}/recording/start`);
    await recordingHeld;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Recording fixture: Egress belum tersedia' }) });
  });
  const recordingRequest = page.waitForRequest(request => request.url().endsWith('/recording/start'));
  await page.getByRole('button', { name: 'Mulai rekaman', exact: true }).click(); await recordingRequest;
  assert.equal(await page.getByRole('button', { name: 'Mulai rekaman', exact: true }).isDisabled(), true);
  await page.getByText('Tidak merekam', { exact: true }).waitFor();
  releaseRecording(); await page.getByText('Recording fixture: Egress belum tersedia', { exact: true }).waitFor();
  await page.unroute('**/recording/start');
  await page.route('**/recording/start', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, recording: { status: 'active' } }) }));
  const recordingResponse = page.waitForResponse(response => response.url().endsWith('/recording/start'));
  await page.getByRole('button', { name: 'Mulai rekaman', exact: true }).click(); await recordingResponse;
  await page.waitForFunction(() => document.querySelector('[aria-label="Mulai rekaman"]').getAttribute('aria-busy') === 'false');
  await page.getByText('Tidak merekam', { exact: true }).waitFor();
  assert.equal(await page.getByText('Recording fixture: Egress belum tersedia', { exact: true }).count(), 0);
  await page.unroute('**/recording/start');
  report.checks.push('Main recording control remains in More: authenticated start request, pending disable, error/retry; simulated API active response cannot override actual LiveKit recording state. Actual Egress recording not exercised');
  await page.getByRole('button', { name: 'Pengaturan perangkat', exact: true }).click();
  await page.getByLabel('Speaker / headphone', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Speaker / headphone', { exact: true }).inputValue(), 'speaker-b');
  await page.getByRole('button', { name: 'Selesai', exact: true }).click();
  await page.getByRole('button', { name: 'Aktifkan kamera', exact: true }).click();
  await page.locator('.participant-video').waitFor();
  assert.equal(await page.locator('.participant-video.is-local-video').count(), 0);
  assert.ok(await page.evaluate(() => window.__captureRequests.some(c => c.video?.deviceId?.exact === 'cam-b')));
  await page.getByRole('button', { name: 'Keluar', exact: true }).click();
  await page.getByRole('button', { name: 'Pengaturan', exact: true }).waitFor();
  await page.waitForFunction(() => window.__captures.every(track => track.readyState === 'ended'), undefined, { timeout: 5000 });
  assert.equal(store.get(first.meetingId).status, 'ended');
  report.checks.push('Saved devices enter actual LiveKit: no capture when defaults are off, output preference, camera cam-b, unmirrored local video, grid mode and cleanup on leave');
  await page.locator('.workspace-sidebar').getByRole('button', { name: 'Jadwal rapat', exact: true }).click();
  const cancelResponse = page.waitForResponse(response => response.url().endsWith(`/api/schedules/${createdSchedule.schedule.id}`) && response.request().method() === 'DELETE');
  await page.locator('.schedule-card-item').filter({ hasText: scheduleTitle }).getByRole('button', { name: 'Batalkan jadwal', exact: true }).click();
  assert.equal((await cancelResponse).status(), 200);
  await page.locator('.schedule-card-item').filter({ hasText: scheduleTitle }).waitFor({ state: 'detached' });
  report.checks.push('Canceling the harness-owned schedule updates API and UI after a scheduled media session');

  // Verify frontend timeout recovery without sending an Office LLM request.
  await page.getByRole('button', { name: 'Buat rapat', exact: true }).click(); const second = await joinRoom(page); await addLine(page, second);
  let release, start; const held = new Promise(resolve => { release = resolve; }); const started = new Promise(resolve => { start = resolve; });
  await page.route('**/summarize', async route => { start(); await held; await route.fulfill({ status: 504, contentType: 'application/json', body: JSON.stringify({ error: 'Simulated AI timeout' }) }); });
  await page.getByRole('button', { name: 'Selesai & notulen', exact: true }).click(); await started;
  await page.getByText('MEMPROSES NOTULEN AI', { exact: true }).waitFor();
  await page.locator('.call-room').waitFor({ state: 'detached' });
  await page.screenshot({ path: join(output, 'settings-summary-processing.png'), fullPage: true });
  release(); await page.getByText('GAGAL MEMBUAT NOTULEN', { exact: true }).waitFor();
  await page.unroute('**/summarize');
  await page.getByRole('button', { name: 'Coba Buat Notulen Lagi' }).click(); await page.getByRole('button', { name: 'Export PDF' }).waitFor();
  let exportUrl;
  await page.route('**/export/pdf', async route => { exportUrl = route.request().url(); await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'DB export fixture unavailable' }) }); });
  await page.getByRole('button', { name: 'Export PDF' }).click(); await page.getByText('DB export fixture unavailable', { exact: true }).waitFor();
  assert.equal(new URL(exportUrl).origin, url);
  report.checks.push('Notulen loading/error/retry render correctly, call media unmounts before response, retry succeeds via demo and PDF export respects same API origin');
  const savedTitle = await page.locator('.summary-heading h1').innerText();
  await page.reload(); await page.getByRole('heading', { name: savedTitle, exact: true }).waitFor();
  await page.locator('.workspace-sidebar').getByRole('button', { name: 'Beranda', exact: true }).click();
  await page.reload(); assert.equal(await page.locator('.summary-page').count(), 0);
  await page.getByRole('button', { name: 'Notulen rapat', exact: true }).click();
  await page.getByRole('heading', { name: savedTitle, exact: true }).waitFor();
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click();
  await page.getByText('DB export fixture unavailable', { exact: true }).waitFor();
  await page.screenshot({ path: join(output, 'summary-history-reload.png'), fullPage: true });
  report.checks.push('Completed end-call summary survives refresh, home navigation stays home on refresh, sidebar reopens saved recap and retains tab export access');
  await page.evaluate(() => localStorage.removeItem('balicall.summary-history.v1'));
  await page.reload(); await page.getByRole('heading', { name: savedTitle, exact: true }).waitFor();
  assert.equal(await page.locator('.summary-history-list button').count(), 1);
  await page.evaluate(() => localStorage.removeItem('balicall.summary-history.v1'));
  await page.route('**/transcript', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ summary: null, transcripts: [] }) }));
  let recoveryPosts = 0;
  const countRecovery = request => { if (request.method() === 'POST' && request.url().endsWith('/summarize')) recoveryPosts++; };
  page.on('request', countRecovery);
  await page.reload();
  await page.getByText('Notulen belum selesai saat halaman dimuat ulang. Coba ambil atau buat notulen lagi.', { exact: true }).waitFor();
  assert.equal(recoveryPosts, 0);
  await page.unroute('**/transcript');
  await page.getByRole('button', { name: /Coba Buat Notulen Lagi/ }).click();
  await page.getByRole('button', { name: 'Export PDF', exact: true }).waitFor();
  assert.equal(recoveryPosts, 1); page.off('request', countRecovery);
  report.checks.push('Reload without local result fetches existing server summary; unfinished result shows manual retry without automatically issuing duplicate AI requests');

  await page.getByRole('button', { name: 'Buat rapat', exact: true }).click(); const third = await joinRoom(page); await addLine(page, third);
  let releaseOld, startOld; const oldHeld = new Promise(resolve => { releaseOld = resolve; }); const oldStarted = new Promise(resolve => { startOld = resolve; });
  await page.route('**/summarize', async route => {
    startOld(); await oldHeld;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ summary: { title: 'STALE SUMMARY', executiveSummary: 'Stale fixture', keyDiscussionPoints: [], decisions: [], actionItems: [], attendanceSummary: [] } }) });
  });
  await page.getByRole('button', { name: 'Selesai & notulen', exact: true }).click(); await oldStarted;
  await page.getByRole('button', { name: 'Buat rapat', exact: true }).click(); const fourth = await joinRoom(page);
  const oldResponse = page.waitForResponse(r => r.url().endsWith('/summarize'));
  releaseOld(); await oldResponse;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.unroute('**/summarize');
  assert.equal(await page.locator('.call-room').count(), 1);
  await page.getByRole('button', { name: 'Keluar', exact: true }).click();
  await page.getByRole('button', { name: 'Pengaturan', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Notulen rapat', exact: true }).isDisabled(), false);
  assert.equal(await page.evaluate(() => localStorage.getItem('balicall.summary-history.v1').includes('STALE SUMMARY')), false);
  assert.equal(store.get(fourth.meetingId).status, 'ended');
  report.checks.push('A late summary from a previous meeting cannot overwrite a new meeting or restore stale recap navigation');

  await page.getByRole('button', { name: 'Buat rapat', exact: true }).click(); const fifth = await joinRoom(page); await addLine(page, fifth);
  await page.getByRole('button', { name: 'Aktifkan mikrofon', exact: true }).click();
  await page.waitForFunction(() => window.__recognizer?.active);
  await page.route('**/transcript', async route => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Simulated transcript save failure' }) });
    else await route.continue();
  });
  await page.evaluate(() => window.__recognizer.emitFinal('Pending speech must be saved before leaving.'));
  await page.getByRole('button', { name: 'Coba simpan lagi', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Selesai & notulen', exact: true }).click();
  await page.locator('.call-error').getByText('Simulated transcript save failure', { exact: true }).waitFor();
  assert.equal(store.get(fifth.meetingId).status, 'active'); assert.equal(await page.locator('.call-room').count(), 1);
  await page.unroute('**/transcript');
  await page.getByRole('button', { name: 'Coba simpan lagi', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.live-transcript-entry').length === 2);
  await page.getByRole('button', { name: 'Selesai & notulen', exact: true }).click();
  await page.getByRole('button', { name: 'Export PDF', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Pengaturan', exact: true }).waitFor();
  report.checks.push('Failed transcript flush keeps the meeting open with a retry; successful retry preserves pending speech before leaving');
  assert.equal(await page.locator('.summary-history-list button').count(), 2);
  await page.locator('.summary-history-list button').last().click();
  assert.equal(await page.locator('.summary-heading h1').innerText(), savedTitle);
  await page.reload(); assert.equal(await page.locator('.summary-heading h1').innerText(), savedTitle);
  const archiveContext = await browser.newContext({ storageState: await context.storageState() });
  const archivePage = await archiveContext.newPage();
  await archivePage.goto(url); await archivePage.getByRole('button', { name: 'Notulen rapat', exact: true }).click();
  const downloadPromise = archivePage.waitForEvent('download');
  await archivePage.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const download = await downloadPromise;
  const archived = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(archived.source, 'browser-history'); assert.ok(archived.summary.title); assert.ok(archived.transcripts.length);
  await archiveContext.close();
  report.checks.push('Two completed recaps remain selectable; selected older recap survives refresh; a new browser session reads history and downloads local JSON without bearer credentials');

  const blockedContext = await browser.newContext(); await fixture(blockedContext);
  await blockedContext.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('Storage blocked', 'QuotaExceededError'); }; });
  const blocked = await blockedContext.newPage(); await blocked.goto(url); await blocked.getByRole('button', { name: 'Pengaturan', exact: true }).click(); await blocked.getByRole('button', { name: /Audio & Video.*Tersedia/ }).click();
  await blocked.getByRole('switch', { name: /Aktifkan kamera saat bergabung/ }).uncheck();
  await blocked.getByRole('button', { name: 'Simpan & periksa perangkat' }).click();
  await blocked.getByText('Gagal menyimpan preferensi. Izinkan penyimpanan browser, lalu coba lagi.').waitFor();
  assert.equal(await blocked.locator('.lobby-page').count(), 0); await blockedContext.close();
  const unsupportedContext = await browser.newContext(); await fixture(unsupportedContext);
  await unsupportedContext.addInitScript(() => { delete HTMLMediaElement.prototype.setSinkId; });
  const unsupported = await unsupportedContext.newPage(); await unsupported.goto(url); await unsupported.getByRole('button', { name: 'Pengaturan', exact: true }).click(); await unsupported.getByRole('button', { name: /Audio & Video.*Tersedia/ }).click();
  assert.equal(await unsupported.getByLabel('Speaker / headset default', { exact: true }).isDisabled(), true);
  await unsupported.getByText('Pemilihan output belum didukung browser ini. Suara mengikuti output sistem.').waitFor(); await unsupportedContext.close();
  report.checks.push('Blocked storage never reports save success or navigates to preview; unsupported output picker is disabled with explanatory text');
  assert.equal(report.pageErrors.length, 0);
  report.status = 'passed';
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.error = String(error);
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) { report.failureView = await page.locator('main').innerText().catch(() => 'unavailable'); await page.screenshot({ path: join(output, 'settings-verification-failure.png'), fullPage: true }).catch(() => {}); }
  throw error;
}
finally {
  for (const session of sessions) {
    try { await fetch(`${url}/api/meetings/${session.meetingId}/leave`, { method: 'POST', headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' }, body: '{}' }); } catch {}
  }
  await browser?.close(); await new Promise(resolve => server.close(resolve));
  await writeFile(reportPath, JSON.stringify(report, null, 2));
}
