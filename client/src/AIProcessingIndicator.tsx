import { DotPulse } from 'ldrs/react';
import 'ldrs/react/DotPulse.css';
import './AIProcessingIndicator.css';

export function AIProcessingIndicator() {
  return (
    <div className="ai-processing-pill" role="status" aria-live="polite">
      <span className="ai-dot-pulse" aria-hidden="true">
        <DotPulse size={28} speed={1.8} color="currentColor" />
      </span>
      <span>MEMPROSES NOTULEN AI</span>
    </div>
  );
}
