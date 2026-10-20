import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../config.js';
import { transcribeAudio } from '../providers.js';

const model = 'qwen3-asr-0.6b';
test('Qwen endpoint is opt-in and requires an HTTP URL', () => {
  assert.equal(loadConfig({}).qwenSttBaseUrl, '');
  assert.throws(() => loadConfig({ QWEN_STT_BASE_URL: 'file:///model' }), /protocol/);
  assert.throws(() => loadConfig({ QWEN_STT_TIMEOUT_MS: '0' }), /100/);
  assert.throws(() => loadConfig({ STT_PROVIDER: 'server', STT_MODEL: model, STT_BASE_URL: 'http://whisper/v1' }), /Qwen/);
});
test('Qwen uploads route to their own endpoint and credentials', async () => {
  const config = loadConfig({ STT_MODEL: model, QWEN_STT_BASE_URL: 'http://qwen/v1/',
    QWEN_STT_API_KEY: 'qwen-only', STT_API_KEY: 'whisper-only' });
  const result = await transcribeAudio(Buffer.from('clip'), 'audio/webm', 'id', config, async (url, options) => {
    assert.equal(url, 'http://qwen/v1/audio/transcriptions');
    assert.equal(options.headers.Authorization, 'Bearer qwen-only');
    assert.equal(options.body.get('model'), model);
    assert.equal(options.body.get('language'), 'id');
    return new Response(JSON.stringify({ text: 'Rapat dimulai.' }));
  });
  assert.deepEqual(result, { text: 'Rapat dimulai.' });
});
test('Qwen refuses diarization rather than silently saving account text as speaker separation', async () => {
  const config = loadConfig({ STT_MODEL: model, QWEN_STT_BASE_URL: 'http://qwen/v1', STT_DIARIZATION: 'true' });
  let calls = 0;
  await assert.rejects(transcribeAudio(Buffer.from('clip'), 'audio/wav', 'id', config, async () => {
    calls++; return new Response('{"text":"fake"}');
  }), error => error.status === 400 && /Qwen.*diarization/i.test(error.message));
  assert.equal(calls, 0);
});
test('explicit experimental Qwen diarization opt-in preserves validated speaker segments', async () => {
  const config = loadConfig({ STT_MODEL: model, QWEN_STT_BASE_URL: 'http://qwen/v1',
    STT_DIARIZATION: 'true', QWEN_DIARIZATION_ENABLED: 'true' });
  const segments = [{ speaker: 'A', start: 0, end: 1, text: 'Rapat dimulai.' }];
  const result = await transcribeAudio(Buffer.from('clip'), 'audio/wav', 'id', config, async (_url, options) => {
    assert.equal(options.body.get('diarize'), 'true');
    return new Response(JSON.stringify({ text: 'Rapat dimulai.', segments }));
  });
  assert.deepEqual(result, { text: 'Rapat dimulai.', segments });
});
test('experimental Qwen diarization rejects missing or invalid speaker results', async () => {
  const config = loadConfig({ STT_MODEL: model, QWEN_STT_BASE_URL: 'http://qwen/v1',
    STT_DIARIZATION: 'true', QWEN_DIARIZATION_ENABLED: 'true' });
  for (const data of [{ text: 'speech' }, { text: 'speech', segments: [] },
    { text: 'speech', segments: [{ text: 'speech', speaker: 'A', start: -1, end: 1 }] }]) {
    await assert.rejects(transcribeAudio(Buffer.from('clip'), 'audio/wav', 'id', config,
      async () => new Response(JSON.stringify(data))), /diarization/);
  }
});
test('adding Qwen does not reroute Whisper requests or change their credentials', async () => {
  const config = loadConfig({ STT_MODEL: 'small', STT_BASE_URL: 'http://whisper/v1',
    STT_API_KEY: 'whisper-only', QWEN_STT_BASE_URL: 'http://qwen/v1', QWEN_STT_API_KEY: 'qwen-only' });
  await transcribeAudio(Buffer.from('clip'), 'audio/wav', 'en', config, async (url, options) => {
    assert.equal(url, 'http://whisper/v1/audio/transcriptions');
    assert.equal(options.headers.Authorization, 'Bearer whisper-only');
    return new Response('{"text":"Hello"}');
  });
});
