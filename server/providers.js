import { GoogleGenAI } from '@google/genai';
import { setTimeout as delay } from 'node:timers/promises';
import { attributedSpeakerName } from './qwenLiveConfig.js';

export class ServiceError extends Error {
  constructor(message, status = 502, details = {}) { super(message); this.status = status; Object.assign(this, details); }
}

export function parseSummary(text) {
  if (typeof text !== 'string') throw new ServiceError('The summary service returned invalid content');
  let result;
  try { result = JSON.parse(text); } catch {
    const block = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    try { result = JSON.parse(block?.[1] || ''); } catch { throw new ServiceError('The summary service did not return valid JSON'); }
  }
  const strings = value => Array.isArray(value) && value.every(item => typeof item === 'string');
  if (!result || typeof result.title !== 'string' || typeof result.executiveSummary !== 'string' ||
      !['keyDiscussionPoints', 'decisions', 'attendanceSummary'].every(key => strings(result[key])) ||
      !Array.isArray(result.actionItems) || !result.actionItems.every(item => item &&
        ['task', 'assignee', 'deadline'].every(key => typeof item[key] === 'string') && ['High', 'Medium', 'Low'].includes(item.priority))) {
    throw new ServiceError('The summary service returned an invalid summary schema');
  }
  return {
    title: result.title, executiveSummary: result.executiveSummary,
    keyDiscussionPoints: result.keyDiscussionPoints, decisions: result.decisions,
    actionItems: result.actionItems, attendanceSummary: result.attendanceSummary,
  };
}

export async function fetchJson(url, options, timeoutMs, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      const retryAfter = response.headers.get('retry-after');
      const seconds = retryAfter === null ? NaN : Number(retryAfter);
      const retryAfterMs = Number.isFinite(seconds) ? Math.max(0, seconds * 1000)
        : Math.max(0, Date.parse(retryAfter) - Date.now()) || 0;
      // Release the response before another attempt can reuse the connection.
      await response.body?.cancel().catch(() => {});
      throw new ServiceError(`The upstream service returned HTTP ${response.status}`, 502, {
        retryable: [408, 429, 500, 502, 503, 504].includes(response.status), retryAfterMs,
      });
    }
    return await response.json();
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new ServiceError('The upstream service timed out. Please retry.', 504, { retryable: true });
    const retryable = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ENETUNREACH', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT'].includes(error.cause?.code)
      || (error instanceof TypeError && error.message === 'fetch failed');
    if (error.cause?.code === 'ECONNREFUSED') throw new ServiceError('The upstream service is not reachable (ECONNREFUSED). Make sure the service is running.', 502, { retryable });
    throw new ServiceError('The upstream service is unavailable or returned invalid JSON', 502, { retryable });
  }
}

// Retry only Office transport failures. The same immutable prompt is used for every
// attempt; summary validation, persistence and dispatch happen once outside this loop.
async function fetchOfficeJson(url, options, config, fetchImpl) {
  const retries = config.llmRetryCount ?? 2;
  const budget = config.llmRetryBudgetMs ?? Math.min(config.llmTimeoutMs * 2, 120000);
  const deadline = Date.now() + budget;
  for (let attempt = 0; ; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new ServiceError('The upstream service timed out. Please retry.', 504);
    try {
      return await fetchJson(url, options, Math.min(config.llmTimeoutMs, remaining), fetchImpl);
    } catch (error) {
      if (!error.retryable || attempt >= retries) throw error;
      const wait = Math.max((config.llmRetryDelayMs ?? 500) * 2 ** attempt, error.retryAfterMs || 0);
      // Never ignore Retry-After or exceed the overall request budget.
      if (wait >= deadline - Date.now()) throw error;
      await delay(wait);
    }
  }
}

const PHONETIC_CORRECTIONS = [
  [/\bperlombongan\b/gi, 'permohonan'],
  [/\bnestet(nya)?\b/gi, (_, nya) => (nya ? 'nested-nya' : 'nested')],
  [/\bkondisionil\b/gi, 'kondisional'],
  [/\bspiking\b/gi, 'speaking'],
  [/\b(bali\s*tower|balitower)\b/gi, 'Bali Tower'],
  [/\blive\s*kit\b/gi, 'LiveKit'],
  [/\benok\b/gi, 'NOC'],
  [/\bwebrtc\b/gi, 'WebRTC'],
];

export function normalizeTranscriptText(text) {
  if (typeof text !== 'string' || !text) return text;
  let result = text;
  for (const [pattern, replacement] of PHONETIC_CORRECTIONS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function effectiveLlm(config) {
  if (config.llmProvider === 'office' && config.llmKey) return 'office';
  if (config.llmProvider === 'gemini' && config.geminiKey) return 'gemini';
  return 'demo';
}

export async function summarize(meeting, config, fetchImpl = fetch) {
  const dialogue = meeting.transcripts.map(entry => {
    const time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '';
    const prefix = time ? `--- [${time}]` : '---';
    if (entry.segments && entry.segments.length > 0) {
        return entry.segments.map(seg => `${prefix} [${attributedSpeakerName(entry.speakerName,seg)}]: ${normalizeTranscriptText(seg.text)}`).join('\n');
    }
    return `${prefix} [${entry.speakerName}]: ${normalizeTranscriptText(entry.text)}`;
  }).join('\n');
  const attendance = [...meeting.participants.values()].filter(person => person.joinedAt).map(person => `${person.employeeName} (${person.employeeId})`);
  const prompt = `Summarize this meeting in the language spoken. Do not invent decisions, deadlines, conditions or assignments. Use empty arrays if none were stated.

ASR Speech-to-Text Interpretation & Normalization Guidelines:
- The dialogue was transcribed by ASR. Resolve any minor phonetic mishearings or code-switching technical loanwords into their intended meaning based on context (e.g. "perlombongan" -> "permohonan", "nestet" -> "nested", "kondisionil" -> "kondisional", "spiking" -> "speaking").
- Base all key discussion points, decisions, and action items on the intended contextual meaning, not on literal phonetic distortions.

Guidelines for actionItems:
- Extract all actionable tasks agreed upon in the meeting.
- 'task': Clear, specific description of the task.
- 'assignee': PIC / Penanggung Jawab. Attribute to the person assigned, commanded, or committed to do the task. If a speaker commands or delegates to a specific person (e.g. "Siti, tolong periksa log" or "Rian kamu handle vendor"), the assignee must be that named person (e.g. "Siti" or "Rian"), NOT the speaker who gave the command. If multiple diarized speakers appear under one participant without names, distinguish them as "\${Speaker} (person_0)".
- 'deadline': Tenggat waktu / batas waktu / syarat pengerjaan (e.g. "Hari ini sebelum 15:00; Syarat: tanpa memutus koneksi"). If none, use empty string "".
- 'priority': "High", "Medium", or "Low".

Return only JSON with this exact shape:
{"title":"string","executiveSummary":"string","keyDiscussionPoints":["string"],"decisions":["string"],"actionItems":[{"task":"string","assignee":"string","priority":"High|Medium|Low","deadline":"string"}],"attendanceSummary":["string"]}
Meeting: ${meeting.roomName}\nConnected attendees: ${attendance.join(', ')}\nDialogue:\n${dialogue}`;
  const provider = effectiveLlm(config);
  if (provider === 'demo') {
    return {
      title: `Meeting: ${meeting.roomName}`, executiveSummary: `Pratinjau demo: ${meeting.transcripts.length} kalimat tersimpan. Ringkasan AI belum tersedia.`,
      keyDiscussionPoints: meeting.transcripts.flatMap(entry => {
        if (entry.segments && entry.segments.length > 0) {
          return entry.segments.map(seg => `${attributedSpeakerName(entry.speakerName,seg)}: ${seg.text}`);
        }
        return [`${entry.speakerName}: ${entry.text}`];
      }),
      decisions: [], actionItems: [], attendanceSummary: attendance,
      provider: 'Demo (no AI model)', note: 'Mode demo hanya menampilkan transkrip; atur penyedia dan kunci LLM di server untuk ringkasan AI.',
    };
  }
  let content;
  if (provider === 'office') {
    const data = await fetchOfficeJson(`${config.llmBaseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.llmKey}` },
      body: JSON.stringify({
        model: config.llmModel,
        messages: [{ role: 'user', content: prompt }],
        chat_template_kwargs: { enable_thinking: false },
        temperature: 0.2,
        max_tokens: 4096,
      }),
    }, config, fetchImpl);
    content = data.choices?.[0]?.message?.content;
  } else {
    try {
      const client = new GoogleGenAI({ apiKey: config.geminiKey });
      const response = await client.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt, config: {
        responseMimeType: 'application/json', httpOptions: { timeout: config.llmTimeoutMs },
      } });
      content = response.text;
    } catch { throw new ServiceError('Gemini is unavailable or timed out. Please retry.'); }
  }
  return { ...parseSummary(content), attendanceSummary: attendance, provider: provider === 'office' ? `Office (${config.llmModel})` : 'Gemini 2.5 Flash' };
}

export async function transcribeAudio(audio, mimeType, language, config, fetchImpl = fetch) {
  const qwen = config.sttModel === 'qwen3-asr-0.6b';
  const baseUrl = qwen ? config.qwenSttBaseUrl : config.sttBaseUrl;
  const key = qwen ? config.qwenSttKey : config.sttKey;
  if (!baseUrl || !config.sttModel) throw new ServiceError('Backend speech-to-text is not configured', 503);
  if (qwen && config.sttDiarization && !config.qwenDiarizationEnabled) throw new ServiceError('Qwen diarization belum diaktifkan untuk pengujian. Nonaktifkan mode mikrofon ruang rapat atau pilih model lain.', 400);
  const extensions = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4', 'audio/wav': 'wav' };
  const extension = extensions[mimeType.split(';')[0]];
  if (!extension) throw new ServiceError('Unsupported audio format', 415);
  const form = new FormData();
  form.append('file', new Blob([audio], { type: mimeType }), `speech.${extension}`);
  form.append('model', config.sttModel);
  form.append('language', language);
  form.append('response_format', 'json');
  if (config.sttDiarization) form.append('diarize', 'true');
  const data = await fetchJson(`${baseUrl.replace(/\/+$/, '')}/audio/transcriptions`, {
    method: 'POST', headers: key ? { Authorization: `Bearer ${key}` } : {}, body: form,
  }, qwen ? config.qwenSttTimeoutMs : config.sttTimeoutMs, fetchImpl);
  if (typeof data.text !== 'string') throw new ServiceError('The speech service returned no text field');
  const text = normalizeTranscriptText(data.text.trim());
  if (!config.sttDiarization) return { text };
  if (!data.segments) {
    if (qwen) throw new ServiceError('The Qwen service returned no diarization segments');
    return { text };
  }
  if (!Array.isArray(data.segments) || data.segments.length > 10000) throw new ServiceError('The speech service returned invalid diarization segments');
  const segments = data.segments.map(segment => {
    if (!segment || typeof segment.text !== 'string' || typeof segment.speaker !== 'string' ||
        !segment.speaker || segment.speaker.length > 100 || !Number.isFinite(segment.start) ||
        !Number.isFinite(segment.end) || segment.start < 0 || segment.end < segment.start) {
      throw new ServiceError('The speech service returned invalid diarization segments');
    }
    return { text: normalizeTranscriptText(segment.text.trim()), speaker: segment.speaker, start: segment.start, end: segment.end };
  }).filter(segment => segment.text);
  if (text && !segments.length) throw new ServiceError('The speech service returned no diarization for its text');
  return { text, segments };
}

export async function batchDiarizeAudio(audioBuffers, mimeType, language, config, fetchImpl = fetch) {
  if (!config.sttBaseUrl) throw new ServiceError('Backend speech-to-text is not configured', 503);
  const extensions = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4', 'audio/wav': 'wav', 'audio/mpeg': 'mp3' };
  const extension = extensions[(mimeType || '').split(';')[0]] || 'webm';
  const form = new FormData();

  if (Array.isArray(audioBuffers)) {
    for (let i = 0; i < audioBuffers.length; i++) {
      form.append('files', new Blob([audioBuffers[i]], { type: mimeType || 'audio/webm' }), `chunk_${i}.${extension}`);
    }
  } else if (audioBuffers) {
    form.append('file', new Blob([audioBuffers], { type: mimeType || 'audio/wav' }), `recording.${extension}`);
  }
  form.append('model', config.sttModel || 'base');
  form.append('language', language || 'id');

  const timeoutMs = Math.max(config.sttTimeoutMs || 60000, 180000);
  const data = await fetchJson(`${config.sttBaseUrl.replace(/\/+$/, '')}/audio/batch-diarize`, {
    method: 'POST',
    headers: config.sttKey ? { Authorization: `Bearer ${config.sttKey}` } : {},
    body: form,
  }, timeoutMs, fetchImpl);

  if (!data || !Array.isArray(data.segments)) {
    throw new ServiceError('The batch diarization service returned invalid segments');
  }

  const segments = data.segments.map(segment => {
    if (!segment || typeof segment.text !== 'string' || typeof segment.speaker !== 'string' ||
        !segment.speaker || segment.speaker.length > 100 || !Number.isFinite(segment.start) ||
        !Number.isFinite(segment.end) || segment.start < 0 || segment.end < segment.start) {
      throw new ServiceError('The batch diarization service returned invalid diarization segments');
    }
    return { text: normalizeTranscriptText(segment.text.trim()), speaker: segment.speaker, start: segment.start, end: segment.end };
  }).filter(segment => segment.text);

  return {
    text: (data.text || '').trim(),
    segments,
    speakerCount: Number(data.speaker_count || new Set(segments.map(s => s.speaker)).size),
    speakers: Array.isArray(data.speakers) ? data.speakers : [...new Set(segments.map(s => s.speaker))],
    duration: Number(data.duration || 0),
  };
}
