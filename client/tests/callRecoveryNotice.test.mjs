import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('App.tsx contains the call recovery white square card structure and text', () => {
  const appSrc = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

  // Verify the wrapper and card container
  assert.ok(appSrc.includes('call-recovery-wrapper'), 'App.tsx must include call-recovery-wrapper');
  assert.ok(appSrc.includes('call-recovery-card'), 'App.tsx must include call-recovery-card');

  // Verify the clear headline requested by the user
  assert.ok(
    appSrc.includes('<h2>Sesi Rapat Telah Berakhir atau Kedaluwarsa</h2>'),
    'App.tsx must include large clear heading for expired session'
  );

  // Verify explanation text and icon badge
  assert.ok(appSrc.includes('call-recovery-icon-badge'), 'App.tsx must include icon badge');
  assert.ok(appSrc.includes('CalendarX'), 'App.tsx must render CalendarX alert icon');
  assert.ok(
    appSrc.includes('Ruang rapat ini sudah selesai atau token sesi telah kedaluwarsa.'),
    'App.tsx must provide clear explanation copy'
  );

  // Verify action buttons
  assert.ok(appSrc.includes('call-recovery-actions'), 'App.tsx must include call-recovery-actions');
  assert.ok(appSrc.includes('Kembali ke Lobi'), 'App.tsx must provide lobby return option');
  assert.ok(appSrc.includes('Kembali ke Beranda'), 'App.tsx must provide home return option');
  assert.ok(appSrc.includes('Gabung Rapat Lain'), 'App.tsx must provide join another meeting option');
});

test('App.css contains proper styles for the white square card and high contrast text', () => {
  const css = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8');

  assert.ok(css.includes('.call-recovery-wrapper'), 'App.css must style .call-recovery-wrapper');
  assert.ok(css.includes('.call-recovery-card'), 'App.css must style .call-recovery-card');
  assert.ok(css.includes('background: #ffffff;'), 'Card must have white square background');
  assert.ok(css.includes('color: #0f172a;'), 'Card title must have high contrast dark slate color');
  assert.ok(css.includes('font-size: 26px;'), 'Card title must have large font size');
});

test('SummaryView empty dialogue state is neutral with gray colors, circular icons, and removed warning', () => {
  const appSrc = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8');

  // Warning text "Silakan berbicara terlebih dahulu saat rapat." is removed
  assert.ok(
    !appSrc.includes('Silakan berbicara terlebih dahulu saat rapat.'),
    'Warning prompt "Silakan berbicara terlebih dahulu saat rapat." must be removed'
  );
  assert.ok(
    appSrc.includes("Belum ada rekaman percakapan untuk dibuat notulen.'"),
    'Empty speech message should be neutral and concise'
  );

  // Neutral classes & circular icons
  assert.ok(appSrc.includes('ai-neutral-pill'), 'App.tsx must use ai-neutral-pill for no dialogue');
  assert.ok(appSrc.includes('summary-neutral-notice'), 'App.tsx must use summary-neutral-notice');
  assert.ok(appSrc.includes('Informasi Notulen Rapat:'), 'App.tsx must use neutral heading instead of AI error');
  assert.ok(appSrc.includes('Info size={22}'), 'App.tsx must use circular Info icon for neutral notice');

  // Gray CSS definitions
  assert.ok(css.includes('.ai-neutral-pill'), 'App.css must define .ai-neutral-pill');
  assert.ok(css.includes('.summary-neutral-notice'), 'App.css must define .summary-neutral-notice');
  assert.ok(css.includes('background: #f8fafc;'), 'Neutral notice must use neutral light gray background');
});


test('In-call menus from Rekaman to Lainnya are centered and Transkrip is switched to Chat/Transkrip with chat design', () => {
  const controlsSrc = readFileSync(new URL('../src/MeetingControls.tsx', import.meta.url), 'utf8');
  const roomSrc = readFileSync(new URL('../src/MeetingRoom.tsx', import.meta.url), 'utf8');
  const layoutCss = readFileSync(new URL('../src/MeetingLayout.css', import.meta.url), 'utf8');
  const appCss = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8');

  // 1. Control bar splits left media controls and centered Rekaman-to-Lainnya controls
  assert.ok(controlsSrc.includes('call-controls-left'), 'MeetingControls must have call-controls-left for mic/camera');
  assert.ok(controlsSrc.includes('call-controls-center'), 'MeetingControls must have call-controls-center for Rekaman to Lainnya');
  const centerIdx = controlsSrc.indexOf('call-controls-center');
  const leaveIdx = controlsSrc.indexOf('leave-controls');
  const rekamanIdx = controlsSrc.indexOf("'Rekaman'");
  const lainnyaIdx = controlsSrc.indexOf('Lainnya');
  assert.ok(rekamanIdx > centerIdx && rekamanIdx < leaveIdx, 'Rekaman must be inside call-controls-center');
  assert.ok(lainnyaIdx > centerIdx && lainnyaIdx < leaveIdx, 'Lainnya must be inside call-controls-center');

  // 2. Chat/Transkrip button and icon
  assert.ok(controlsSrc.includes('aria-label="Chat/Transkrip"'), 'Control button aria-label must be Chat/Transkrip');
  assert.ok(controlsSrc.includes('<span>Chat/Transkrip</span>'), 'Control button label must be Chat/Transkrip');
  assert.ok(controlsSrc.includes('MessageSquareText'), 'Control button must use MessageSquareText icon');

  // 3. Panel tab and chat bubble design in MeetingRoom.tsx
  assert.ok(roomSrc.includes('Chat/Transkrip'), 'MeetingRoom panel tab must say Chat/Transkrip');
  assert.ok(roomSrc.includes('chat-message-bubble'), 'MeetingRoom must render chat-message-bubble for entries');
  assert.ok(roomSrc.includes('meeting-chat-input-wrap'), 'MeetingRoom must render enhanced chat input bar');
  assert.ok(layoutCss.includes('.call-controls-center'), 'MeetingLayout.css must center .call-controls-center');
  assert.ok(appCss.includes('.chat-message-bubble'), 'App.css must style .chat-message-bubble');
});
