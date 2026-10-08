import { GoogleGenAI } from '@google/genai';

export class ServiceError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
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
    if (!response.ok) throw new ServiceError(`The upstream service returned HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new ServiceError('The upstream service timed out. Please retry.', 504);
    throw new ServiceError('The upstream service is unavailable or returned invalid JSON');
  }
}

export function effectiveLlm(config) {
  if (config.llmProvider === 'office' && config.llmKey) return 'office';
  if (config.llmProvider === 'gemini' && config.geminiKey) return 'gemini';
  return 'demo';
}

export async function summarize(meeting, config, fetchImpl = fetch) {
  const dialogue = meeting.transcripts.map(entry => `[${entry.speakerName}]: ${entry.text}`).join('\n');
  const attendance = [...meeting.participants.values()].filter(person => person.joinedAt).map(person => `${person.employeeName} (${person.employeeId})`);
  const prompt = `Summarize this meeting in the language spoken. Do not invent decisions, deadlines or assignments. Use empty arrays if none were stated. Return only JSON with this exact shape:
{"title":"string","executiveSummary":"string","keyDiscussionPoints":["string"],"decisions":["string"],"actionItems":[{"task":"string","assignee":"string","priority":"High|Medium|Low","deadline":"string"}],"attendanceSummary":["string"]}
Meeting: ${meeting.roomName}\nConnected attendees: ${attendance.join(', ')}\nDialogue:\n${dialogue}`;
  const provider = effectiveLlm(config);
  if (provider === 'demo') {
    return {
      title: `Meeting: ${meeting.roomName}`, executiveSummary: `Pratinjau demo: ${meeting.transcripts.length} kalimat tersimpan. Ringkasan AI belum tersedia.`,
      keyDiscussionPoints: meeting.transcripts.map(entry => `${entry.speakerName}: ${entry.text}`),
      decisions: [], actionItems: [], attendanceSummary: attendance,
      provider: 'Demo (no AI model)', note: 'Mode demo hanya menampilkan transkrip; atur penyedia dan kunci LLM di server untuk ringkasan AI.',
    };
  }
  let content;
  if (provider === 'office') {
    const data = await fetchJson(`${config.llmBaseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.llmKey}` },
      body: JSON.stringify({
        model: config.llmModel,
        messages: [{ role: 'user', content: prompt }],
        chat_template_kwargs: { enable_thinking: false },
        temperature: 0.2,
      }),
    }, config.llmTimeoutMs, fetchImpl);
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
  if (!config.sttBaseUrl || !config.sttModel) throw new ServiceError('Backend speech-to-text is not configured', 503);
  const extensions = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4', 'audio/wav': 'wav' };
  const extension = extensions[mimeType.split(';')[0]];
  if (!extension) throw new ServiceError('Unsupported audio format', 415);
  const form = new FormData();
  form.append('file', new Blob([audio], { type: mimeType }), `speech.${extension}`);
  form.append('model', config.sttModel);
  form.append('language', language);
  form.append('response_format', 'json');
  if (config.sttDiarization) form.append('diarize', 'true');
  const data = await fetchJson(`${config.sttBaseUrl.replace(/\/+$/, '')}/audio/transcriptions`, {
    method: 'POST', headers: config.sttKey ? { Authorization: `Bearer ${config.sttKey}` } : {}, body: form,
  }, config.sttTimeoutMs, fetchImpl);
  if (typeof data.text !== 'string') throw new ServiceError('The speech service returned no text field');
  const text = data.text.trim();
  if (!config.sttDiarization) return { text };
  if (!Array.isArray(data.segments) || data.segments.length > 10000) throw new ServiceError('The speech service returned invalid diarization segments');
  const segments = data.segments.map(segment => {
    if (!segment || typeof segment.text !== 'string' || typeof segment.speaker !== 'string' ||
        !segment.speaker || segment.speaker.length > 100 || !Number.isFinite(segment.start) ||
        !Number.isFinite(segment.end) || segment.start < 0 || segment.end < segment.start) {
      throw new ServiceError('The speech service returned invalid diarization segments');
    }
    return { text: segment.text.trim(), speaker: segment.speaker, start: segment.start, end: segment.end };
  }).filter(segment => segment.text);
  if (text && !segments.length) throw new ServiceError('The speech service returned no diarization for its text');
  return { text, segments };
}
