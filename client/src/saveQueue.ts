interface Job<T> { id: string; run: (id: string) => Promise<T> }

// Serial execution preserves speaker order. A failed job stays at the front,
// and keeps the same ID when retried after an uncertain network response.
export function createSaveQueue<T>(options: {
  onSaved: (value: T) => void;
  onChange: (count: number, error: string | null) => void;
  retryDelayMs?: number;
}) {
  const jobs: Job<T>[] = [];
  let worker: Promise<void> | null = null;
  let error: string | null = null;
  const emit = () => options.onChange(jobs.length, error);
  const pump = () => {
    if (worker || error || !jobs.length) return;
    worker = Promise.resolve().then(async () => {
      while (jobs.length && !error) {
        const job = jobs[0];
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const result = await job.run(job.id);
            jobs.shift();
            options.onSaved(result);
            emit();
            break;
          } catch (failure) {
            const retryable = !(failure && typeof failure === 'object' && 'retryable' in failure && !failure.retryable);
            if (attempt === 2 || !retryable) {
              error = failure instanceof Error ? failure.message : 'Gagal menyimpan transkrip';
              emit();
              break;
            }
            await new Promise(resolve => setTimeout(resolve, (options.retryDelayMs ?? 300) * (attempt + 1)));
          }
        }
      }
    }).finally(() => { worker = null; });
  };
  return {
    enqueue(run: Job<T>['run'], id = crypto.randomUUID()) { jobs.push({ id, run }); emit(); pump(); },
    retry() { error = null; emit(); pump(); },
    async flush() {
      if (error) { error = null; emit(); }
      pump();
      while (worker) { await worker; if (!error) pump(); }
      if (jobs.length) throw new Error(error || 'Masih ada transkrip yang belum tersimpan');
    },
    get pending() { return jobs.length; },
  };
}
