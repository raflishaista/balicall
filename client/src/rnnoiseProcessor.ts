import type { AudioProcessorOptions, TrackProcessor, Track } from 'livekit-client';
import { RnnoiseWorkletNode, loadRnnoise } from '@sapphi-red/web-noise-suppressor';

let cachedWasmBinary: Promise<ArrayBuffer> | null = null;
const loadedWorkletContexts = new WeakSet<AudioContext>();

async function getRnnoiseBinary(): Promise<ArrayBuffer> {
  if (!cachedWasmBinary) {
    cachedWasmBinary = loadRnnoise({
      url: '/rnnoise/rnnoise.wasm',
      simdUrl: '/rnnoise/rnnoise_simd.wasm',
    });
  }
  return await cachedWasmBinary;
}

export class RnnoiseAudioProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = 'rnnoise-audio-processor';
  processedTrack?: MediaStreamTrack;

  private sourceNode?: MediaStreamAudioSourceNode;
  private workletNode?: RnnoiseWorkletNode;
  private destinationNode?: MediaStreamAudioDestinationNode;
  private destroyed = false;

  static get isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof AudioContext !== 'undefined' &&
      typeof AudioWorkletNode !== 'undefined' &&
      typeof WebAssembly !== 'undefined'
    );
  }

  async init(opts: AudioProcessorOptions): Promise<void> {
    this.destroyed = false;
    const { track, audioContext } = opts;

    if (!loadedWorkletContexts.has(audioContext)) {
      try {
        await audioContext.audioWorklet.addModule('/rnnoise/workletProcessor.js');
        loadedWorkletContexts.add(audioContext);
      } catch (err) {
        // May already be added if re-initializing on the same context
        console.warn('RNNoise worklet module addModule:', err);
      }
    }

    const wasmBinary = await getRnnoiseBinary();
    if (this.destroyed) return;

    this.sourceNode = audioContext.createMediaStreamSource(new MediaStream([track]));
    this.workletNode = new RnnoiseWorkletNode(audioContext, {
      wasmBinary,
      maxChannels: 1,
    });
    this.destinationNode = audioContext.createMediaStreamDestination();

    this.sourceNode.connect(this.workletNode);
    this.workletNode.connect(this.destinationNode);

    this.processedTrack = this.destinationNode.stream.getAudioTracks()[0];
  }

  async restart(opts: AudioProcessorOptions): Promise<void> {
    await this.destroy();
    await this.init(opts);
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = undefined;
    }
    if (this.workletNode) {
      try {
        this.workletNode.disconnect();
        this.workletNode.destroy();
      } catch {
        // Ignore disconnect errors during teardown
      }
      this.workletNode = undefined;
    }
    if (this.destinationNode) {
      this.destinationNode.disconnect();
      this.destinationNode = undefined;
    }
    if (this.processedTrack) {
      this.processedTrack.stop();
      this.processedTrack = undefined;
    }
  }
}
