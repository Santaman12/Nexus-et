import React, { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export const InstallAppButton: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsStandalone(standalone);

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsStandalone(true);
      setDeferredPrompt(null);
      setShowHelp(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  if (isStandalone) return null;

  const handleClick = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setDeferredPrompt(null);
      }
      return;
    }
    setShowHelp((prev) => !prev);
  };

  return (
    <div style={{ margin: '10px 0' }}>
      <button
        type="button"
        onClick={handleClick}
        style={{
          padding: '10px 16px',
          borderRadius: '8px',
          border: '1px solid #22c55e',
          backgroundColor: '#16a34a',
          color: '#ffffff',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Download App
      </button>

      {showHelp && (
        <p style={{ marginTop: '8px', fontSize: '0.88rem' }}>
          በ Browser menu (<strong>⋮</strong> ወይም Share) ውስጥ <strong>Install app</strong> ወይም{' '}
          <strong>Add to Home screen</strong> የሚለውን ተጭነው ይጫኑ።
        </p>
      )}
    </div>
  );
};

