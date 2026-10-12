import {useState} from 'react';

export function usePresentationView(sharing: boolean, basePanel: boolean) {
  const [stored,setStored]=useState({sharing,focused:sharing,thumbnails:!sharing,panelOverride:null as boolean|null});
  const state=stored.sharing===sharing?stored:{sharing,focused:sharing,thumbnails:!sharing,panelOverride:null};
  if(state!==stored)setStored(state);
  return {
    focused:sharing&&state.focused,
    showThumbnails:!sharing||state.thumbnails,
    panelVisible:sharing?(state.panelOverride??(!state.focused&&basePanel)):basePanel,
    toggleFocus:()=>setStored(old=>({...old,focused:!old.focused,thumbnails:old.focused,panelOverride:null})),
    toggleThumbnails:()=>setStored(old=>({...old,thumbnails:!old.thumbnails})),
    setPanelVisible:(value:boolean)=>setStored(old=>({...old,panelOverride:value})),
  };
}
