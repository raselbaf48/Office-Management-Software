import React, { useState, useEffect } from 'react';
import { Download, Smartphone, X, CheckCircle2, Share } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { getActiveOfficeIdentity } from '../firebase';
import { isRunningInApk } from '../services/appUpdateService';

interface PWAInstallButtonProps {
  officeName?: string;
  officeLogo?: string;
  variant?: 'login' | 'sidebar' | 'header' | 'settings';
  collapsed?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  officeName: propOfficeName,
  officeLogo: propOfficeLogo,
  variant = 'sidebar',
  collapsed = false,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [activeIdentity, setActiveIdentity] = useState(() => getActiveOfficeIdentity());

  useEffect(() => {
    const syncIdentity = () => setActiveIdentity(getActiveOfficeIdentity());
    window.addEventListener('baf_office_config_changed', syncIdentity);
    window.addEventListener('baf_logo_updated', syncIdentity);
    window.addEventListener('baf_pwa_identity_updated', syncIdentity);
    return () => {
      window.removeEventListener('baf_office_config_changed', syncIdentity);
      window.removeEventListener('baf_logo_updated', syncIdentity);
      window.removeEventListener('baf_pwa_identity_updated', syncIdentity);
    };
  }, []);

  if (isInstalled || isRunningInApk()) {
    return null;
  }

  const isGenericName = (n: string) =>
    !n ||
    n === 'Office Management' ||
    n === 'Office Management Application' ||
    n === 'Office Management System';
  const isGenericLogo = (l: string) =>
    !l ||
    l.includes('office-management-logo') ||
    l.includes('pwa-pc-192x192') ||
    l.includes('pwa-pc-512x512');

  let savedMetaName = '';
  let savedMetaLogo = '';
  try {
    const rawMeta = localStorage.getItem('baf_pwa_active_office_meta');
    if (rawMeta) {
      const parsed = JSON.parse(rawMeta);
      if (parsed?.officeName && !isGenericName(String(parsed.officeName).trim())) {
        savedMetaName = String(parsed.officeName).trim();
      }
      if (parsed?.logoUrl && !isGenericLogo(String(parsed.logoUrl).trim())) {
        savedMetaLogo = String(parsed.logoUrl).trim();
      }
    }
  } catch {}

  const candidatePropName = String(propOfficeName || '').trim();
  const candidateActiveName = String(activeIdentity.officeName || '').trim();
  const displayName = !isGenericName(candidatePropName)
    ? candidatePropName
    : !isGenericName(candidateActiveName)
      ? candidateActiveName
      : savedMetaName || '155 UASU BAF';

  const candidatePropLogo = String(propOfficeLogo || '').trim();
  const candidateActiveLogo = String(activeIdentity.officeLogo || '').trim();
  const displayLogo = !isGenericLogo(candidatePropLogo)
    ? candidatePropLogo
    : !isGenericLogo(candidateActiveLogo)
      ? candidateActiveLogo
      : savedMetaLogo || '/155-uasu-baf-logo.png';

  const handleInstallClick = async () => {
    if (isInstallable) {
      const accepted = await install();
      if (accepted) return;
    }
    setShowGuideModal(true);
  };

  return (
    <>
      {variant === 'login' && (
        <button
          type="button"
          onClick={handleInstallClick}
          className="w-full py-2.5 px-3.5 rounded-xl bg-slate-100/90 dark:bg-slate-900/90 hover:bg-emerald-500/15 dark:hover:bg-emerald-500/15 border border-slate-200 dark:border-slate-800 hover:border-emerald-500/40 text-slate-700 dark:text-slate-200 hover:text-emerald-600 dark:hover:text-emerald-400 text-xs font-bold transition-all flex items-center justify-center gap-2.5 cursor-pointer group"
          title={`Install ${displayName} App with Office Logo`}
        >
          <img
            src={displayLogo}
            alt={displayName}
            className="w-4 h-4 rounded object-contain shrink-0"
          />
          <span className="truncate">
            Install <strong className="font-black text-emerald-600 dark:text-emerald-400">{displayName}</strong> App
          </span>
          <Download className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 group-hover:translate-y-0.5 transition-transform" />
        </button>
      )}

      {variant === 'sidebar' && (
        <button
          type="button"
          onClick={handleInstallClick}
          className={`flex items-center ${
            collapsed
              ? 'w-10 h-10 mx-auto justify-center p-0'
              : 'w-full justify-between px-3 py-2'
          } rounded-xl bg-emerald-600/10 dark:bg-emerald-500/15 border border-emerald-500/30 dark:border-emerald-400/25 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-600 hover:text-white dark:hover:bg-emerald-500 dark:hover:text-white text-xs font-bold transition-all duration-150 active:scale-[0.98] cursor-pointer group`}
          title={`Install ${displayName} PWA App`}
        >
          <div className="flex items-center gap-2.5 min-w-0 truncate">
            <img
              src={displayLogo}
              alt={displayName}
              className="w-4 h-4 rounded object-contain shrink-0"
            />
            {!collapsed && (
              <span className="truncate">Install {displayName} App</span>
            )}
          </div>
          {!collapsed && <Download className="w-3.5 h-3.5 shrink-0 opacity-80 group-hover:opacity-100" />}
        </button>
      )}

      {variant === 'header' && (
        <button
          type="button"
          onClick={handleInstallClick}
          className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs font-bold transition-all cursor-pointer"
          title={`Install ${displayName} App with Office Logo`}
        >
          <img
            src={displayLogo}
            alt={displayName}
            className="w-4 h-4 rounded object-contain shrink-0"
          />
          <span className="max-w-[140px] truncate">Install {displayName}</span>
          <Download className="w-3.5 h-3.5 shrink-0" />
        </button>
      )}

      {variant === 'settings' && (
        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src={displayLogo}
              alt={displayName}
              className="w-10 h-10 rounded-xl object-contain bg-white dark:bg-slate-900 p-1 border border-emerald-500/30 shrink-0"
            />
            <div className="min-w-0">
              <div className="text-xs font-black text-slate-900 dark:text-white truncate">
                {displayName} — PWA App
              </div>
              <div className="text-[11px] text-slate-600 dark:text-slate-400">
                Install on Home Screen / Desktop with this office&apos;s logo &amp; name
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleInstallClick}
            className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black flex items-center gap-1.5 shrink-0 cursor-pointer shadow-sm"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Install App</span>
          </button>
        </div>
      )}

      {showGuideModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/65 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-2xl text-left space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <img
                  src={displayLogo}
                  alt={displayName}
                  className="w-9 h-9 rounded-xl object-contain bg-slate-100 dark:bg-slate-800 p-1 border border-slate-200 dark:border-slate-700"
                />
                <div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-white">
                    Install {displayName}
                  </h3>
                  <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                    Office Logo &amp; Name Ready
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIOS ? (
              <div className="space-y-2.5 text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/70 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Share className="w-4 h-4 text-emerald-500" />
                  <span>Install on iPhone / iPad (Safari):</span>
                </div>
                <ol className="list-decimal list-inside space-y-1.5 text-[11px]">
                  <li>
                    Tap the <strong>Share</strong> button in Safari&apos;s toolbar.
                  </li>
                  <li>
                    Scroll down and tap <strong>Add to Home Screen</strong>.
                  </li>
                  <li>
                    Confirm the name <strong>{displayName}</strong> and tap <strong>Add</strong>.
                  </li>
                </ol>
              </div>
            ) : (
              <div className="space-y-2.5 text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/70 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Smartphone className="w-4 h-4 text-emerald-500" />
                  <span>How to Install {displayName} App:</span>
                </div>
                <ol className="list-decimal list-inside space-y-1.5 text-[11px]">
                  <li>
                    Open this app in your browser tab (Chrome / Edge).
                  </li>
                  <li>
                    Click the <strong>Install icon</strong> in the browser address bar (or tap the browser <strong>⋮ Menu → Install app / Add to Home screen</strong>).
                  </li>
                  <li>
                    The app will install with the <strong>{displayName}</strong> logo and name.
                  </li>
                </ol>
              </div>
            )}

            <div className="flex items-center gap-2 text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Active Manifest: {displayName}</span>
            </div>

            <button
              type="button"
              onClick={() => setShowGuideModal(false)}
              className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black uppercase tracking-wider cursor-pointer"
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </>
  );
};
