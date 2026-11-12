import { useEffect, useId, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import { apiRequest } from './api';

export interface AdminEmployee {
  employeeId: string;
  name: string;
  department: string;
  status: string | null;
  activated: boolean;
  isSuperAdmin: boolean;
}

type AccountAction = 'activate' | 'deactivate' | 'grant' | 'revoke' | 'invite';
type UpdateAction = Exclude<AccountAction, 'invite'>;
interface ActivationInvite { email: string; activationCode: string; expiresIn: string }

const labels: Record<AccountAction, string> = {
  activate: 'Aktifkan akun',
  deactivate: 'Nonaktifkan akun',
  grant: 'Beri akses Super Admin',
  revoke: 'Cabut akses Super Admin',
  invite: 'Buat undangan aktivasi',
};
const confirmations: Partial<Record<AccountAction, string>> = {
  deactivate: 'Sesi login akun ini akan dicabut.',
  revoke: 'Akun ini akan kehilangan akses ke panel Admin.',
};
const successMessages: Record<UpdateAction, string> = {
  activate: 'Akun diaktifkan.',
  deactivate: 'Akun dinonaktifkan dan sesi login dicabut.',
  grant: 'Akses Super Admin diberikan.',
  revoke: 'Akses Super Admin dicabut.',
};

export function AdminEmployeeActions({ employee, onClose, onUpdated }: {
  employee: AdminEmployee;
  onClose: () => void;
  onUpdated: (message: string, losesAdminAccess: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const pendingRequest = useRef(false);
  const titleId = useId();
  const [confirmation, setConfirmation] = useState<AccountAction | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<ActivationInvite | null>(null);
  const [copyStatus, setCopyStatus] = useState('');

  useEffect(() => {
    const node = dialog.current;
    const previousFocus = document.activeElement;
    node?.showModal();
    return () => {
      node?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  useEffect(() => { if (confirmation) cancelButton.current?.focus(); }, [confirmation]);

  const active = employee.status === 'active';
  const actions: AccountAction[] = [active ? 'deactivate' : 'activate'];
  if (employee.isSuperAdmin) actions.push('revoke');
  else if (active && employee.activated) actions.push('grant');
  if (active && !employee.activated) actions.push('invite');

  const perform = async (action: AccountAction) => {
    if (pendingRequest.current) return;
    pendingRequest.current = true;
    setPending(true);
    setError(null);
    const accountPath = `/admin/accounts/${encodeURIComponent(employee.employeeId)}`;
    try {
      if (action === 'invite') {
        const response = await apiRequest<{ invite: ActivationInvite }>(`${accountPath}/invite`, { method: 'POST' });
        setInvite(response.invite);
        return;
      }
      const changesStatus = action === 'activate' || action === 'deactivate';
      const response = await apiRequest<{ changed: boolean }>(
        `${accountPath}/${changesStatus ? 'status' : 'super-admin'}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(changesStatus
            ? { status: action === 'activate' ? 'active' : 'inactive' }
            : { granted: action === 'grant' }),
        });
      onUpdated(response.changed ? successMessages[action] : 'Data akun sudah sesuai.',
        response.changed && (action === 'deactivate' || action === 'revoke'));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Aksi gagal. Coba lagi.');
    } finally {
      pendingRequest.current = false;
      setPending(false);
    }
  };

  const choose = (action: AccountAction) => {
    setError(null);
    if (confirmations[action]) setConfirmation(action);
    else void perform(action);
  };

  const copyInvite = async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(
        `Buka BaliCall di ${window.location.origin}/ dan pilih Aktivasi akun.\nEmail: ${invite.email}\nKode aktivasi: ${invite.activationCode}\nBerlaku ${invite.expiresIn} dan dapat dipakai sekali.`);
      setCopyStatus('Undangan disalin.');
    } catch {
      setCopyStatus('Salin email dan kode secara manual.');
    }
  };

  return (
    <dialog ref={dialog} className="admin-action-dialog" aria-labelledby={titleId} aria-busy={pending}
      onCancel={event => { event.preventDefault(); if (!pendingRequest.current) onClose(); }}>
      <header className="admin-section-heading">
        <div><h2 id={titleId}>Kelola akun</h2><p>{employee.name} · {employee.employeeId}</p></div>
        <button type="button" className="button-secondary" disabled={pending} onClick={onClose}>Tutup</button>
      </header>
      {error && <p className="admin-error" role="alert">{error}</p>}
      {pending && <p role="status">Memproses tindakan…</p>}
      {invite ? <section className="admin-invite-details" aria-label="Undangan aktivasi">
        <p>Kirim undangan ini ke karyawan melalui kanal internal. Kode berlaku {invite.expiresIn} dan dapat dipakai sekali.</p>
        <label className="admin-field">Email login<input readOnly value={invite.email} /></label>
        <label className="admin-field">Kode aktivasi<input readOnly value={invite.activationCode} /></label>
        <button type="button" className="button-secondary" onClick={() => void copyInvite()}>
          <Copy size={15} aria-hidden="true" /> Salin undangan
        </button>
        {copyStatus && <p role="status">{copyStatus}</p>}
      </section> : confirmation ? <section aria-label="Konfirmasi tindakan">
        <p>{confirmations[confirmation]}</p>
        <div className="admin-action-buttons">
          <button ref={cancelButton} type="button" className="button-secondary" disabled={pending}
            onClick={() => { setConfirmation(null); setError(null); }}>Batal</button>
          <button type="button" className="button-secondary button-danger" disabled={pending}
            onClick={() => void perform(confirmation)}>{labels[confirmation]}</button>
        </div>
      </section> : <div className="admin-action-buttons">
        {actions.map(action => <button key={action} type="button" className="button-secondary"
          disabled={pending} onClick={() => choose(action)}>{labels[action]}</button>)}
      </div>}
    </dialog>
  );
}
