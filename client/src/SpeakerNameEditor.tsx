import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import './SpeakerNameEditor.css';

export interface SpeakerNameChange { sourceId: string; sessionId: string; speaker: string; name: string }

export function SpeakerNameEditor({sourceId,sessionId,speaker,speakerName,onSave,disabled=false}:{
  sourceId:string;sessionId:string;speaker:string;speakerName?:string;
  onSave:(change:SpeakerNameChange)=>Promise<void>;disabled?:boolean;
}) {
  const [editing,setEditing]=useState(false),[name,setName]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState('');
  const id=useId();
  const submit=async(event:FormEvent)=>{
    event.preventDefault();if(pending || disabled)return;
    setPending(true);setError('');
    try{await onSave({sourceId,sessionId,speaker,name:name.trim()});setEditing(false);}
    catch(failure){setError(failure instanceof Error?failure.message:'Nama belum tersimpan. Coba lagi.');}
    finally{setPending(false);}
  };
  if(!editing)return <button type="button" className="speaker-name-edit" disabled={disabled} aria-label={`Ubah nama ${speakerName || speaker}`} onClick={()=>{setName(speakerName || '');setError('');setEditing(true);}}>Ubah nama</button>;
  return <form className="speaker-name-form" onSubmit={event=>void submit(event)} onKeyDown={event=>{if(event.key==='Escape' && !pending){event.stopPropagation();setEditing(false);}}}>
    <label htmlFor={id}>Nama untuk {speaker}</label>
    <input id={id} value={name} onChange={event=>setName(event.target.value)} maxLength={80} disabled={pending || disabled} autoFocus placeholder="Contoh: Budi" aria-describedby={`${id}-hint`} />
    <small id={`${id}-hint`}>Nama manual untuk sesi mikrofon ini. Kosongkan untuk memakai label otomatis.</small>
    <div><button type="submit" disabled={pending || disabled}>{pending?'Menyimpan…':'Simpan nama'}</button><button type="button" disabled={pending} onClick={()=>setEditing(false)}>Batal</button></div>
    {error && <p role="alert">{error}</p>}
  </form>;
}
