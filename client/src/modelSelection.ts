import type {LiveFinal} from './liveTranscription.ts';

export const SEA_LIVE_MODEL = 'sea-asr-id-live';
export const SEA_LIVE_NOTICE = 'SEA-ASR-ID Live masih Pilot; QC produksi belum lulus. Label mengikuti akun peserta dan sesi mikrofon. Aktifkan mode mikrofon ruang rapat saat Nemotron tersedia untuk memberi label beberapa suara; batas ambigu ditandai belum diketahui atau bertumpuk.';

export const SEA_LIVE_DIARIZATION_NOTICE = 'SEA + Nemotron: label Pembicara 1/2 berlaku per sesi mikrofon, bukan identitas orang. Nama dapat diedit manual. Sesi dipertahankan hingga 45 detik saat mute/reconnect; label baru perlu diperiksa setelah sesi berakhir. Suara ambigu atau bertumpuk ditandai. Masih Pilot.';

export function modelOptions(models: string[]) {
  return [...new Set([...models, SEA_LIVE_MODEL])].map(model => ({model, disabled: !models.includes(model)}));
}

export function isLiveTranscriptionModel(model: string) {
  return ['whisperlivekit-small', 'qwen3-asr-0.6b-live', SEA_LIVE_MODEL].includes(model);
}

export function modelPreferencePatch(model: string) {
  return {transcriptionModel:model, ...(model === SEA_LIVE_MODEL ? {
    speechLanguage:'id-ID' as const, sharedRoomMic:false, liveDiarization:true, batchDiarization:false,
  } : {})};
}

export function liveTranscriptBody(value: LiveFinal, model: string, requestId: string) {
  if (typeof value === 'string') return {text:value.trim(), requestId};
  if (!['qwen3-asr-0.6b-live', SEA_LIVE_MODEL].includes(model)) throw new Error('Model transkrip live tidak valid.');
  return {sttModel:model, final:value};
}
