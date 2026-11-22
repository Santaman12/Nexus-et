import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { getStoredAuth } from '../lib/auth';
import { defaultSettings, loadSettings, saveSettings, type AppSettings } from '../lib/settings';

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`nx-copy-btn${copied ? ' copied' : ''}`}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        });
      }}
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

function SupportRow({ icon, label, value, href }: { icon: string; label: string; value: string; href: string }) {
  return (
    <div className="nx-support-row">
      <span className="nx-support-icon" aria-hidden="true">{icon}</span>
      <div className="nx-support-info">
        <span className="muted">{label}</span>
        <a className="nx-support-link" href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
          {value}
        </a>
      </div>
      <CopyButton value={value} />
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      className={`nx-toggle${checked ? ' on' : ''}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <span className="nx-toggle-knob" />
    </button>
  );
}

function SettingRow({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="setting-row">
      <div>
        <strong>{title}</strong>
        {hint && <div className="muted">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const auth = getStoredAuth();
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [lockState, setLockState] = useState<'idle' | 'working' | 'done' | 'error'>('idle');

  const refreshPermissions = () => {
    api.listPermissions().then((res) => setPermissions(res.permissions)).catch(() => setPermissions([]));
  };

  useEffect(() => {
    refreshPermissions();
    api.getSettings()
      .then((res) => {
        if (res.settings) {
          const merged = { ...defaultSettings, ...(res.settings as Partial<AppSettings>) };
          saveSettings(merged);
          setSettings(merged);
        }
      })
      .catch(() => undefined);
  }, []);

  function update(patch: Partial<AppSettings>) {
    setSettings((current) => {
      const next = { ...current, ...patch };
      saveSettings(next);
      void api.putSettings(next).catch(() => undefined);
      return next;
    });
  }

  async function handleMediaToggle(enabled: boolean) {
    update({ mediaControl: enabled });
    try {
      const res = await api.setPermission('media_control', enabled ? 'grant' : 'revoke');
      setPermissions(res.permissions);
    } catch {
      // Permission sync is best-effort; the toggle preference is still saved.
    }
  }

  async function handleResetPermission(tool: string) {
    try {
      const res = await api.setPermission(tool, 'reset');
      setPermissions(res.permissions);
      if (tool === 'media_control') update({ mediaControl: false });
    } catch {
      // ignore
    }
  }

  async function handleLock() {
    setLockState('working');
    try {
      await api.lockWorkstation();
      setLockState('done');
    } catch {
      setLockState('error');
    }
  }

  async function handleLogout() {
    await api.logout().catch(() => undefined);
    navigate('/login');
  }

  const mediaGranted = permissions.includes('media_control');

  return (
    <main className="settings-page">
      <header className="dashboard-header">
        <div>
          <div className="brand-small">NEXUS</div>
          <div className="muted">Settings</div>
        </div>
        <Link className="ghost-button" to="/dashboard">Back</Link>
      </header>

      <section className="settings-card nx-card">
        <h2>Customer profile</h2>
        <div className="nx-profile">
          <div className="nx-avatar" aria-hidden="true">{(auth?.user.name ?? 'N').slice(0, 1).toUpperCase()}</div>
          <div className="nx-profile-info">
            <strong>{auth?.user.name ?? 'NEXUS user'}</strong>
            <span className="muted">{auth?.user.email ?? ''}</span>
            <span className="nx-role">Member</span>
          </div>
          <button className="nx-lock-btn" onClick={() => void handleLogout()}>Sign out</button>
        </div>
      </section>

      <section className="settings-card nx-card">
        <h2>Device control</h2>

        <SettingRow title="Hands-free voice" hint="NEXUS keeps listening and answering without pressing Space.">
          <Toggle checked={settings.handsFree} onChange={(v) => update({ handsFree: v })} label="Hands-free voice" />
        </SettingRow>

        <SettingRow title="Wake voice (“Hey NEXUS”)" hint="Continuous wake listening — push-to-talk with Space works today.">
          <Toggle checked={settings.wakeWord} onChange={(v) => update({ wakeWord: v })} label="Wake word" />
        </SettingRow>

        <SettingRow
          title="Media & volume keys"
          hint={mediaGranted ? 'Allowed — media keys run without asking.' : 'Toggle on to allow media/volume control once, permanently.'}
        >
          <Toggle checked={settings.mediaControl && mediaGranted} onChange={(v) => void handleMediaToggle(v)} label="Media control" />
        </SettingRow>

        <SettingRow title="Screen context reading" hint="Let NEXUS read what is on your screen — arrives with the desktop build.">
          <Toggle checked={settings.screenContext} onChange={(v) => update({ screenContext: v })} label="Screen context" />
        </SettingRow>

        <SettingRow
          title="Lock this PC"
          hint={lockState === 'done' ? 'Locked.' : lockState === 'error' ? 'Lock failed — try again.' : 'Locks the workstation immediately (like Win+L).'}
        >
          <button className="nx-lock-btn" onClick={() => void handleLock()} disabled={lockState === 'working'}>
            {lockState === 'working' ? 'Locking…' : 'Lock now'}
          </button>
        </SettingRow>
      </section>

      <section className="settings-card nx-card">
        <h2>Voice &amp; speech</h2>
        <SettingRow title="Voice" hint="Male · NEXUS voice">
          <span className="muted">Male</span>
        </SettingRow>
        <SettingRow title={`Speaking speed: ${settings.voiceRate.toFixed(2)}×`}>
          <input
            type="range"
            min="0.5"
            max="1.5"
            step="0.05"
            value={settings.voiceRate}
            onChange={(e) => update({ voiceRate: Number(e.target.value) })}
            aria-label="Speaking speed"
          />
        </SettingRow>
        <SettingRow title={`Volume: ${Math.round(settings.voiceVolume * 100)}%`}>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings.voiceVolume}
            onChange={(e) => update({ voiceVolume: Number(e.target.value) })}
            aria-label="Volume"
          />
        </SettingRow>
      </section>

      <section className="settings-card nx-card">
        <h2>Privacy &amp; permissions</h2>
        <SettingRow
          title="Remembered permissions"
          hint={permissions.length === 0 ? 'None yet — NEXUS asks once per action, then remembers.' : `${permissions.length} granted permanently.`}
        >
          <div className="nx-perm-chips">
            {permissions.map((name) => (
              <button key={name} className="nx-perm-chip" onClick={() => void handleResetPermission(name)} title="Reset this permission">
                {name} <span className="nx-perm-reset">×</span>
              </button>
            ))}
          </div>
        </SettingRow>
        <SettingRow title="Microphone" hint="Audio is captured only while you speak — Space push-to-talk or hands-free." />
        <SettingRow title="Uploads" hint="Pictures and files are processed only when you send them." />
      </section>

      <section className="settings-card nx-card">
        <h2>Support &amp; help</h2>
        <p className="muted nx-support-sub">Reach the NEXUS team any time — we usually reply within one business day.</p>
        <SupportRow icon="✉" label="Email" value="SintayehuGedfew@gmail.com" href="mailto:SintayehuGedfew@gmail.com" />
        <SupportRow icon="✈" label="Telegram" value="@Nexus_offical_support" href="https://t.me/Nexus_offical_support" />
        <SupportRow icon="📞" label="Phone" value="+251-9-89-38-74-74" href="tel:+251989387474" />
        <SupportRow icon="📞" label="Phone" value="+251-7-10-02-00-95" href="tel:+251710020095" />
      </section>

      <section className="settings-card nx-card">
        <h2>About NEXUS</h2>
        <SettingRow title="NEXUS" hint="Voice-first personal assistant · v0.1.0" />
        <SettingRow title="Creator" hint="Mister Sintayehu Gedfew" />
      </section>
    </main>
  );
}
