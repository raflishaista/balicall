import type {LiveFinal} from './liveTranscription.ts';

export const SEA_LIVE_MODEL = 'sea-asr-id-live';
export const QWEN_GGUF_LIVE_MODEL = 'qwen3-asr-0.6b-gguf-q8-live';
export const QWEN_GGUF_LIVE_NOTICE = 'Qwen Q8 + Nemotron: audio diproses per potongan. Label berlaku per sesi mikrofon, bukan identitas orang; suara ambigu atau bertumpuk ditandai.';
export const SEA_LIVE_NOTICE = 'SEA-ASR-ID Live: QC produksi belum lulus. Label mengikuti akun peserta dan sesi mikrofon. Aktifkan mode mikrofon ruang rapat saat Nemotron tersedia untuk memberi label beberapa suara; batas ambigu ditandai belum diketahui atau bertumpuk.';


export const MING_LIVE_MODEL = 'ming3-asr-tiny-live';
export const MING_LIVE_NOTICE = 'Ming ASR Tiny: transkripsi Inggris per potongan audio. Pembicara memakai nama akun peserta; diarization belum tersedia.';

export function modelOptions(models: string[]) {
  return [...new Set([...models.filter(model => model !== MING_LIVE_MODEL), SEA_LIVE_MODEL])].map(model => ({model, disabled: !models.includes(model)}));
}

export function isLiveTranscriptionModel(model: string) {
  return ['whisperlivekit-small', 'qwen3-asr-0.6b-live', QWEN_GGUF_LIVE_MODEL, MING_LIVE_MODEL, SEA_LIVE_MODEL].includes(model);
}

export function modelPreferencePatch(model: string) {
  return {transcriptionModel:model, ...(model === MING_LIVE_MODEL ? {
    speechLanguage:'en-US' as const, sharedRoomMic:false, liveDiarization:false, batchDiarization:false,
  } : model === SEA_LIVE_MODEL ? {
    speechLanguage:'id-ID' as const, sharedRoomMic:false, liveDiarization:true, batchDiarization:false,
  } : {})};
}

export function liveTranscriptBody(value: LiveFinal, model: string, requestId: string) {
  if (typeof value === 'string') return {text:value.trim(), requestId};
  if (!['qwen3-asr-0.6b-live', QWEN_GGUF_LIVE_MODEL, MING_LIVE_MODEL, SEA_LIVE_MODEL].includes(model)) throw new Error('Model transkrip live tidak valid.');
  return {sttModel:model, final:value};
}
