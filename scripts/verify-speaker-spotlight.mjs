// Exercise SFU active-speaker events with controlled synthetic audio, not injected SDK events.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const baseUrl = process.env.SPOTLIGHT_TEST_URL || 'http://127.0.0.1:5187';
const output = new URL('../artifacts/screenshots/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.SPOTLIGHT_TEST_BROWSER || (process.platform === 'win32' ? 'msedge' : undefined), args: ['--autoplay-policy=no-user-gesture-required'] });
const pages = [], checks = [], errors = [];
const runId = Date.now(), room = `speaker-check-${runId}`;

async function participant(number) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await context.addInitScript(number => {
    window.__tracks = []; window.__recognitionStarts = 0;
    navigator.mediaDevices.enumerateDevices = async () => [];
    const captureVideo = () => {
      const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 540;
      const ctx = canvas.getContext('2d');
      const draw = () => {
        ctx.fillStyle = ['#153d5a', '#075b7b', '#334779'][number - 1]; ctx.fillRect(0, 0, 960, 540);
        ctx.fillStyle = '#ffffff'; ctx.font = '40px sans-serif'; ctx.fillText(`Speaker Tester ${number}`, 300, 240);
        ctx.font = '20px sans-serif'; ctx.fillText(new Date().toISOString(), 300, 350);
      };
      draw(); const stream = canvas.captureStream(10), timer = setInterval(draw, 100);
      const track = stream.getVideoTracks()[0], stop = track.stop.bind(track);
      track.stop = () => { clearInterval(timer); stop(); };
      window.__tracks.push(track); return stream;
    };
    navigator.mediaDevices.getUserMedia = async constraints => {
      if (constraints.video) return captureVideo();
      const ctx = new AudioContext(), oscillator = ctx.createOscillator(), gain = ctx.createGain(), dest = ctx.createMediaStreamDestination();
      gain.gain.value = 0; oscillator.frequency.value = 400 + number * 130;
      oscillator.connect(gain); gain.connect(dest); oscillator.start();
      window.__micGain = gain;
      const track = dest.stream.getAudioTracks()[0], stop = track.stop.bind(track); let stopped = false;
      track.stop = () => { if (!stopped) { stopped = true; oscillator.stop(); void ctx.close().catch(() => {}); } stop(); };
      window.__tracks.push(track); return dest.stream;
    };
    navigator.mediaDevices.getDisplayMedia = async () => captureVideo();
    class Recognition {
      start() { this.active = true; window.__recognitionStarts++; queueMicrotask(() => { if (this.active) this.onstart?.(); }); }
      stop() { this.active = false; queueMicrotask(() => this.onend?.()); }
      abort() { this.active = false; }
    }
    window.SpeechRecognition = Recognition; window.webkitSpeechRecognition = Recognition;
  }, number);
  const page = await context.newPage(); pages.push(page);
  page.on('pageerror', error => errors.push({ participant: number, message: error.message }));
  await page.goto(baseUrl);
  await page.getByRole('button', { name: 'Buat rapat', exact: true }).click();
  await page.getByLabel('NIK karyawan').fill(`SPK-${runId}-${number}`);
  await page.getByLabel('Nama lengkap').fill(`Speaker Tester ${number}`);
  await page.getByLabel('Departemen').selectOption('IT Operations');
  await page.getByLabel('Nama ruang rapat').fill(room);
  await page.getByRole('button', { name: 'Mulai rapat', exact: true }).click();
  await page.getByText('Terhubung', { exact: true }).waitFor({ timeout: 20000 });
  return page;
}
const tile = (page, number) => page.locator('.participant-tile').filter({ hasText: `Speaker Tester ${number}` });
async function level(page, value) { await page.evaluate(value => { window.__micGain.gain.value = value; }, value); }
async function focus(page, number) {
  await tile(page, number).locator('xpath=self::*[@data-spotlight="true"]').waitFor({ timeout: 20000 });
  assert.equal(await page.locator('.participant-tile[data-spotlight="true"]').count(), 1);
}
async function speaking(page, number) { await tile(page, number).locator('xpath=self::*[contains(@class,"is-speaking")]').waitFor({ timeout: 20000 }); }
async function videos(page, count) {
  await page.waitForFunction(count => { const videos = [...document.querySelectorAll('.participant-video')]; return videos.length === count && videos.every(v => v.readyState >= 2 && v.videoWidth > 0); }, count, { timeout: 20000 });
}
async function leave(page) {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole('button', { name: 'Keluar', exact: true }).click();
  await page.getByRole('heading', { name: /^Selamat/ }).waitFor({ timeout: 15000 });
}

try {
  const first = await participant(1), second = await participant(2), third = await participant(3);
  await videos(first, 3); await videos(second, 3);
  await focus(first, 1);
  await first.evaluate(() => {
    window.__tileNodes = new Map([...document.querySelectorAll('.participant-tile')].map(el => [el.getAttribute('aria-label'), el]));
    window.__videoNodes = new Map([...document.querySelectorAll('.participant-tile')].map(el => [el.getAttribute('aria-label'), el.querySelector('video')]));
  });
  const recognitionStarts = await first.evaluate(() => window.__recognitionStarts);
  checks.push('three silent participants have a stable initial spotlight and all camera tiles are visible');

  await level(first, .2); await speaking(first, 1); await focus(second, 1);
  await level(second, .15); await speaking(first, 2); await focus(first, 2); await focus(third, 2);
  await level(first, .3); await level(second, .12);
  await first.waitForTimeout(1600);
  await focus(first, 2);
  assert.equal(await first.evaluate(() => [...document.querySelectorAll('.participant-tile')].every(el => el === window.__tileNodes.get(el.getAttribute('aria-label')) && el.querySelector('video') === window.__videoNodes.get(el.getAttribute('aria-label')))), true);
  assert.equal(await first.evaluate(() => window.__recognitionStarts), recognitionStarts);
  assert.equal(await first.evaluate(() => window.__tracks.filter(t => t.kind === 'video').length), 1);
  const layout = await first.locator('.participant-tile').evaluateAll(tiles => tiles.map(t => ({ focused: t.dataset.spotlight === 'true', y: t.getBoundingClientRect().y, width: t.getBoundingClientRect().width, height: t.getBoundingClientRect().height })));
  const main = layout.find(t => t.focused);
  assert.ok(layout.filter(t => !t.focused).every(t => main.y < t.y && main.width > t.width && main.height > t.height));
  await first.screenshot({ path: fileURLToPath(new URL('speaker-spotlight-desktop.png', output)), fullPage: true });
  checks.push('real SFU speaker events promote newest overlapping speaker; loudness variation does not reorder focus; tile/video DOM nodes, camera capture, and recognizer remain unchanged');

  await level(first, 0); await level(second, 0);
  await first.waitForFunction(() => document.querySelectorAll('.participant-tile.is-speaking').length === 0);
  await first.waitForTimeout(1300); await focus(first, 2);
  checks.push('silence preserves most recent spotlight beyond the hold interval');

  await second.getByRole('button', { name: 'Matikan mikrofon', exact: true }).click();
  await tile(first, 2).getByLabel('Mikrofon mati', { exact: true }).waitFor();
  await focus(first, 2);
  await third.getByRole('button', { name: 'Matikan kamera', exact: true }).click();
  await level(third, .2); await speaking(first, 3); await focus(first, 3);
  await tile(first, 3).getByText('Kamera mati', { exact: true }).waitFor();
  await videos(first, 2);
  checks.push('muted microphone remains correctly marked; camera-off speaker is spotlighted with initials without misassigning another participant video');

  await first.getByRole('button', { name: 'Bagikan layar', exact: true }).click();
  await first.waitForFunction(() => document.querySelector('.screen-share-video')?.readyState >= 2);
  assert.equal(await first.locator('.participant-tile[data-spotlight="true"]').count(), 0);
  await first.evaluate(() => { window.__screenNode = document.querySelector('.screen-share-video'); });
  await level(third, 0);
  await second.getByRole('button', { name: 'Aktifkan mikrofon', exact: true }).click();
  await level(second, .2); await speaking(first, 2);
  await first.waitForTimeout(1300);
  assert.equal(await first.evaluate(() => document.querySelector('.screen-share-video') === window.__screenNode), true);
  assert.equal(await first.locator('.participant-grid.spotlight-grid').count(), 0);
  await first.screenshot({ path: fileURLToPath(new URL('speaker-spotlight-screen-share.png', output)), fullPage: true });
  await first.getByRole('button', { name: 'Hentikan berbagi layar', exact: true }).click();
  await focus(first, 2);
  assert.equal(await first.evaluate(() => [...document.querySelectorAll('.participant-tile')].every(el => el === window.__tileNodes.get(el.getAttribute('aria-label')))), true);
  checks.push('screen share remains the main stage while speaker history updates; stopping share restores latest speaker without recreating participant tiles');

  await leave(second); await focus(first, 3);
  assert.equal(await first.locator('.participant-tile').count(), 2);
  checks.push('departing spotlight falls back to last confirmed participant still in room');
  await level(first, .2); await speaking(first, 1); await focus(first, 1);
  await tile(first, 1).getByText('(Kamu)', { exact: true }).waitFor();
  assert.ok(await tile(first, 1).locator('.is-local-video').count());
  await first.setViewportSize({ width: 390, height: 844 });
  assert.equal(await first.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await first.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await first.locator('.participant-tile').evaluateAll(tiles => tiles.every(t => getComputedStyle(t).animationName === 'none' || parseFloat(getComputedStyle(t).animationDuration) <= .001)), true);
  await first.screenshot({ path: fileURLToPath(new URL('speaker-spotlight-mobile.png', output)), fullPage: true });
  checks.push('local spotlight keeps Kamu marker and local-only mirror; mobile fits without horizontal overflow and honors reduced motion');

  await leave(first);
  assert.equal(await first.evaluate(() => window.__tracks.every(t => t.readyState === 'ended')), true);
  await focus(third, 3);
  checks.push('leaving cleans media; last participant retains a valid spotlight');
  assert.deepEqual(errors, []); checks.push('no uncaught browser errors');
  const report = { date: new Date().toISOString(), status: 'passed', media: 'controlled oscillator audio and canvas video, real local LiveKit WebRTC/SFU active speaker events; speech recognition stubbed; physical microphones and human speech not tested', timing: { confirmationMs: 600, minimumHoldMs: 1200 }, checks, errors };
  await writeFile(new URL('../artifacts/SPEAKER_SPOTLIGHT_VERIFICATION.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  for (const [index, page] of pages.entries()) {
    if (page.isClosed()) continue;
    await page.screenshot({ path: fileURLToPath(new URL(`speaker-spotlight-failure-${index + 1}.png`, output)), fullPage: true }).catch(() => {});
    console.log(JSON.stringify({ participant: index + 1, text: await page.locator('body').innerText(), errors }, null, 2));
  }
  throw error;
} finally {
  for (const page of pages) { try { if (await page.getByRole('button', { name: 'Keluar', exact: true }).count()) await leave(page); } catch { /* Browser close disconnects. */ } }
  await browser.close();
}
