import { validSourceEvidence, type MeetingSummary } from './summaryHistory';
export function SummaryEvidence({summary}: {summary: Pick<MeetingSummary,'sourceEvidence'|'decisions'|'actionItems'>}) {
  const evidence=summary.sourceEvidence;
  if (!validSourceEvidence(evidence) || !evidence.items.length) return null;
  return <details className="summary-evidence">
    <summary>Rujukan keputusan & tugas ({evidence.items.length})</summary>
    <p className="summary-evidence-help">Bandingkan hasil notulen dengan kutipan transkrip. Kecocokan kutipan tidak memastikan suara sudah dikenali dengan benar atau seluruh peserta tercatat.</p>
    <ol>{evidence.items.map(item=>{
      const claim=item.field==='decisions' ? summary.decisions[item.index] : summary.actionItems[item.index]?.task;
      if (!claim) return null;
      return <li key={`${item.field}-${item.index}`}><strong>{item.field==='decisions'?'Keputusan':'Tugas'} {item.index+1}: {claim}</strong>
        {item.sources.map((source,index)=><figure key={`${source.utteranceId}-${index}`}><blockquote>{source.quote}</blockquote><figcaption>{source.speaker} · {source.utteranceId}{source.timestamp && Number.isFinite(Date.parse(source.timestamp)) ? ` · ${new Date(source.timestamp).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}` : ''}</figcaption></figure>)}
      </li>;
    })}</ol>
  </details>;
}
