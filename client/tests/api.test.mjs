import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiRequest, ApiError, API_BASE, meetingPath, featureError } from '../src/api.ts';

test('API failures include a safe reference and feature-specific recovery message',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
 globalThis.fetch=async()=>new Response(JSON.stringify({error:'Server could not complete the request.'}),{status:500,headers:{'X-Request-ID':'01234567-89ab-cdef-0123-456789abcdef'}});
 await assert.rejects(apiRequest('/test'),error=>error.status===500&&error.requestId==='01234567-89ab-cdef-0123-456789abcdef'&&featureError('Memulai rekaman',error).includes('Referensi: 01234567'));
 assert.match(featureError('Memulai rekaman',new ApiError('Unexpected internal details',500)),/^Memulai rekaman gagal\. Layanan mengalami gangguan/);
 assert.equal(featureError('Kamera',new Error('Izin ditolak')),'Kamera gagal. Izin ditolak');
});

test('API defaults to a relative path and encodes session identifiers', () => {
  assert.equal(API_BASE, '/api');
  assert.equal(meetingPath('a/b', 'transcript'), '/meetings/a%2Fb/transcript');
});

test('API errors preserve server messages and distinguish permanent errors from retryable failures', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'No access' }), { status: 403 });
  await assert.rejects(apiRequest('/test'), error => error instanceof ApiError && error.message === 'No access' && !error.retryable);
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Timed out' }), { status: 504 });
  await assert.rejects(apiRequest('/test'), error => error instanceof ApiError && error.retryable);
});

test('API applies its timeout even when the caller supplies a cancellation signal', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const keepAlive = setInterval(() => {}, 10); t.after(() => clearInterval(keepAlive));
  globalThis.fetch = async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  await assert.rejects(apiRequest('/test', { signal: new AbortController().signal }, 20), error => error instanceof ApiError && error.retryable);
});
