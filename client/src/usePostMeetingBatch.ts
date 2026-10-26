import {useEffect, useState} from 'react';
import {apiRequest} from './api';
import type {MeetingSummary, TranscriptEntry} from './summaryHistory';
export interface PostMeetingBatchJob {
  id: string;
  status: 'queued' | 'transcribing' | 'summarizing' | 'done' | 'failed';
  error?: string;
  transcripts?: TranscriptEntry[];
  summary?: MeetingSummary;
}
export function usePostMeetingBatch({meetingId, token, enabled, onResult}: {
  meetingId: string | null; token: string | null; enabled: boolean;
  onResult: (job: PostMeetingBatchJob) => void;
}) {
  const [state, setState] = useState<{status: string; error?: string} | null>(null);
  useEffect(() => {
    if (!enabled || !meetingId || !token) { setState(null); return; }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const started = Date.now();
    setState(null);
    const poll = async () => {
      try {
        const response = await apiRequest<{requested: boolean; job: PostMeetingBatchJob | null}>(
          `/meetings/${encodeURIComponent(meetingId)}/post-meeting-batch`,
          {headers: {Authorization: `Bearer ${token}`}, signal: controller.signal}, 15000);
        if (controller.signal.aborted) return;
        const job = response.job;
        if (!job && !response.requested) { setState(null); return; }
        setState({status: job?.status || 'waiting', error: job?.error});
        if (job?.status === 'done') { onResult(job); return; }
        if (job?.status === 'failed') return;
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({status:'reconnecting', error: error instanceof Error ? error.message : 'Status batch belum dapat diperiksa.'});
      }
      if (Date.now() - started > 24 * 60 * 60 * 1000) {
        setState({status:'timeout',error:'Pemrosesan belum selesai. Buka kembali hasil rapat untuk memeriksa status.'});
        return;
      }
      timer = setTimeout(() => void poll(), 5000);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [meetingId, token, enabled, onResult]);
  return state;
}
