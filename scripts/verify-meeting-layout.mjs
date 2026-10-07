// Real local SFU, synthetic camera/audio/screen, demo API and temporary storage.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
process.env.DATABASE_URL = '';
const { createApp } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'docs/screenshots');
await mkdir(output, { recursive: true });
const verificationOutput = join(root, 'docs/verification');
await mkdir(verificationOutput, { recursive: true });
const data = await mkdtemp(join(tmpdir(), 'balicall-layout-'));
const config = { ...loadConfig({ LLM_PROVIDER: 'demo', DATABASE_URL: '', VERIFY_EMPLOYEE_ID: 'false' }), dataFile: join(data, 'meetings.json') };
const { app } = createApp(config);
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
config.corsOrigins.push(url);
const report = { status: 'failed', date: new Date().toISOString(), media: 'Synthetic canvas video, oscillator audio and display capture; actual LiveKit SFU, browser recognition stub; demo LLM, no company DB', checks: [], matrix: [], pageErrors: [] };
let browser, sfu;
const pages = [], sessions = [];
const room = `layout-qa-${Date.now()}`;
const roster = [
  { id: 'BT-10492', name: 'Rafli Aditya', department: 'NOC & Core Network' },
  { id: 'BT-10214', name: 'Budi Santoso', department: 'Field Transmission' },
  { id: 'BT-10883', name: 'Siti Rahma', department: 'Project Management' },
  { id: 'BT-10550', name: 'Agus Pratama', department: 'Fiber Infrastructure' },
  { id: 'BT-10101', name: 'Eko Prasetyo', department: 'Tower Maintenance' },
  { id: 'BT-10332', name: 'Dewi Lestari', department: 'Radio Frequency' },
  { id: 'BT-10771', name: 'Hendra Wijaya', department: 'Power & Electrical' },
  { id: 'BT-10999', name: 'Linda Kusuma', department: 'IT Security & NOC' },
];
const sizes = [[1920, 1080], [1366, 768], [820, 1180], [390, 844]];
const reachable = () => new Promise(resolve => { const socket = connect(7880, '127.0.0.1'); socket.setTimeout(1000); socket.once('connect', () => { socket.destroy(); resolve(true); }); socket.once('error', () => resolve(false)); socket.once('timeout', () => { socket.destroy(); resolve(false); }); });

async function participant(number) {
  const employee = roster[number - 1] || { id: `BT-${10000 + number}`, name: `Peserta ${String(number).padStart(2, '0')}`, department: 'IT Operations' };
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await context.addInitScript(({ number, name }) => {
    window.__tracks = [];
    navigator.mediaDevices.enumerateDevices = async () => [];
    const video = kind => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
      const draw = () => { const ctx = canvas.getContext('2d'); ctx.fillStyle = ['#183f64', '#206273', '#38517d'][number % 3]; ctx.fillRect(0, 0, 640, 360); ctx.fillStyle = '#fff'; ctx.font = '24px sans-serif'; ctx.fillText(`${kind} · ${name}`, 140, 180); };
      draw(); const timer = setInterval(draw, 500); const stream = canvas.captureStream(2);
      const track = stream.getVideoTracks()[0], stop = track.stop.bind(track);
      track.stop = () => { clearInterval(timer); stop(); }; window.__tracks.push(track); return stream;
    };
    navigator.mediaDevices.getUserMedia = async constraints => {
      if (constraints.video) return video('Kamera');
      const ctx = new AudioContext(), osc = ctx.createOscillator(), gain = ctx.createGain(), dest = ctx.createMediaStreamDestination();
      gain.gain.value = 0; osc.frequency.value = 400 + number * 100; osc.connect(gain); gain.connect(dest); osc.start(); await ctx.resume(); window.__gain = gain;
      const track = dest.stream.getAudioTracks()[0], stop = track.stop.bind(track); let stopped = false;
      track.stop = () => { if (!stopped) { stopped = true; osc.stop(); void ctx.close().catch(() => {}); } stop(); }; window.__tracks.push(track); return dest.stream;
    };
    navigator.mediaDevices.getDisplayMedia = async () => video('Presentasi');
    class Recognition {
      start() { this.active = true; window.__recognizer = this; queueMicrotask(() => this.onstart?.()); }
      stop() { this.active = false; queueMicrotask(() => this.onend?.()); }
      abort() { this.active = false; }
      emit(text) { this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] }); }
    }
    window.SpeechRecognition = Recognition; window.webkitSpeechRecognition = Recognition;
  }, { number, name: employee.name });
  const page = await context.newPage(); pages.push(page); page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.pageErrors.push({ participant: number, message: error.message }));
  await page.goto(url);
  await page.getByRole('button', { name: 'Buat rapat', exact: true }).click();
  await page.getByLabel('NIK karyawan').fill(employee.id);
  await page.getByLabel('Nama lengkap').fill(employee.name);
  const department = page.getByLabel('Departemen');
  const supported = await department.locator('option').evaluateAll(options => options.map(option => option.value));
  await department.selectOption(supported.includes(employee.department) ? employee.department : 'IT Operations');
  await page.getByLabel('Nama ruang rapat').fill(room);
  const response = page.waitForResponse(response => response.url().endsWith('/api/token'));
  await page.getByRole('button', { name: 'Mulai rapat', exact: true }).click();
  sessions.push(await (await response).json());
  await page.getByText('Terhubung', { exact: true }).waitFor({ timeout: 30000 });
  return page;
}

async function settle(page) { await page.waitForTimeout(250); }
async function closeDrawer(page) { if (await page.locator('.meeting-panel-drawer[open]').count()) await page.getByRole('button', { name: 'Tutup panel rapat' }).click(); }
async function geometry(page, expected, state, equal = true) {
  await settle(page);
  await page.waitForFunction(() => {
    const area = document.querySelector('.meeting-video-area').getBoundingClientRect();
    return [...document.querySelectorAll('.participant-tile')].every(node => {
      const tile = node.getBoundingClientRect();
      return tile.width > 2 && tile.x >= area.x - 1 && tile.right <= area.right + 1 && tile.y >= area.y - 1 && tile.bottom <= area.bottom + 1;
    });
  }, undefined, { timeout: 5000 });
  const result = await page.evaluate(() => {
    const box = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
    const controls = document.querySelector('.call-control-bar');
    return { viewport: [innerWidth, innerHeight], overflow: document.documentElement.scrollWidth - innerWidth, stage: box(document.querySelector('.meeting-video-area')), controls: box(controls), tiles: [...document.querySelectorAll('.participant-tile')].map(node => ({ ...box(node), name: node.getAttribute('aria-label') })), rows: [...document.querySelectorAll('.participant-grid-row')].map(node => [...node.children].map(box)) };
  });
  report.matrix.push({ state, ...result });
  assert.ok(result.overflow <= 1, `${state}: horizontal overflow ${result.overflow}`);
  assert.equal(result.tiles.length, expected, `${state}: tile count`);
  assert.ok(result.controls.bottom <= result.viewport[1] + 2, `${state}: controls unreachable`);
  for (const tile of result.tiles) {
    assert.ok(Math.abs(tile.width / tile.height - 16 / 9) < .025, `${state}: ratio ${tile.width}/${tile.height}`);
    assert.ok(tile.x >= result.stage.x - 1 && tile.right <= result.stage.right + 1 && tile.y >= result.stage.y - 1 && tile.bottom <= result.stage.bottom + 1, `${state}: clipped tile`);
    if (equal) assert.ok(Math.abs(tile.width - result.tiles[0].width) < 2 && Math.abs(tile.height - result.tiles[0].height) < 2, `${state}: unequal tiles`);
  }
  for (const row of result.rows) if (row.length) assert.ok(Math.abs((row[0].x + row.at(-1).right) / 2 - (result.stage.x + result.stage.right) / 2) < 2, `${state}: row not centered`);
  return result;
}

try {
  if (!(await reachable())) {
    sfu = spawn(join(root, 'bin/livekit-server.exe'), ['--dev', '--bind', '127.0.0.1'], { cwd: root, windowsHide: true, stdio: 'ignore' });
    for (let i = 0; i < 40 && !(await reachable()); i++) await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(await reachable(), true, 'Local LiveKit SFU reachable');
  browser = await chromium.launch({ headless: true, channel: process.env.LAYOUT_TEST_BROWSER || 'msedge', args: ['--autoplay-policy=no-user-gesture-required'] });
  let first;
  for (let count = 1; count <= 10; count++) {
    const page = await participant(count); first ||= page;
    if (![1, 2, 3, 4, 6, 8, 10].includes(count)) continue;
    await first.waitForFunction(expected => document.querySelectorAll('.participant-tile').length === expected, Math.min(9, count));
    await first.waitForFunction(expected => {
      const videos = [...document.querySelectorAll('.participant-video')];
      return videos.length === expected && videos.every(video => video.readyState >= 2 && video.videoWidth > 0);
    }, Math.min(9, count), { timeout: 30000 });
    assert.equal(await first.getByRole('button', { name: 'Grid', exact: true }).getAttribute('aria-pressed'), 'true');
    for (const [width, height] of sizes) {
      await first.setViewportSize({ width, height }); await settle(first); await closeDrawer(first);
      await geometry(first, Math.min(9, count), `grid-${count}-${width}`);
      if ([3, 8, 10].includes(count) && [1920, 390].includes(width)) await first.screenshot({ path: join(output, `meeting-grid-${count}-${width}.png`) });
    }
    console.log(`Grid matrix passed: ${count} participants`);
  }
  report.checks.push('1, 2, 3, 4, 6, 8 and 10 participants: four viewport sizes, equal 16:9 tiles, centered rows, no horizontal overflow, reachable controls');
  await first.setViewportSize({ width: 1366, height: 768 });
  await first.getByRole('button', { name: 'Halaman peserta berikutnya' }).click();
  await geometry(first, 1, 'grid-page-two');
  assert.match(await first.locator('.participant-tile').getAttribute('aria-label'), /Peserta 10/);
  await first.getByRole('button', { name: 'Halaman peserta sebelumnya' }).click();
  report.checks.push('Pagination: nine on first page, tenth participant on next page');
  await first.getByRole('button', { name: 'Transkrip', exact: true }).click();
  const divider = first.getByRole('separator', { name: 'Ubah lebar panel transkrip' });
  await divider.waitFor();
  const beforePanel = await first.locator('aside.call-side-panel').boundingBox();
  const dividerBox = await divider.boundingBox();
  await first.mouse.move(dividerBox.x + 5, dividerBox.y + 100); await first.mouse.down(); await first.mouse.move(dividerBox.x - 150, dividerBox.y + 100, { steps: 10 }); await first.mouse.up(); await settle(first);
  assert.ok((await first.locator('aside.call-side-panel').boundingBox()).width > beforePanel.width + 100);
  await geometry(first, 9, 'resized-panel-grid');
  await divider.focus(); await first.keyboard.press('Home'); assert.ok(Number(await divider.getAttribute('aria-valuenow')) <= 22);
  await first.keyboard.press('End'); assert.equal(await divider.getAttribute('aria-valuenow'), '42');
  await first.getByRole('button', { name: 'Transkrip', exact: true }).click();
  await geometry(first, 9, 'panel-closed-grid');
  report.checks.push('Drag and keyboard divider clamp panel; closing panel expands video and recalculates grid');
  const original = await geometry(first, 9, 'before-real-speaker-change');
  await pages[1].evaluate(() => { window.__gain.gain.value = .2; });
  await first.locator('.participant-tile.is-speaking').filter({ hasText: roster[1].name }).waitFor({ timeout: 25000 });
  const after = await geometry(first, 9, 'after-real-speaker-change');
  assert.deepEqual(after.tiles, original.tiles);
  await first.getByRole('button', { name: 'Speaker', exact: true }).click();
  await first.locator('.speaker-primary .participant-tile').filter({ hasText: roster[1].name }).waitFor({ timeout: 15000 });
  for (const [width, height] of sizes) {
    await first.setViewportSize({ width, height }); await settle(first); await closeDrawer(first);
    await geometry(first, await first.locator('.participant-tile').count(), `speaker-${width}`, false);
    assert.ok(await first.locator('.participant-strip').evaluate(node => node.scrollWidth <= node.clientWidth + 1));
    if (width === 390) await first.screenshot({ path: join(output, 'meeting-speaker-390.png') });
  }
  await first.setViewportSize({ width: 1366, height: 768 });
  report.checks.push('Actual SFU active-speaker event changes border/badge only in Grid; Speaker follows active participant');
  await first.screenshot({ path: join(output, 'meeting-speaker-1366.png') });
  await pages[1].getByRole('button', { name: 'Bagikan layar', exact: true }).click();
  await first.locator('.screen-share-video').waitFor();
  assert.equal(await first.locator('.screen-share-video').evaluate(node => getComputedStyle(node).objectFit), 'contain');
  for (const [width, height] of sizes) {
    await first.setViewportSize({ width, height }); await settle(first); await closeDrawer(first);
    // Thumbnail pagination follows available space; the page itself never scrolls horizontally.
    const overflow = await first.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert.ok(overflow <= 1);
    assert.ok(await first.locator('.participant-strip').evaluate(node => node.scrollWidth <= node.clientWidth + 1));
    const screen = await first.locator('.screen-share-stage').boundingBox(); assert.ok(screen.width > 100 && screen.height > 100);
    if (width === 1920 || width === 390) await first.screenshot({ path: join(output, `meeting-share-${width}.png`) });
    report.matrix.push({ state: `share-${width}`, screen });
  }
  await first.setViewportSize({ width: 1366, height: 768 });
  await first.getByRole('button', { name: 'Transkrip', exact: true }).click();
  await first.locator('aside.call-side-panel').waitFor(); await first.locator('.screen-share-stage').waitFor(); await first.locator('.participant-strip').waitFor();
  await first.screenshot({ path: join(output, 'meeting-share-transcript-1366.png') });
  await pages[1].getByRole('button', { name: 'Hentikan berbagi layar' }).click();
  await first.locator('.speaker-primary').waitFor();
  await first.getByRole('button', { name: 'Grid', exact: true }).click();
  await pages[1].getByRole('button', { name: 'Bagikan layar', exact: true }).click(); await first.locator('.screen-share-stage').waitFor();
  await pages[1].getByRole('button', { name: 'Hentikan berbagi layar' }).click(); await first.locator('.grid-layout').waitFor();
  report.checks.push('Screen share takes main area with contain, thumbnail strip and optional transcript; restores selected Grid/Speaker');
  await first.evaluate(() => window.__recognizer.emit('Fixture transkrip: layout rapat sudah setara.'));
  await first.locator('.live-transcript-entry').filter({ hasText: 'Fixture transkrip' }).waitFor();
  await first.getByRole('button', { name: 'Transkrip', exact: true }).click(); await first.getByRole('button', { name: 'Transkrip', exact: true }).click();
  await first.locator('.live-transcript-entry').filter({ hasText: 'Fixture transkrip' }).waitFor();
  await first.getByRole('button', { name: 'Lainnya', exact: true }).click();
  await first.getByRole('button', { name: 'Jeda transkripsi' }).click();
  await first.getByRole('button', { name: 'Mulai transkripsi' }).click();
  await first.getByRole('button', { name: 'Pengaturan perangkat' }).click();
  await first.getByRole('dialog', { name: 'Perangkat audio & video' }).waitFor();
  await first.getByRole('button', { name: 'Tutup pengaturan perangkat' }).click();
  await first.getByRole('button', { name: 'Matikan mikrofon' }).click(); await first.getByRole('button', { name: 'Aktifkan mikrofon' }).click();
  await first.getByRole('button', { name: 'Matikan kamera' }).click(); await first.getByRole('button', { name: 'Aktifkan kamera' }).click();
  await first.setViewportSize({ width: 390, height: 844 }); await settle(first);
  await first.locator('.meeting-panel-drawer[open]').waitFor(); await first.keyboard.press('Escape');
  await first.getByRole('button', { name: 'Peserta', exact: true }).click(); await first.getByRole('dialog', { name: 'Transkrip dan peserta' }).waitFor(); await first.getByRole('button', { name: 'Tutup panel rapat' }).click();
  assert.ok(await first.getByRole('button', { name: 'Peserta', exact: true }).evaluate(node => document.activeElement === node));
  report.checks.push('Transcript retained after toggle; More pause/resume/devices; mic/camera; mobile drawer Escape, close and focus return');
  await first.setViewportSize({ width: 1366, height: 768 });
  await first.getByText('Tidak merekam', { exact: true }).waitFor();
  await pages[9].getByRole('button', { name: 'Keluar', exact: true }).click(); await pages[9].getByRole('heading', { name: /^Selamat/ }).waitFor();
  assert.ok(await pages[9].evaluate(() => window.__tracks.every(track => track.readyState === 'ended')));
  await first.getByRole('button', { name: 'Selesai & notulen' }).click(); await first.locator('.summary-page').waitFor({ timeout: 30000 });
  await first.getByText('Ringkasan', { exact: true }).first().waitFor({ timeout: 30000 });
  report.checks.push('No false recording label; Keluar stops tracks; Selesai & notulen still generates demo recap');
  assert.deepEqual(report.pageErrors, []);
  report.status = 'passed';
} catch (error) {
  report.failure = error.message;
  if (pages[0] && !pages[0].isClosed()) await pages[0].screenshot({ path: join(output, 'meeting-layout-failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await writeFile(join(verificationOutput, 'MEETING_LAYOUT_VERIFICATION.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, checks: report.checks, matrixCases: report.matrix.length, pageErrors: report.pageErrors, failure: report.failure }, null, 2));
  await browser?.close(); await new Promise(resolve => server.close(resolve)); sfu?.kill();
}
