import type { LocalVideoTrack } from 'livekit-client';
import type { BackgroundProcessorWrapper, SwitchBackgroundProcessorOptions } from '@livekit/track-processors';

export type BackgroundChoice = { id: string; label: string; imagePath?: string };
export const NO_BACKGROUND: BackgroundChoice = { id: 'none', label: 'Tanpa efek' };
export const BLUR_BACKGROUND: BackgroundChoice = { id: 'blur', label: 'Blur' };
export function validateBackgroundFile(file: Pick<File, 'type' | 'size'>) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Gunakan gambar JPG, PNG, atau WebP.');
  if (!file.size || file.size > 5 * 1024 * 1024) throw new Error('Ukuran gambar maksimal 5 MB.');
}
export function backgroundOptions(choice: BackgroundChoice): SwitchBackgroundProcessorOptions {
  if (choice.id === 'none') return { mode: 'disabled' };
  if (choice.id === 'blur') return { mode: 'background-blur', blurRadius: 15 };
  if (!choice.imagePath) throw new Error('Gambar latar belum tersedia.');
  return { mode: 'virtual-background', imagePath: choice.imagePath };
}

// Serialize mode changes and release the processor even when leaving during model loading.
export class BackgroundEffectSession {
  private track?: LocalVideoTrack;
  private processor?: BackgroundProcessorWrapper;
  private closed = false;
  private tail: Promise<unknown> = Promise.resolve();
  private createProcessor: (options: SwitchBackgroundProcessorOptions) => BackgroundProcessorWrapper;
  constructor(createProcessor: (options: SwitchBackgroundProcessorOptions) => BackgroundProcessorWrapper) {
    this.createProcessor = createProcessor;
  }
  apply(track: LocalVideoTrack, choice: BackgroundChoice): Promise<boolean> {
    const task = this.tail.then(async () => {
      if (this.closed) return false;
      if (this.track !== track) { await this.detach(); this.track = track; }
      if (choice.id === 'none') {
        if (this.processor && track.getProcessor() === this.processor) await this.processor.switchTo({ mode: 'disabled' });
        return !this.closed;
      }
      const options = backgroundOptions(choice);
      try {
        if (this.processor && track.getProcessor() === this.processor) {
          await this.processor.switchTo(options);
        } else {
          this.processor = this.createProcessor(options);
          await track.setProcessor(this.processor);
          // The SDK logs initial image-load errors; switching explicitly propagates them.
          await this.processor.switchTo(options);
        }
        if (this.closed) { await this.detach(); return false; }
        return true;
      } catch (error) {
        await this.detach().catch(() => {});
        throw error;
      }
    });
    this.tail = task.catch(() => {});
    return task;
  }
  private async detach() {
    const track = this.track, processor = this.processor;
    this.track = undefined; this.processor = undefined;
    if (!processor) return;
    await processor.switchTo({ mode: 'disabled' }).catch(() => {});
    if (track?.getProcessor() === processor) await track.stopProcessor();
    else await processor.destroy();
  }
  close(): Promise<void> {
    this.closed = true;
    return this.tail.then(() => this.detach());
  }
}
