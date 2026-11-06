import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Check, Copy, Info, Users, X } from 'lucide-react';
import './MeetingInfo.css';

export function MeetingInfo({ roomName, roomCode, hostName, role, inviteLink, onOpenHostTools }: {
  roomName: string;
  roomCode?: string;
  hostName?: string;
  role: 'host' | 'co-host' | 'participant';
  inviteLink?: string;
  onOpenHostTools?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [copied, setCopied] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const linkField = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const title = roomName.trim() || 'Ruang rapat';

  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismissOutside);
    return () => document.removeEventListener('pointerdown', dismissOutside);
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function handleEscape(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape' || !open) return;
    event.stopPropagation();
    close();
  }

  async function copyLink() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setFeedback('Tautan disalin.');
    } catch {
      linkField.current?.focus();
      linkField.current?.select();
      setCopied(false);
      setFeedback('Tautan dipilih. Salin secara manual.');
    }
  }

  return (
    <div className="meeting-info" ref={root} onKeyDown={handleEscape}>
      <button ref={trigger} className="meeting-info-trigger" type="button" aria-label="Info rapat"
        aria-expanded={open} aria-controls={open ? panelId : undefined} title="Info rapat"
        onClick={() => { setFeedback(''); setCopied(false); setOpen(!open); }}>
        <Info size={19} aria-hidden="true" />
        <span className="meeting-info-trigger-title">{title}</span>
      </button>
      {open && (
        <section className="meeting-info-panel" id={panelId} aria-labelledby={`${panelId}-title`}>
          <div className="meeting-info-heading">
            <div><p>Info rapat</p><h2 id={`${panelId}-title`}>{title}</h2></div>
            <button type="button" className="meeting-info-icon" aria-label="Tutup info rapat" onClick={close}>
              <X size={19} aria-hidden="true" />
            </button>
          </div>
          <dl className="meeting-info-details">
            {inviteLink && <div><dt><label htmlFor={`${panelId}-link`}>Tautan rapat</label></dt><dd>
              <div className="meeting-info-link">
                <input ref={linkField} id={`${panelId}-link`} value={inviteLink} title={inviteLink} readOnly
                  onFocus={event => event.currentTarget.select()} />
                <button type="button" className="meeting-info-icon" aria-label="Salin tautan rapat" title="Salin tautan rapat"
                  onClick={() => void copyLink()}>
                  {copied ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}
                </button>
              </div>
              <span className="meeting-info-copy-status" role="status">{feedback}</span>
            </dd></div>}
            <div><dt>Kode ruang</dt><dd className="meeting-info-code">{roomCode || 'Belum tersedia'}</dd></div>
            <div><dt>Host</dt><dd>{hostName || 'Belum tersedia'}</dd></div>
            <div><dt>Peran Anda</dt><dd>{role === 'co-host' ? 'Co-host' : role === 'host' ? 'Host' : 'Peserta'}</dd></div>
          </dl>
          {onOpenHostTools && <div className="meeting-info-actions">
            <button type="button" data-meeting-host-tools onClick={() => { close(); onOpenHostTools(); }}>
              <Users size={17} aria-hidden="true" /> Kelola peserta
            </button>
          </div>}
        </section>
      )}
    </div>
  );
}
