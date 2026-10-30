import {useCallback,useEffect,useState} from 'react';
import {Check, X, ShieldCheck, Loader2} from 'lucide-react';
import {apiRequest} from './api';
import './McpReviewPanel.css';

export interface McpReview {
  revision:string;planDigest:string;status:string;canDecide:boolean;
  operations:{method:string;args:Record<string,unknown>}[];
  evidence?:{field:string;index:number;sources:{utteranceId:string;speaker?:string;quote:string}[]}[];
  error?:string|null;note?:string|null;decidedBy?:string|null;
  results?:{index:number;method:string;status:string;id?:string|null}[];
}
const labels:Record<string,string>={pending:'Menunggu persetujuan host',ready:'Menunggu persetujuan host',blocked:'Tinjauan belum siap',rejected:'Host memilih tidak mengirim',sending:'Mengirim perubahan yang disetujui',sent:'Perubahan telah dikirim',needs_check:'Hasil perlu diperiksa di IT Project'};
const evidenceLabels:Record<string,string>={actionItems:'Tindak lanjut',decisions:'Keputusan',taskUpdates:'Perubahan status task',taskEdits:'Perubahan task',projectCreations:'Proyek baru',projectUpdates:'Perubahan proyek'};
const actions:Record<string,string>={createTask:'Buat task',createProject:'Buat proyek',updateTask:'Edit task',updateTaskStatus:'Ubah status task',updateProject:'Edit proyek',assignSprintTasks:'Masukkan task ke sprint'};
export function McpReviewPanel({meetingId,token,summaryVersion,request=apiRequest}:{meetingId:string;token:string;summaryVersion?:string;request?:typeof apiRequest}) {
  const [review,setReview]=useState<McpReview|null>(null);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const load=useCallback(async(signal?:AbortSignal)=>{
    setLoading(true);setError(null);
    try {
      const result=await request<McpReview>(`/mcp-reviews/${encodeURIComponent(meetingId)}`,{headers:token?{Authorization:`Bearer ${token}`}:{},signal},60000);
      if(!signal?.aborted)setReview(result);
    } catch(e){if(!signal?.aborted)setError(e instanceof Error?e.message:'Status persetujuan belum dapat dimuat.');}
    finally{if(!signal?.aborted)setLoading(false);}
  },[meetingId,token,request]);
  useEffect(()=>{const controller=new AbortController();void load(controller.signal);return()=>controller.abort();},[load,summaryVersion]);
  const decide=async(decision:boolean)=>{
    if(!review || busy)return;setBusy(true);setError(null);
    try {
      const result=await request<McpReview>(`/mcp-reviews/${encodeURIComponent(meetingId)}/decision`,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({decision,revision:review.revision,planDigest:review.planDigest})},120000);
      setReview(result);if(result.status==='pending')await load();
    }catch(e){setError(e instanceof Error?e.message:'Keputusan belum dapat disimpan. Periksa status sebelum mencoba lagi.');}
    finally{setBusy(false);}
  };
  if(!meetingId)return null;
  return <section className="mcp-review" aria-label="Persetujuan pengiriman MCP" aria-busy={loading||busy}>
    <header><ShieldCheck size={25}/><div><h2>Tinjau sebelum kirim ke MCP</h2><p>Periksa perubahan berikut sebelum dikirim ke IT Project.</p></div><span className="mcp-review-status" role="status">{loading?'Memuat tinjauan…':review?labels[review.status] || review.status:'Status belum tersedia'}</span></header>
    {error&&<p role="alert" className="mcp-review-error">{error}</p>}
    {review?.error&&<p role="alert" className="mcp-review-error">{review.error}</p>}
    {review?.note&&<p>{review.note}</p>}
    {!!review?.operations.length&&<ol className="mcp-review-operations">{review.operations.map((op,index)=><li key={index}><strong>{actions[op.method] || op.method}</strong><p>{String(op.args.title || op.args.task || op.args.project || '')}</p><details><summary>Periksa seluruh field dan target</summary><pre>{JSON.stringify(op.args,null,2)}</pre></details></li>)}</ol>}
    {!!review?.evidence?.length&&<details className="mcp-review-evidence"><summary>Rujukan ucapan rapat</summary>{review.evidence.map((item,i)=><div key={i}><strong>{evidenceLabels[item.field] || item.field} #{item.index+1}</strong>{item.sources.map((source,j)=><blockquote key={j}>“{source.quote}”<cite>{source.speaker || "Pembicara"} · {source.utteranceId}</cite></blockquote>)}</div>)}</details>}
    {review?.canDecide && !loading && <>
      <p>{review.status==='ready' && !review.operations.length?'Tidak ada perubahan MCP yang perlu dikirim.':'Belum ada perubahan yang dikirim dari tinjauan ini.'}</p>
      <div className="mcp-review-buttons">
        <button type="button" className="button-primary" disabled={busy||!review.planDigest||!['ready','rejected'].includes(review.status)} onClick={()=>void decide(true)}>{busy?<Loader2 className="ui-spinner" size={17}/>:<Check size={17}/>}Ya, kirim ke MCP</button>
        <button type="button" className="button-secondary" disabled={busy||review.status==='rejected'} onClick={()=>void decide(false)}><X size={17}/>Tidak, jangan kirim</button>
      </div><p className="mcp-review-help">Hanya host yang dapat memilih. Pilihan Tidak tetap menyimpan notulen dan transkrip.</p>
    </>}
    {review && !review.canDecide && review.status!=='sent' && <p>Persetujuan hanya dapat diberikan oleh host rapat.</p>}
    {!!review?.results?.length&&<details><summary>Hasil per aksi ({review.results.length})</summary><ol>{review.results.map(r=><li key={r.index}>{actions[r.method] || r.method}: {r.status==='sent'?'Terkirim':r.status}{r.id?` · ${r.id}`:''}</li>)}</ol></details>}
    <button type="button" className="text-button" disabled={loading||busy} onClick={()=>void load()}>Periksa status lagi</button>
  </section>;
}
