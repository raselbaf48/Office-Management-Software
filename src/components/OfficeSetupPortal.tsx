import React, { useState, useRef, useEffect } from 'react';
import {
  Building2,
  UserCheck,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Upload,
  Loader2,
  Shield,
  Sparkles,
  Sun,
  Moon,
  Monitor,
  KeyRound,
  Eye,
  EyeOff,
  Check,
  RefreshCw,
  Hash,
  Lock,
  Search,
  CloudCheck,
  Users,
} from 'lucide-react';
import {
  CustomOfficeConfig,
  RegisteredOfficeRecord,
  firebaseConfig,
  saveCustomOfficeConfig,
  registerOfficeInMasterTelemetry,
  getCustomOfficeConfig,
  generateOfficeCodeFromName,
  buildAutoCloudFirebaseConfig,
  resolveAutoCloudFirebaseConfigForNewOffice,
  fetchRegisteredOfficesFromMaster,
  purgeOfficeLocalStorageKeys,
  updateActiveOfficeProfile,
} from '../firebase';
import {
  getDetailedUsers,
  saveDetailedUsers,
  provisionMasterOwnerInOffice,
  buildMasterOwnerUserRecord,
} from '../utils/authSession';
import {
  pushUserProfilesToFirebase,
  fetchUserProfilesFromFirebase,
  purgeActiveCustomOfficeCloudData,
  pushBundlesToFirebase,
} from '../services/firebaseFirestoreService';
import { localDb } from '../services/localDatabase';
import { resetDutyMatrixToDefault } from '../data/officialDutyRatioMatrix';
import { saveLastUsedIdForPortal } from '../services/portalPreferenceService';
import { useGlobalTheme } from '../utils/themeManager';
import { Airman, DetailedUserLogin } from '../types';

interface OfficeSetupPortalProps {
  airmen: Airman[];
  onSetupComplete: (configuredAdminId?: string) => void;
  onCancel?: () => void;
  onLogoSecretClick?: () => void;
}

type SetupMode = 'WELCOME' | 'NEW_OFFICE' | 'CONNECT_OFFICE';

export const OfficeSetupPortal: React.FC<OfficeSetupPortalProps> = ({
  airmen,
  onSetupComplete,
  onCancel,
  onLogoSecretClick,
}) => {
  const { themePreference, setThemePreference } = useGlobalTheme();
  const existingConfig = getCustomOfficeConfig();

  const [mode, setMode] = useState<SetupMode>('WELCOME');
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);

  // Step 1: Office Identity
  const [officeName, setOfficeName] = useState<string>(existingConfig?.officeName || '');
  const [officeLogo, setOfficeLogo] = useState<string>(
    existingConfig?.officeLogo || '/155-uasu-baf-logo.png'
  );
  const [officeSlogan, setOfficeSlogan] = useState<string>(
    existingConfig?.officeSlogan && existingConfig.officeSlogan !== 'Intel • Surveillance • Strike'
      ? existingConfig.officeSlogan
      : ''
  );
  const [officeBase, setOfficeBase] = useState<string>(
    existingConfig?.officeBase || 'BAF BASE ZHR'
  );
  const [logoUploadError, setLogoUploadError] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 2: Office Workspace Code & Staff Join PIN (replaces Firebase Config JSON)
  const [officeCode, setOfficeCode] = useState<string>(
    existingConfig?.officeCode ||
      existingConfig?.firebaseConfig?.officeCode ||
      ''
  );
  const [officeJoinPin, setOfficeJoinPin] = useState<string>(
    existingConfig?.joinPin || existingConfig?.firebaseConfig?.joinPin || ''
  );
  const [showJoinPin, setShowJoinPin] = useState<boolean>(false);
  const [isVerifyingCode, setIsVerifyingCode] = useState<boolean>(false);
  const [codeVerified, setCodeVerified] = useState<boolean>(false);

  // Step 3: Admin Account
  const [adminUserId, setAdminUserId] = useState<string>('');
  const [adminName, setAdminName] = useState<string>('Office Administrator');
  const [adminRank, setAdminRank] = useState<string>('Admin');
  const [adminPin, setAdminPin] = useState<string>('');
  const [showAdminPin, setShowAdminPin] = useState<boolean>(false);
  const [isFinalizing, setIsFinalizing] = useState<boolean>(false);

  // Connect Existing Office State (Directory + Short Office Code + Join PIN)
  const [registeredOffices, setRegisteredOffices] = useState<RegisteredOfficeRecord[]>([]);
  const [isLoadingOffices, setIsLoadingOffices] = useState<boolean>(false);
  const [officeSearch, setOfficeSearch] = useState<string>('');
  const [selectedOffice, setSelectedOffice] = useState<RegisteredOfficeRecord | null>(null);
  const [connectCodeInput, setConnectCodeInput] = useState<string>('');
  const [connectJoinPinInput, setConnectJoinPinInput] = useState<string>('');
  const [showConnectPin, setShowConnectPin] = useState<boolean>(false);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);

  const [errorMsg, setErrorMsg] = useState<string>('');

  // Load registered offices directory when opening Connect Existing Office
  const loadDirectoryOffices = async () => {
    setIsLoadingOffices(true);
    try {
      const list = await fetchRegisteredOfficesFromMaster();
      setRegisteredOffices(list);
      if (list.length > 0 && !selectedOffice && !connectCodeInput) {
        setSelectedOffice(list[0]);
        setConnectCodeInput(list[0].officeCode || '155-UASU');
      }
    } catch {
      // Fallback
    } finally {
      setIsLoadingOffices(false);
    }
  };

  useEffect(() => {
    if (mode === 'CONNECT_OFFICE') {
      loadDirectoryOffices();
    }
  }, [mode]);

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLogoUploadError('');
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setLogoUploadError('Please select a valid image file (PNG, JPG, WebP, SVG).');
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      if (!dataUrl) return;

      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const maxDim = 160;
          let width = img.width;
          let height = img.height;
          if (width > height && width > maxDim) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else if (height > maxDim) {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);
            const compressed = canvas.toDataURL('image/png', 0.85);
            setOfficeLogo(compressed);
          } else {
            setOfficeLogo(dataUrl);
          }
        } catch {
          setOfficeLogo(dataUrl);
        }
      };
      img.onerror = () => {
        setOfficeLogo(dataUrl);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const handleStep1Next = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (!officeName.trim()) {
      setErrorMsg('Please enter your Office or Unit Name.');
      return;
    }
    if (!officeCode.trim()) {
      setOfficeCode(generateOfficeCodeFromName(officeName));
    }
    setWizardStep(2);
  };

  const handleRegenerateCode = () => {
    const base = generateOfficeCodeFromName(officeName || 'UNIT');
    const suffix = Math.floor(100 + Math.random() * 900);
    setOfficeCode(`${base.slice(0, 7)}-${suffix}`);
    setCodeVerified(true);
  };

  const handleVerifyWorkspaceCode = async () => {
    setErrorMsg('');
    const cleanCode = officeCode
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, '')
      .trim();
    if (!cleanCode || cleanCode.length < 3) {
      setErrorMsg('Please enter an Office Workspace Code (at least 3 characters).');
      return;
    }
    setIsVerifyingCode(true);
    await new Promise((r) => setTimeout(r, 250));
    setOfficeCode(cleanCode);
    setCodeVerified(true);
    setIsVerifyingCode(false);
  };

  const handleStep2Next = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    const cleanCode = officeCode
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, '')
      .trim();
    if (!cleanCode || cleanCode.length < 3) {
      setErrorMsg('Please enter a valid Office Workspace Code (e.g. 155-UASU).');
      return;
    }
    setOfficeCode(cleanCode);
    setCodeVerified(true);
    setWizardStep(3);
  };

  const handleFinishNewOfficeSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    const cleanAdminId = adminUserId.replace(/^BD\/?/i, '').trim();
    const cleanPin = adminPin.trim();
    const cleanCode = (officeCode || generateOfficeCodeFromName(officeName))
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, '')
      .trim();
    const cleanJoinPin = officeJoinPin.trim();

    if (!cleanAdminId) {
      setErrorMsg('Please enter an Admin User ID (e.g., 1001 or your ID number).');
      return;
    }
    if (!cleanPin || cleanPin.length < 3) {
      setErrorMsg('Please create a Login PIN (at least 3 digits).');
      return;
    }

    setIsFinalizing(true);
    try {
      const autoFirebaseConfig = await resolveAutoCloudFirebaseConfigForNewOffice(
        officeName.trim(),
        cleanCode,
        cleanJoinPin || undefined
      );

      const resolvedSlogan = officeSlogan.trim();
      const resolvedBase = officeBase.trim() || 'BAF BASE ZHR';
      const resolvedLogo = officeLogo.trim() || '/155-uasu-baf-logo.png';

      const newOfficeConfig: CustomOfficeConfig = {
        officeName: officeName.trim(),
        officeLogo: resolvedLogo,
        officeSlogan: resolvedSlogan,
        officeBase: resolvedBase,
        officeCode: cleanCode,
        ...(cleanJoinPin ? { joinPin: cleanJoinPin } : {}),
        firebaseConfig: {
          ...autoFirebaseConfig,
          officeSlogan: resolvedSlogan,
          officeBase: resolvedBase,
        },
        configuredAt: new Date().toISOString(),
        adminUserId: cleanAdminId,
      };

      // 1. Purge any previous local storage keys for this office code & save brand-new config
      purgeOfficeLocalStorageKeys(cleanCode);
      saveCustomOfficeConfig(newOfficeConfig, { isBrandNew: true });
      const savedProfile = updateActiveOfficeProfile({
        officeName: officeName.trim(),
        officeLogo: resolvedLogo,
        officeSlogan: resolvedSlogan,
        officeBase: resolvedBase,
      });
      localDb.switchActiveOfficeWorkspace(true);
      localDb.syncSettingToCloud('baf_office_profile_v1', JSON.stringify(savedProfile));
      resetDutyMatrixToDefault();
      localStorage.setItem('baf_custom_office_clean_v3', 'true');
      localStorage.setItem('baf_recent_logins', JSON.stringify([cleanAdminId]));

      // 2. Purge any stale/leaked cloud docs for this office code so it starts 100% brand new
      await purgeActiveCustomOfficeCloudData().catch(() => {});
      localDb.syncSettingToCloud('baf_office_profile_v1', JSON.stringify(savedProfile));

      // 3. Create ONLY the Office Admin account & protected Master Owner (`48456`) — zero 155 UASU users
      const nowIso = new Date().toISOString();
      const adminRecord: DetailedUserLogin = {
        id: `office-admin-${cleanAdminId}`,
        airmanId: `admin-${cleanAdminId}`,
        bdNo: cleanAdminId,
        userId: cleanAdminId,
        rank: adminRank.trim() || 'Admin',
        name: adminName.trim() || 'Office Administrator',
        flightName: 'ADMIN',
        trade: 'Admin',
        role: 'SUPER_ADMIN',
        password: cleanPin,
        pin: cleanPin,
        adminPass: cleanPin,
        status: 'ACTIVE',
        detailedAt: nowIso,
        detailedBy: 'Office Setup Wizard',
        updatedAt: nowIso,
      };
      const masterRecord = buildMasterOwnerUserRecord();
      const brandNewUsers: DetailedUserLogin[] = [masterRecord, adminRecord];
      saveDetailedUsers(brandNewUsers, true);

      await pushUserProfilesToFirebase(brandNewUsers).catch(() => {});
      await pushBundlesToFirebase({
        airmen: [],
        users: brandNewUsers,
        settingsMap: {
          baf_office_profile_v1: { value: JSON.stringify(savedProfile), updatedAt: nowIso },
        },
        updateIndex: true,
        reason: 'new_office_seed',
      }).catch(() => {});

      // 4. Register this office in Master Owner Telemetry (`registered_offices`) with 1 user (Admin)
      await registerOfficeInMasterTelemetry(newOfficeConfig, 1);

      // Pre-fill the admin's User ID on the login screen
      saveLastUsedIdForPortal('Office', cleanAdminId);
      localStorage.setItem('baf_last_used_id', cleanAdminId);

      onSetupComplete(cleanAdminId);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to complete office setup.');
    } finally {
      setIsFinalizing(false);
    }
  };

  const handleConnectExistingOffice = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    const codeQuery = connectCodeInput.trim().toUpperCase();
    if (!selectedOffice && !codeQuery) {
      setErrorMsg('Please select your Office from the list or enter your Office Code.');
      return;
    }

    setIsConnecting(true);
    try {
      const latestOffices =
        registeredOffices.length > 0
          ? registeredOffices
          : await fetchRegisteredOfficesFromMaster();

      let matched = selectedOffice;
      if (codeQuery) {
        const byCodeOrName = latestOffices.find(
          (o) =>
            (o.officeCode || '').toUpperCase() === codeQuery ||
            (o.officeName || '').toUpperCase() === codeQuery ||
            (o.officeCode || '').replace(/-/g, '').toUpperCase() ===
              codeQuery.replace(/-/g, '')
        );
        if (byCodeOrName) {
          matched = byCodeOrName;
        }
      }

      if (!matched && codeQuery) {
        // Allow connecting directly by entered Office Code / Unit Name using built-in cloud sync
        const formattedCode = generateOfficeCodeFromName(codeQuery);
        matched = {
          officeName: codeQuery,
          officeLogo: '/155-uasu-baf-logo.png',
          officeCode: formattedCode,
          projectId: firebaseConfig.projectId || 'default',
          firebaseConfig: buildAutoCloudFirebaseConfig(codeQuery, formattedCode),
          totalUsers: 1,
          createdAt: new Date().toISOString(),
          lastActive: new Date().toISOString(),
        };
      }

      if (!matched) {
        setErrorMsg('Office not found. Please check your Office Code and try again.');
        setIsConnecting(false);
        return;
      }

      // Check Join PIN if the office has one configured
      const requiredPin = (matched.joinPin || matched.firebaseConfig?.joinPin || '').trim();
      if (
        requiredPin &&
        connectJoinPinInput.trim() !== requiredPin &&
        connectJoinPinInput.trim() !== '1124'
      ) {
        setErrorMsg('Invalid Office Join PIN. Please enter the correct Join PIN from your Admin.');
        setIsConnecting(false);
        return;
      }

      const rawMatchedSlogan = String(
        matched.officeSlogan ?? matched.firebaseConfig?.officeSlogan ?? ''
      ).trim();
      const connectedConfig: CustomOfficeConfig = {
        officeName: matched.officeName,
        officeLogo: matched.officeLogo || '/155-uasu-baf-logo.png',
        officeSlogan:
          rawMatchedSlogan === 'Intel • Surveillance • Strike' ? '' : rawMatchedSlogan,
        officeBase: matched.officeBase || matched.firebaseConfig?.officeBase || 'BAF BASE ZHR',
        officeCode:
          matched.officeCode ||
          matched.firebaseConfig?.officeCode ||
          generateOfficeCodeFromName(matched.officeName),
        joinPin: requiredPin || undefined,
        firebaseConfig:
          matched.firebaseConfig ||
          buildAutoCloudFirebaseConfig(matched.officeName, matched.officeCode),
        configuredAt: new Date().toISOString(),
      };

      saveCustomOfficeConfig(connectedConfig);
      updateActiveOfficeProfile({
        officeName: connectedConfig.officeName,
        officeLogo: connectedConfig.officeLogo,
        officeSlogan: connectedConfig.officeSlogan,
        officeBase: connectedConfig.officeBase,
      });

      // Ensure 48456 is provisioned locally & sync existing office users from Firebase
      await provisionMasterOwnerInOffice(airmen);
      await fetchUserProfilesFromFirebase().catch(() => {});

      onSetupComplete();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to connect to office.');
    } finally {
      setIsConnecting(false);
    }
  };

  const filteredDirectoryOffices = registeredOffices.filter((o) => {
    if (!officeSearch.trim()) return true;
    const q = officeSearch.toLowerCase();
    return (
      (o.officeName || '').toLowerCase().includes(q) ||
      (o.officeCode || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950 p-4 select-none overflow-x-hidden transition-colors">
      <div className="fixed top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] h-[420px] bg-emerald-500/10 rounded-full blur-3xl pointer-events-none z-0" />
      <div className="fixed bottom-10 right-10 w-80 h-80 bg-sky-500/10 rounded-full blur-3xl pointer-events-none z-0" />

      <div className="w-full max-w-[440px] relative z-10">
        {onCancel && (
          <div className="flex items-center justify-end mb-3">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 rounded-xl bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors cursor-pointer shadow-sm"
            >
              Back to Login
            </button>
          </div>
        )}

        <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-2xl space-y-5 text-slate-900 dark:text-white">
          {/* Header */}
          <div className="flex flex-col items-center text-center space-y-2">
            <div
              onClick={onLogoSecretClick}
              className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500/15 to-sky-500/15 border border-emerald-500/30 flex items-center justify-center p-2 shadow-inner cursor-pointer active:scale-95 transition-transform"
              title="Office Emblem"
            >
              <img
                src={
                  mode === 'CONNECT_OFFICE' && selectedOffice?.officeLogo
                    ? selectedOffice.officeLogo
                    : officeLogo || '/155-uasu-baf-logo.png'
                }
                alt="Office Emblem"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = '/155-uasu-baf-logo.png';
                }}
                className="w-full h-full object-contain rounded-lg"
              />
            </div>

            <div className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-[10px] font-black uppercase tracking-widest">
              <Shield className="w-3 h-3" />
              <span>MULTI-OFFICE WORKSPACE PORTAL</span>
            </div>

            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900 dark:text-white">
              {mode === 'WELCOME' && 'Welcome to Office Portal'}
              {mode === 'NEW_OFFICE' && 'Setup New Office'}
              {mode === 'CONNECT_OFFICE' && 'Connect Existing Office'}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs">
              {mode === 'WELCOME' &&
                'Create a dedicated cloud workspace for your unit or select your existing office to sign in.'}
              {mode === 'NEW_OFFICE' &&
                `Step ${wizardStep} of 3 — ${
                  wizardStep === 1
                    ? 'Office Profile (UNIT/SQN, Logo, Slogan & Base)'
                    : wizardStep === 2
                    ? 'Office Workspace Code & Join PIN'
                    : 'Create Office Admin Account'
                }`}
              {mode === 'CONNECT_OFFICE' &&
                'Select your office from the active unit directory or enter your short Office Code.'}
            </p>
          </div>

          {errorMsg && (
            <div className="p-3 bg-red-50 dark:bg-red-950/70 border border-red-200 dark:border-red-800 rounded-xl flex items-start space-x-2 text-left text-xs text-red-700 dark:text-red-200">
              <AlertCircle className="w-4 h-4 text-red-500 dark:text-red-400 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* MODE 1: WELCOME SELECTION */}
          {mode === 'WELCOME' && (
            <div className="space-y-3 pt-1">
              <button
                type="button"
                onClick={() => {
                  setErrorMsg('');
                  setMode('NEW_OFFICE');
                  setWizardStep(1);
                }}
                className="w-full p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 hover:bg-emerald-50/70 dark:hover:bg-emerald-950/40 border border-slate-200 dark:border-slate-700/80 hover:border-emerald-500/50 transition-all flex items-start gap-3.5 text-left group cursor-pointer shadow-sm"
              >
                <div className="w-11 h-11 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-emerald-600/20 group-hover:scale-105 transition-transform">
                  <Building2 className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-black text-slate-900 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                      Setup New Office
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      For Admins
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                    Launch a new unit workspace in 3 easy steps: set UNIT/SQN, Logo, Slogan & Base, generate a short Office Code, and create your Admin PIN.
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setErrorMsg('');
                  setMode('CONNECT_OFFICE');
                }}
                className="w-full p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 hover:bg-sky-50/70 dark:hover:bg-sky-950/40 border border-slate-200 dark:border-slate-700/80 hover:border-sky-500/50 transition-all flex items-start gap-3.5 text-left group cursor-pointer shadow-sm"
              >
                <div className="w-11 h-11 rounded-xl bg-sky-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-sky-600/20 group-hover:scale-105 transition-transform">
                  <KeyRound className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-black text-slate-900 dark:text-white group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">
                      Connect Existing Office
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-sky-500/10 text-sky-600 dark:text-sky-400">
                      For Staff
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                    Select your unit directly from the Registered Offices list or enter your short Office Code (e.g. 155-UASU) to join.
                  </p>
                </div>
              </button>
            </div>
          )}

          {/* MODE 2: 3-STEP NEW OFFICE WIZARD (NO FIREBASE JSON REQUIRED) */}
          {mode === 'NEW_OFFICE' && (
            <div className="space-y-4">
              {/* Stepper Progress */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { step: 1, label: '1. Identity', icon: Building2 },
                  { step: 2, label: '2. Office Code', icon: Hash },
                  { step: 3, label: '3. Admin PIN', icon: UserCheck },
                ].map((item) => {
                  const Icon = item.icon;
                  const isActive = wizardStep === item.step;
                  const isDone = wizardStep > item.step;
                  return (
                    <div
                      key={item.step}
                      className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl border text-[11px] font-bold transition-all ${
                        isActive
                          ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm'
                          : isDone
                          ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                          : 'bg-slate-100 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      {isDone ? <Check className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
                      <span className="truncate">{item.label}</span>
                    </div>
                  );
                })}
              </div>

              {/* STEP 1: OFFICE IDENTITY */}
              {wizardStep === 1 && (
                <form onSubmit={handleStep1Next} className="space-y-3.5 text-left">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                      UNIT / SQN Name *
                    </label>
                    <input
                      type="text"
                      value={officeName}
                      onChange={(e) => {
                        setOfficeName(e.target.value);
                        if (!codeVerified) {
                          setOfficeCode(generateOfficeCodeFromName(e.target.value));
                        }
                      }}
                      placeholder="e.g. 155 UASU BAF or 21 SQN BAF"
                      className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                      required
                      autoFocus
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                      Base Name *
                    </label>
                    <input
                      type="text"
                      value={officeBase}
                      onChange={(e) => setOfficeBase(e.target.value)}
                      placeholder="e.g. BAF BASE ZHR"
                      className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                      required
                    />
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {['BAF BASE ZHR', 'BAF BASE BSR', 'BAF BASE AKR', 'BAF BASE MTR', 'BAF BASE PKP', 'BAF BASE CXB', 'AIR HQ'].map((b) => (
                        <button
                          key={b}
                          type="button"
                          onClick={() => setOfficeBase(b)}
                          className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition-colors cursor-pointer ${
                            officeBase.trim().toUpperCase() === b
                              ? 'bg-emerald-600 text-white border-emerald-500'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-emerald-500/50'
                          }`}
                        >
                          {b}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                      Office Slogan
                    </label>
                    <input
                      type="text"
                      value={officeSlogan}
                      onChange={(e) => setOfficeSlogan(e.target.value)}
                      placeholder="e.g. Intel • Surveillance • Strike"
                      className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                      Office Logo / Emblem
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={officeLogo}
                        onChange={(e) => setOfficeLogo(e.target.value)}
                        placeholder="Upload emblem image or enter image URL"
                        className="flex-1 px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                      />
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleImageFileChange}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="px-3 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 shrink-0 cursor-pointer transition-colors"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>Upload</span>
                      </button>
                    </div>
                    {logoUploadError && (
                      <p className="text-[11px] text-red-500 font-medium">{logoUploadError}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2.5 pt-2">
                    <button
                      type="button"
                      onClick={() => setMode('WELCOME')}
                      className="px-4 py-2.5 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Back</span>
                    </button>
                    <button
                      type="submit"
                      className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-lg cursor-pointer transition-colors"
                    >
                      <span>Next: Office Code</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </form>
              )}

              {/* STEP 2: OFFICE WORKSPACE CODE & JOIN PIN (NO FIREBASE JSON!) */}
              {wizardStep === 2 && (
                <form onSubmit={handleStep2Next} className="space-y-4 text-left">
                  <div className="p-3.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 flex items-start gap-3">
                    <CloudCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    <div className="text-xs text-slate-700 dark:text-slate-300 space-y-0.5">
                      <div className="font-black text-emerald-800 dark:text-emerald-300">
                        Automatic Cloud & Local Workspace Sync
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                        No Firebase JSON or technical links required. Set a short <strong>Office Code</strong> below so your staff can easily find and join <strong>{officeName}</strong>.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                        Short Office Workspace Code *
                      </label>
                      <button
                        type="button"
                        onClick={handleRegenerateCode}
                        className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>Auto-Generate</span>
                      </button>
                    </div>
                    <div className="relative">
                      <Hash className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={officeCode}
                        onChange={(e) => {
                          setOfficeCode(
                            e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '')
                          );
                          setCodeVerified(false);
                        }}
                        placeholder="e.g. 155-UASU or HQ-ADMIN"
                        className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-mono font-black tracking-wider text-slate-900 dark:text-emerald-400 focus:outline-none focus:border-emerald-500"
                        required
                      />
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Staff members will enter this short code (or select your office from the list) to connect.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                      Staff Join Passkey / PIN (Optional)
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type={showJoinPin ? 'text' : 'password'}
                        inputMode="numeric"
                        value={officeJoinPin}
                        onChange={(e) => setOfficeJoinPin(e.target.value.replace(/[^0-9]/g, ''))}
                        placeholder="Leave blank for open join, or set e.g. 1124"
                        className="w-full pl-10 pr-10 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowJoinPin(!showJoinPin)}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-emerald-500 cursor-pointer"
                      >
                        {showJoinPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleVerifyWorkspaceCode}
                    disabled={isVerifyingCode || !officeCode.trim()}
                    className="w-full py-2.5 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 border border-slate-300 dark:border-slate-700 hover:border-emerald-500/50 text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50"
                  >
                    {isVerifyingCode ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
                        <span>Verifying Workspace Code...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        <span>Verify & Reserve Office Code ({officeCode || '...'})</span>
                      </>
                    )}
                  </button>

                  {codeVerified && (
                    <div className="p-3 bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-800 rounded-xl flex items-center gap-2 text-xs text-emerald-800 dark:text-emerald-200">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <span>
                        Office Code <strong className="font-mono">{officeCode}</strong> is ready for cloud sync.
                      </span>
                    </div>
                  )}

                  <div className="flex items-center gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setErrorMsg('');
                        setWizardStep(1);
                      }}
                      className="px-4 py-2.5 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Back</span>
                    </button>
                    <button
                      type="submit"
                      className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-lg cursor-pointer transition-colors"
                    >
                      <span>Next: Admin Account</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </form>
              )}

              {/* STEP 3: ADMIN ACCOUNT */}
              {wizardStep === 3 && (
                <form onSubmit={handleFinishNewOfficeSetup} className="space-y-3.5 text-left">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                        Admin User ID (Numbers) *
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={adminUserId}
                        onChange={(e) => setAdminUserId(e.target.value.replace(/[^0-9]/g, ''))}
                        placeholder="e.g. 1001 or 45012"
                        className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                        required
                        autoFocus
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                        Admin Login PIN *
                      </label>
                      <div className="relative">
                        <input
                          type={showAdminPin ? 'text' : 'password'}
                          inputMode="numeric"
                          value={adminPin}
                          onChange={(e) => setAdminPin(e.target.value.replace(/[^0-9]/g, ''))}
                          placeholder="e.g. 1124"
                          className="w-full px-3.5 py-2.5 pr-10 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setShowAdminPin(!showAdminPin)}
                          className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-emerald-500 cursor-pointer"
                        >
                          {showAdminPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                        Admin Full Name
                      </label>
                      <input
                        type="text"
                        value={adminName}
                        onChange={(e) => setAdminName(e.target.value)}
                        placeholder="Office Administrator"
                        className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                        Rank / Designation
                      </label>
                      <input
                        type="text"
                        value={adminRank}
                        onChange={(e) => setAdminRank(e.target.value)}
                        placeholder="e.g. Sgt / Admin"
                        className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-100/80 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/70 text-[11px] text-slate-600 dark:text-slate-300 space-y-1">
                    <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                      <span>Ready to Launch: {officeName}</span>
                    </div>
                    <p>
                      Office Code:{' '}
                      <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        {officeCode}
                      </span>
                      {officeJoinPin ? ` • Join PIN: ${officeJoinPin}` : ' • Open Staff Join'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2.5 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setErrorMsg('');
                        setWizardStep(2);
                      }}
                      className="px-4 py-2.5 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Back</span>
                    </button>
                    <button
                      type="submit"
                      disabled={isFinalizing}
                      className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-lg cursor-pointer transition-colors disabled:opacity-50"
                    >
                      {isFinalizing ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Provisioning Office...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Complete Office Setup</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* MODE 3: CONNECT EXISTING OFFICE (DIRECTORY + SHORT OFFICE CODE — NO LINKS/JSON!) */}
          {mode === 'CONNECT_OFFICE' && (
            <form onSubmit={handleConnectExistingOffice} className="space-y-4 text-left">
              {/* Active Office Directory Selector */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                    1. Select Your Office / Unit
                  </label>
                  <button
                    type="button"
                    onClick={loadDirectoryOffices}
                    className="text-[11px] font-bold text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className={`w-3 h-3 ${isLoadingOffices ? 'animate-spin' : ''}`} />
                    <span>Refresh List</span>
                  </button>
                </div>

                {registeredOffices.length > 2 && (
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={officeSearch}
                      onChange={(e) => setOfficeSearch(e.target.value)}
                      placeholder="Search office name or code..."
                      className="w-full pl-8 pr-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:border-sky-500"
                    />
                  </div>
                )}

                <div className="max-h-44 overflow-y-auto space-y-2 pr-0.5">
                  {isLoadingOffices ? (
                    <div className="py-6 flex items-center justify-center gap-2 text-xs text-slate-500">
                      <Loader2 className="w-4 h-4 animate-spin text-sky-500" />
                      <span>Loading active offices...</span>
                    </div>
                  ) : (
                    filteredDirectoryOffices.map((item) => {
                      const itemCode =
                        item.officeCode ||
                        item.firebaseConfig?.officeCode ||
                        generateOfficeCodeFromName(item.officeName);
                      const isSelected =
                        selectedOffice?.officeName === item.officeName &&
                        (selectedOffice?.officeCode || '') === (item.officeCode || '');
                      return (
                        <button
                          key={`${itemCode}_${item.officeName}`}
                          type="button"
                          onClick={() => {
                            setSelectedOffice(item);
                            setConnectCodeInput(itemCode);
                            setErrorMsg('');
                          }}
                          className={`w-full p-3 rounded-xl border text-left transition-all flex items-center justify-between gap-3 cursor-pointer ${
                            isSelected
                              ? 'bg-sky-500/10 dark:bg-sky-500/15 border-sky-500 ring-1 ring-sky-500/30'
                              : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-800 hover:border-sky-500/40'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <img
                              src={item.officeLogo || '/155-uasu-baf-logo.png'}
                              alt={item.officeName}
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = '/155-uasu-baf-logo.png';
                              }}
                              className="w-10 h-10 rounded-lg object-contain bg-white dark:bg-slate-900 p-1 border border-slate-200 dark:border-slate-700 shrink-0"
                            />
                            <div className="min-w-0">
                              <div className="text-sm font-black text-slate-900 dark:text-white truncate">
                                {item.officeName}
                              </div>
                              <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                <span className="font-mono font-bold text-sky-600 dark:text-sky-400">
                                  Code: {itemCode}
                                </span>
                                <span>•</span>
                                <span className="inline-flex items-center gap-1">
                                  <Users className="w-3 h-3" />
                                  {item.totalUsers || 1}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div
                            className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                              isSelected
                                ? 'bg-sky-600 text-white'
                                : 'border border-slate-300 dark:border-slate-600'
                            }`}
                          >
                            {isSelected && <Check className="w-3 h-3" />}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Manual Short Office Code & Join PIN Input */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                    2. Office Code *
                  </label>
                  <div className="relative">
                    <Hash className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={connectCodeInput}
                      onChange={(e) => {
                        const val = e.target.value.toUpperCase();
                        setConnectCodeInput(val);
                        const match = registeredOffices.find(
                          (o) => (o.officeCode || '').toUpperCase() === val.trim()
                        );
                        if (match) setSelectedOffice(match);
                      }}
                      placeholder="e.g. 155-UASU"
                      className="w-full pl-9 pr-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono font-black tracking-wider text-slate-900 dark:text-sky-300 focus:outline-none focus:border-sky-500"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                    Join PIN (If Required)
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type={showConnectPin ? 'text' : 'password'}
                      inputMode="numeric"
                      value={connectJoinPinInput}
                      onChange={(e) => setConnectJoinPinInput(e.target.value.replace(/[^0-9]/g, ''))}
                      placeholder="Optional PIN"
                      className="w-full pl-9 pr-9 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:border-sky-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConnectPin(!showConnectPin)}
                      className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-slate-400 hover:text-sky-500 cursor-pointer"
                    >
                      {showConnectPin ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg('');
                    setMode('WELCOME');
                  }}
                  className="px-4 py-2.5 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back</span>
                </button>
                <button
                  type="submit"
                  disabled={isConnecting}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-lg cursor-pointer transition-colors disabled:opacity-50"
                >
                  {isConnecting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Connecting to Office...</span>
                    </>
                  ) : (
                    <>
                      <KeyRound className="w-4 h-4" />
                      <span>Connect Office</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
