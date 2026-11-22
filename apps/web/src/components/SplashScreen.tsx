import { useEffect, useState } from 'react';

export default function SplashScreen({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const exit = window.setTimeout(() => setLeaving(true), 2100);
    const done = window.setTimeout(onDone, 2650);
    return () => {
      window.clearTimeout(exit);
      window.clearTimeout(done);
    };
  }, [onDone]);

  return (
    <div className={`splash${leaving ? ' splash-leave' : ''}`} aria-hidden="true">
      <div className="splash-ring" />
      <img className="splash-logo" src="/brand/nexus-logo.png" alt="NEXUS" />
      <div className="splash-word">NEXUS</div>
      <div className="splash-tag">VOICE-FIRST AI OPERATING SYSTEM</div>
    </div>
  );
}
