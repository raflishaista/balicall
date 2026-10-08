import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { AuthGate } from './AuthGate.tsx'

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class RootErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('RootErrorBoundary caught unhandled error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '32px', maxWidth: '640px', margin: '40px auto', fontFamily: 'sans-serif', background: '#fff', borderRadius: '12px', border: '1px solid #fecaca', boxShadow: '0 4px 12px rgba(0,0,0,0.06)' }}>
          <h2 style={{ color: '#dc2626', marginTop: 0 }}>Terjadi Kendala Memuat Halaman</h2>
          <p style={{ color: '#475569', fontSize: '14px' }}>
            Aplikasi menemui kendala saat memuat di browser ini. Periksa konsol browser atau perbarui browser Anda.
          </p>
          <pre style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', overflow: 'auto', fontSize: '12px', color: '#b91c1c' }}>
            {this.state.error?.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: '16px', padding: '10px 18px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
          >
            Muat Ulang
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <AuthGate />
    </RootErrorBoundary>
  </StrictMode>,
)
