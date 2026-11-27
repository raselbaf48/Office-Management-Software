import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const INSTALLED_STORAGE_KEY = 'baf_pwa_installed_on_device_v1';

// Module-level reference so components mounting later still receive the captured prompt event
let globalDeferredPrompt: BeforeInstallPromptEvent | null = null;
const promptSubscribers = new Set<(event: BeforeInstallPromptEvent | null) => void>();
const installedSubscribers = new Set<(installed: boolean) => void>();

function notifyPromptSubscribers(ev: BeforeInstallPromptEvent | null) {
  promptSubscribers.forEach((cb) => {
    try {
      cb(ev);
    } catch {}
  });
}

function notifyInstalledSubscribers(installed: boolean) {
  installedSubscribers.forEach((cb) => {
    try {
      cb(installed);
    } catch {}
  });
}

function checkIsStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (Capacitor.isNativePlatform()) return true;
  } catch {}
  try {
    if (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.matchMedia('(display-mode: minimal-ui)').matches ||
      window.matchMedia('(display-mode: window-controls-overlay)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
      document.referrer.startsWith('android-app://')
    ) {
      return true;
    }
  } catch {}
  return false;
}

function getPersistedInstalledFlag(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(INSTALLED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function setPersistedInstalledFlag(installed: boolean) {
  if (typeof window === 'undefined') return;
  try {
    if (installed) {
      window.localStorage.setItem(INSTALLED_STORAGE_KEY, '1');
    } else {
      window.localStorage.removeItem(INSTALLED_STORAGE_KEY);
    }
  } catch {}
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    globalDeferredPrompt = e as BeforeInstallPromptEvent;
    // Browser only fires beforeinstallprompt when the PWA is NOT currently installed
    setPersistedInstalledFlag(false);
    notifyInstalledSubscribers(false);
    notifyPromptSubscribers(globalDeferredPrompt);
  });

  window.addEventListener('appinstalled', () => {
    globalDeferredPrompt = null;
    setPersistedInstalledFlag(true);
    notifyPromptSubscribers(null);
    notifyInstalledSubscribers(true);
  });
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
    () => globalDeferredPrompt
  );
  const [isInstalled, setIsInstalled] = useState<boolean>(() => {
    if (checkIsStandaloneDisplay()) return true;
    if (globalDeferredPrompt) return false;
    return getPersistedInstalledFlag();
  });
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    let active = true;

    const syncInstalledState = async () => {
      if (checkIsStandaloneDisplay()) {
        if (active) setIsInstalled(true);
        return;
      }

      if (globalDeferredPrompt) {
        setPersistedInstalledFlag(false);
        if (active) setIsInstalled(false);
        return;
      }

      const nav = window.navigator as Navigator & {
        getInstalledRelatedApps?: () => Promise<Array<{ platform?: string; url?: string; id?: string }>>;
      };

      if (typeof nav.getInstalledRelatedApps === 'function') {
        try {
          const relatedApps = await nav.getInstalledRelatedApps();
          if (!active) return;
          if (Array.isArray(relatedApps) && relatedApps.length > 0) {
            setPersistedInstalledFlag(true);
            setIsInstalled(true);
            return;
          } else {
            // Browser confirmed no related app is currently installed on this device
            setPersistedInstalledFlag(false);
            setIsInstalled(false);
            return;
          }
        } catch {}
      }

      if (active) {
        setIsInstalled(getPersistedInstalledFlag());
      }
    };

    void syncInstalledState();

    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice =
      /iphone|ipad|ipod/.test(userAgent) ||
      (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
    setIsIOS(isIOSDevice);

    const handlePromptUpdate = (ev: BeforeInstallPromptEvent | null) => {
      if (!active) return;
      setDeferredPrompt(ev);
      if (ev) {
        setIsInstalled(false);
      }
    };

    const handleInstalledUpdate = (installed: boolean) => {
      if (!active) return;
      setIsInstalled(installed);
      if (installed) {
        setDeferredPrompt(null);
      }
    };

    const standaloneMedia = window.matchMedia?.('(display-mode: standalone)');
    const handleDisplayModeChange = () => {
      void syncInstalledState();
    };

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        void syncInstalledState();
      }
    };

    promptSubscribers.add(handlePromptUpdate);
    installedSubscribers.add(handleInstalledUpdate);
    standaloneMedia?.addEventListener?.('change', handleDisplayModeChange);
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      active = false;
      promptSubscribers.delete(handlePromptUpdate);
      installedSubscribers.delete(handleInstalledUpdate);
      standaloneMedia?.removeEventListener?.('change', handleDisplayModeChange);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, []);

  const install = async (): Promise<boolean> => {
    const promptEvent = deferredPrompt || globalDeferredPrompt;
    if (!promptEvent) return false;
    try {
      await promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;
      if (outcome === 'accepted') {
        globalDeferredPrompt = null;
        setPersistedInstalledFlag(true);
        setIsInstalled(true);
        setDeferredPrompt(null);
        notifyPromptSubscribers(null);
        notifyInstalledSubscribers(true);
        return true;
      }
    } catch {}
    return false;
  };

  return {
    isInstallable: !isInstalled && Boolean(deferredPrompt || globalDeferredPrompt),
    isInstalled,
    isIOS: !isInstalled && isIOS,
    install,
  };
}
