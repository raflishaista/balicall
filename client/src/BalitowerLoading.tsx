import { useEffect, useState } from 'react';
import './BalitowerLoading.css';

export function BalitowerLoading({ variant, reduceMotion = false }: {
  variant: 'workspace' | 'meeting';
  reduceMotion?: boolean;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => setVisible(true), 200);
    return () => window.clearTimeout(timeout);
  }, []);

  const Container = variant === 'workspace' ? 'main' : 'div';
  const label = variant === 'workspace' ? 'Memuat ruang kerja…' : 'Menyiapkan ruang rapat…';

  return (
    <Container className={`balitower-loading balitower-loading--${variant}`}>
      <div className="balitower-loading__status" role="status">
        {visible && (
          <div className="balitower-loading__content">
            <svg className="balitower-loading__mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false"
              data-static={reduceMotion ? 'true' : undefined}>
              <rect width="32" height="32" rx="6" fill="#fff" />
              <g fill="none" stroke="#25428f" strokeWidth="1.35" strokeLinecap="round">
                <path d="M13.5 11.3a2.8 2.8 0 0 1 5 0" />
                <path d="M11.4 9.8a5.2 5.2 0 0 1 9.2 0" />
                <path d="M9 8.4a8 8 0 0 1 14 0" />
              </g>
              <path d="M14 14.6l3.8-2.1v4.9h2.8v3.1h-2.8v6c0 .7.3 1 .9 1 .6 0 1.1-.1 1.7-.4l.4 2.3c-1 .4-2 .6-3 .6-2.6 0-3.8-1.2-3.8-3.7v-5.8h-2v-3.1h2z"
                fill="#f79440" transform="translate(0 -1)" />
            </svg>
            <span>{label}</span>
          </div>
        )}
      </div>
    </Container>
  );
}
