import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export function MeetingPanel({ open, compact, onClose, children }: {
  open: boolean; compact: boolean; onClose: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (!compact || !open || !node) return;
    const previous = document.activeElement;
    node.showModal();
    return () => { node.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [open, compact]);
  const content = <><button className="meeting-panel-close" type="button" aria-label="Tutup panel rapat" onClick={onClose}><X size={18} /></button>{children}</>;
  return compact ? <dialog ref={dialog} className="call-side-panel meeting-panel-drawer" aria-label="Transkrip dan peserta"
    onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>{content}</dialog> : <aside className="call-side-panel" aria-label="Transkrip dan peserta" hidden={!open}>{content}</aside>;
}
