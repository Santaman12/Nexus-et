import type { InputHTMLAttributes, ReactNode } from 'react';

export function AuthIcon({ kind }: { kind: 'user' | 'mail' | 'lock' }) {
  const paths = {
    user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6',
    lock: 'M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2zM7 11V7a5 5 0 0 1 10 0v4',
  } as const;
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[kind]} />
    </svg>
  );
}

export function AuthField({
  icon,
  label,
  ...inputProps
}: {
  icon: 'user' | 'mail' | 'lock';
  label: string;
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="auth-field">
      <span className="auth-field-icon"><AuthIcon kind={icon} /></span>
      <span className="auth-field-label">{label}</span>
      <input {...inputProps} />
    </label>
  );
}

export function AuthSubmit({ loading, idle, busy }: { loading: boolean; idle: string; busy: string }) {
  return (
    <button className="primary-button auth-submit" disabled={loading} type="submit">
      <span className="auth-submit-icon"><AuthIcon kind="user" /></span>
      <span>{loading ? busy : idle}</span>
      <span className="auth-submit-arrow" aria-hidden="true">➜</span>
    </button>
  );
}

export default function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="auth-page">
      <div className="cosmos" aria-hidden="true">
        <span className="cosmos-stars" />
        <span className="nebula nebula-a" />
        <span className="nebula nebula-b" />
        <span className="nebula nebula-c" />
      </div>

      <div className="auth-stage">
        <img className="nexus-logo" src="/brand/nexus-logo.png" alt="NEXUS" />
        <h1 className="nexus-title">NEXUS</h1>

        <section className="auth-card glass-card">
          <p className="auth-subtitle">{title}</p>
          {children}
        </section>
      </div>

      <div className="pedestal" aria-hidden="true">
        <span className="pedestal-glow" />
        <span className="laser" />
        <span className="laser" />
        <span className="laser" />
        <span className="pedestal-base" />
      </div>
    </main>
  );
}
