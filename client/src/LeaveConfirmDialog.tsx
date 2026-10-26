import { useEffect, useRef } from 'react';
import { AlertCircle, Loader2, PhoneOff, Sparkles, X } from 'lucide-react';

export interface LeaveConfirmDialogProps {
  isOpen: boolean;
  isLastUser: boolean;
  isGuest?: boolean;
  intent: 'leave' | 'summary';
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function LeaveConfirmDialog({
  isOpen,
  isLastUser,
  isGuest = false,
  intent,
  busy,
  onConfirm,
  onCancel,
}: LeaveConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        onCancel();
      }
      if (event.key === 'Tab' && dialogRef.current) {
        const buttons = dialogRef.current.querySelectorAll<HTMLButtonElement>('button:not([disabled])');
        if (!buttons.length) return;
        if (event.shiftKey && document.activeElement === buttons[0]) {
          event.preventDefault();
          buttons[buttons.length - 1].focus();
        } else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) {
          event.preventDefault();
          buttons[0].focus();
        }
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (previous && previous.isConnected) {
        previous.focus();
      }
    };
  }, [isOpen, busy, onCancel]);

  if (!isOpen) return null;

  const isEndingMeeting = intent === 'summary' || (isLastUser && !isGuest);

  let title = 'Keluar dari Rapat?';
  let description = 'Apakah Anda yakin ingin keluar dari rapat ini? Peserta lain masih berada di dalam ruangan. Anda dapat bergabung kembali selama rapat berlangsung.';
  let confirmLabel = 'Keluar Rapat';
  let iconKind: 'danger' | 'warning' | 'summary' = 'danger';

  if (intent === 'summary') {
    title = 'Akhiri Rapat & Buat Notulen?';
    description = 'Rapat akan diakhiri untuk semua peserta dan AI akan langsung menyusun notulen rapat secara otomatis.';
    confirmLabel = 'Selesai & Notulen';
    iconKind = 'summary';
  } else if (isLastUser) {
    if (isGuest) {
      title = 'Keluar & Akhiri Rapat?';
      description = 'Anda adalah peserta terakhir di ruang rapat ini. Keluar akan mengakhiri rapat.';
      confirmLabel = 'Keluar Rapat';
      iconKind = 'warning';
    } else {
      title = 'Keluar & Akhiri Rapat?';
      description = 'Anda adalah peserta terakhir di ruang rapat ini. Jika Anda keluar, rapat akan diakhiri dan Anda akan diarahkan ke halaman pembuatan notulen.';
      confirmLabel = 'Keluar & Buat Notulen';
      iconKind = 'warning';
    }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={event => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="leave-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-dialog-title"
        aria-describedby="leave-dialog-desc"
      >
        <button
          type="button"
          className="icon-button dialog-close"
          aria-label="Tutup konfirmasi"
          onClick={onCancel}
          disabled={busy}
        >
          <X size={18} />
        </button>

        <div className="leave-dialog-header">
          <div className={`leave-dialog-icon ${iconKind}`}>
            {iconKind === 'summary' ? (
              <Sparkles size={22} />
            ) : iconKind === 'warning' ? (
              <AlertCircle size={22} />
            ) : (
              <PhoneOff size={22} />
            )}
          </div>
          <div className="leave-dialog-content">
            <h2 id="leave-dialog-title">{title}</h2>
            <p id="leave-dialog-desc">{description}</p>
          </div>
        </div>

        <div className="leave-dialog-actions">
          <button
            ref={cancelRef}
            type="button"
            className="button-secondary"
            onClick={onCancel}
            disabled={busy}
          >
            Batal
          </button>
          <button
            type="button"
            className={`button-primary ${!isEndingMeeting ? 'button-danger' : ''}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? (
              <>
                <Loader2 className="ui-spinner" size={16} aria-hidden="true" />
                <span>Memproses…</span>
              </>
            ) : isEndingMeeting ? (
              <>
                <Sparkles size={16} aria-hidden="true" />
                <span>{confirmLabel}</span>
              </>
            ) : (
              <>
                <PhoneOff size={16} aria-hidden="true" />
                <span>{confirmLabel}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
