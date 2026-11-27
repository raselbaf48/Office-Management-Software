import React, { useState } from 'react';
import { Download, Share, PlusSquare, X, Smartphone } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  officeName?: string;
  officeLogo?: string;
  variant?: 'login' | 'sidebar' | 'header' | 'settings';
  collapsed?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  officeName = '155 UASU BAF',
  officeLogo,
  variant = 'header',
  collapsed = false,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [installing, setInstalling] = useState(false);

  // Never show the Install App option if already installed on this device or running in standalone/APK mode
  if (isInstalled) {
    return null;
  }

  // Only show when browser supports native install prompt (or iOS Safari manual Add to Home Screen)
  if (!isInstallable && !isIOS) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      setInstalling(true);
      try {
        await install();
      } finally {
        setInstalling(false);
      }
      return;
    }
    if (isIOS) {
      setShowIOSGuide(true);
    }
  };

  const renderButton = () => {
    if (variant === 'header') {
      return (
        <button
          type="button"
          onClick={handleClick}
          disabled={installing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600/15 hover:bg-emerald-600/25 dark:bg-emerald-500/15 dark:hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300 text-xs font-bold shadow-xs transition-all active:scale-95 cursor-pointer shrink-0 disabled:opacity-60"
          title={`Install ${officeName} App`}
        >
          <Download className="w-3.5 h-3.5 shrink-0" />
          <span>{installing ? 'Installing...' : 'Install App'}</span>
        </button>
      );
    }

    if (variant === 'sidebar') {
      return (
        <button
          type="button"
          onClick={handleClick}
          disabled={installing}
          className={`flex items-center ${
            collapsed ? 'w-10 h-10 mx-auto justify-center p-0' : 'w-full justify-start px-3 py-2.5 space-x-2.5'
          } rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm text-xs font-bold transition-all active:scale-[0.98] cursor-pointer disabled:opacity-60`}
          title={`Install ${officeName} App`}
        >
          <Download className="w-4 h-4 shrink-0" />
          {!collapsed && <span>{installing ? 'Installing...' : 'Install App'}</span>}
        </button>
      );
    }

    if (variant === 'settings') {
      return (
        <div className="flex items-center justify-between gap-3 p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-slate-900 border border-emerald-500/30 p-1.5 flex items-center justify-center shrink-0">
              {officeLogo ? (
                <img
                  src={officeLogo}
                  alt={officeName}
                  className="w-full h-full object-contain rounded-lg"
                />
              ) : (
                <Smartphone className="w-5 h-5 text-emerald-400" />
              )}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-black text-slate-900 dark:text-white truncate">
                Install {officeName} App
              </div>
              <div className="text-[11px] text-slate-600 dark:text-slate-400">
                Add to home screen for instant full-screen PWA access & realtime updates
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClick}
            disabled={installing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-sm transition-all active:scale-95 cursor-pointer shrink-0 disabled:opacity-60"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{installing ? 'Installing...' : 'Install App'}</span>
          </button>
        </div>
      );
    }

    // Default: 'login' variant
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={installing}
        className="w-full py-2.5 px-4 rounded-xl bg-emerald-600/15 hover:bg-emerald-600/25 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300 text-xs font-black tracking-wider uppercase transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98] disabled:opacity-60"
      >
        <Download className="w-4 h-4 shrink-0" />
        <span>{installing ? 'Installing...' : 'Install App'}</span>
      </button>
    );
  };

  return (
    <>
      {renderButton()}

      {showIOSGuide && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                {officeLogo && (
                  <img src={officeLogo} alt={officeName} className="w-8 h-8 rounded-lg object-contain bg-slate-950 p-1" />
                )}
                <h3 className="text-sm font-black text-slate-900 dark:text-white">
                  Install {officeName} on iPhone / iPad
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5 text-xs text-slate-600 dark:text-slate-300">
              <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800/80">
                <Share className="w-4 h-4 text-sky-500 shrink-0" />
                <span>
                  1. Safari ব্রাউজারের নিচে <strong>Share</strong> আইকনে ট্যাপ করুন।
                </span>
              </div>
              <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800/80">
                <PlusSquare className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>
                  2. নিচে স্ক্রল করে <strong>Add to Home Screen</strong> নির্বাচন করে <strong>Add</strong> দিন।
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowIOSGuide(false)}
              className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
};
