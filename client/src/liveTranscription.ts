export interface StreamingFinal {
  sessionProof?: string;
  segmentId: string; sessionId: string; sourceId: string; text: string;
  start: number; end: number; speakerLabel: string; attribution: 'assigned' | 'unknown' | 'overlap';
}
export type LiveFinal = string | StreamingFinal;

export function startLiveTranscription(options: {
  track: MediaStreamTrack;
  createSession: () => Promise<{ url: string }>;
  onFinal: (text: LiveFinal) => void;
  onInterim: (text: string) => void;
  onReady: (ready: boolean) => void;
  onError: (message: string) => void;
  onWarning?: (message: string) => void;
  onSession?: (session: {sessionId?: string; resumed?: boolean; resumeGraceSeconds?: number}) => void;
}) {
  let socket: WebSocket | undefined;
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let worklet: AudioWorkletNode | undefined;
  let gain: GainNode | undefined;
  let stopping = false, drained = false;
  let failure: Error | undefined;
  let resolveDrain: () => void = () => {};
  const drain = new Promise<void>(resolve => { resolveDrain = resolve; });
  let flushAck: () => void = () => {};
  let finishing: Promise<void> | undefined;
  let resumeSupported = false;
  let paused = false;
  const endRetained = async () => {
    const session=await options.createSession();
    const url=new URL(session.url,window.location.href);
    url.protocol=url.protocol==='https:' || url.protocol==='wss:'?'wss:':'ws:';
    url.searchParams.set('end','1');
    const closing=new WebSocket(url);
    let acknowledged=false;
    try {
      await new Promise<void>((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('Sesi mikrofon belum dapat ditutup. Coba lagi.')),15000);
        closing.onmessage=({data})=>{
          try {
            const frame=JSON.parse(data);
            for(const final of frame.final || []) options.onFinal(final);
            if(frame.type==='ready_to_stop'){acknowledged=true;clearTimeout(timer);resolve();}
            else if(frame.type==='error'){clearTimeout(timer);reject(new Error(frame.error));}
          } catch(error){clearTimeout(timer);reject(error);}
        };
        closing.onerror=()=>{clearTimeout(timer);reject(new Error('Sesi mikrofon belum dapat ditutup.'));};
        closing.onclose=()=>{clearTimeout(timer);if(!acknowledged)reject(new Error('Sesi mikrofon belum dapat ditutup.'));};
      });
    } finally {closing.close();}
  };
  const release = () => {
    source?.disconnect(); worklet?.disconnect(); gain?.disconnect();
    if (context && context.state !== 'closed') void context.close();
    options.onReady(false);
  };
  const fail = (message: string) => {
    if (failure) return;
    failure = new Error(message); options.onError(message); resolveDrain(); release(); socket?.close();
  };
  const started = (async () => {
    const session = await options.createSession();
    if (stopping) return;
    const url = new URL(session.url, window.location.href);
    url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:';
    socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Layanan streaming tidak merespons. Coba lagi.')), 15000);
      socket!.onmessage = ({ data }) => {
        try {
          const message = JSON.parse(data);
          if (message.type === 'config') {
            resumeSupported = message.resumeGraceSeconds > 0;
            options.onSession?.(message); clearTimeout(timer); resolve();
          }
          else if (message.type === 'transcript') {
            for (const text of message.final || []) options.onFinal(text);
            options.onInterim(message.interim || '');
          } else if (message.type === 'warning') { options.onWarning?.(message.error || 'Atribusi pembicara belum tersedia.'); }
          else if (message.type === 'ready_to_stop') { drained = true; resolveDrain(); }
          else if (message.type === 'error') throw new Error(message.error || 'Streaming gagal.');
        } catch (error) { clearTimeout(timer); reject(error); fail(error instanceof Error ? error.message : 'Respons streaming tidak valid.'); }
      };
      socket!.onerror = () => { clearTimeout(timer); reject(new Error('Koneksi transkripsi streaming gagal.')); fail('Koneksi transkripsi streaming gagal.'); };
      socket!.onclose = () => {
        clearTimeout(timer);
        if (!drained) { reject(new Error('Koneksi streaming terputus.')); fail('Koneksi streaming terputus sebelum transkrip selesai. Coba lagi.'); }
      };
    });
    if (stopping) return;
    context = new AudioContext({ sampleRate: 16000 });
    await context.audioWorklet.addModule('/live-pcm-worklet.js');
    if (stopping) return;
    source = context.createMediaStreamSource(new MediaStream([options.track]));
    worklet = new AudioWorkletNode(context, 'live-pcm');
    gain = context.createGain(); gain.gain.value = 0;
    worklet.port.onmessage = ({ data }) => {
      if (data === 'flushed') { flushAck(); return; }
      if (socket?.readyState === WebSocket.OPEN) {
        if (socket.bufferedAmount > 160000) { fail('Koneksi streaming terlalu lambat. Coba lagi.'); return; }
        socket.send(data);
      }
    };
    source.connect(worklet); worklet.connect(gain); gain.connect(context.destination);
    await context.resume();
    options.onReady(true);
  })().catch(error => fail(error instanceof Error ? error.message : 'Transkripsi streaming gagal dimulai.'));

  return {
    finish(mode?: {pause?: boolean}) {
      if (finishing) {
        if (paused && !mode?.pause) {
          paused=false;
          const previous=finishing;
          finishing=previous.then(endRetained).catch(error=>{paused=true;finishing=previous;throw error;});
        }
        return finishing;
      }
      stopping = true;
      finishing = (async () => {
        await started;
        if (socket?.readyState === WebSocket.OPEN && !failure) {
          if (worklet) {
            source?.disconnect();
            await new Promise<void>(resolve => {
              const timer = setTimeout(resolve, 500);
              flushAck = () => { clearTimeout(timer); resolve(); };
              worklet!.port.postMessage('flush');
            });
          }
          release();
          paused=Boolean(mode?.pause && resumeSupported);
          socket.send(paused ? JSON.stringify({type:'pause'}) : new ArrayBuffer(0));
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([drain, new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error('Transkrip streaming belum selesai. Coba lagi sebelum keluar.')), 50000);
            })]);
          } finally { clearTimeout(timer); }
        }
        if (failure) throw failure;
      })().finally(() => { release(); socket?.close(); });
      return finishing;
    },
  };
}
