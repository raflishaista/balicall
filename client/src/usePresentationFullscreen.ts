import {useEffect,useRef,useState} from 'react';
import type {RefObject} from 'react';

export function usePresentationFullscreen(target:RefObject<HTMLDivElement|null>,sharing:boolean){
  const [fullscreen,setFullscreen]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState<string|null>(null);
  const lock=useRef(false),alive=useRef(false);
  const sharingNow=useRef(sharing);
  useEffect(()=>{sharingNow.current=sharing;},[sharing]);
  const supported=typeof document!=='undefined'&&document.fullscreenEnabled&&typeof Element.prototype.requestFullscreen==='function';
  useEffect(()=>{
    alive.current=true;
    const changed=()=>setFullscreen(document.fullscreenElement===target.current);
    document.addEventListener('fullscreenchange',changed);
    return()=>{alive.current=false;document.removeEventListener('fullscreenchange',changed);};
  },[target]);
  useEffect(()=>{
    if(!sharing&&document.fullscreenElement===target.current)void document.exitFullscreen().catch(()=>{});
  },[sharing,target]);
  const toggle=async()=>{
    if(lock.current||!sharing||!target.current)return;
    lock.current=true;setPending(true);setError(null);
    try{
      if(document.fullscreenElement===target.current)await document.exitFullscreen();
      else if(supported){
        await target.current.requestFullscreen();
        if(!sharingNow.current&&document.fullscreenElement===target.current)await document.exitFullscreen();
      }
      else throw new Error('unsupported');
    }catch{if(alive.current)setError('Full Screen belum dapat dibuka. Gunakan Fokus Presentasi atau periksa izin fullscreen browser.');}
    finally{lock.current=false;if(alive.current)setPending(false);}
  };
  return {fullscreen,pending,error,supported,toggle,clearError:()=>setError(null)};
}
