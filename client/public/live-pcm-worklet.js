// AudioWorklet: resample to mono PCM16 at 16 kHz without taking ownership of the microphone.
class LivePCM extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = []; this.sum = 0; this.count = 0; this.phase = 0;
    this.port.onmessage = ({ data }) => {
      if (data === 'flush') { this.send(); this.port.postMessage('flushed'); }
    };
  }
  send() {
    if (!this.samples.length) return;
    const pcm = new Int16Array(this.samples);
    this.samples = [];
    this.port.postMessage(pcm.buffer, [pcm.buffer]);
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i] / channels.length;
      this.sum += value; this.count++; this.phase += 16000;
      if (this.phase >= sampleRate) {
        const value = Math.max(-1, Math.min(1, this.sum / this.count));
        this.samples.push(Math.round(value * (value < 0 ? 32768 : 32767)));
        this.phase -= sampleRate; this.sum = 0; this.count = 0;
        if (this.samples.length >= 3200) this.send();
      }
    }
    return true;
  }
}
registerProcessor('live-pcm', LivePCM);
