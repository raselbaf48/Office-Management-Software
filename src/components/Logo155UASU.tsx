import React, { useState, useEffect } from 'react';
import { getActiveOfficeIdentity } from '../firebase';

interface LogoProps {
  className?: string;
  size?: number | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  showText?: boolean;
  logoOverride?: string;
  onClick?: () => void;
  title?: string;
}

export const Logo155UASU: React.FC<LogoProps> = ({
  className = 'h-14 w-14',
  size,
  logoOverride,
  onClick,
  title,
}) => {
  const [identity, setIdentity] = useState(() => getActiveOfficeIdentity());
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    const refreshIdentity = () => {
      setIdentity(getActiveOfficeIdentity());
      setImgError(false);
    };
    window.addEventListener('baf_office_config_changed', refreshIdentity);
    window.addEventListener('baf_logo_updated', refreshIdentity);
    window.addEventListener('baf_settings_updated', refreshIdentity);
    window.addEventListener('baf_pwa_identity_updated', refreshIdentity);
    window.addEventListener('storage', refreshIdentity);
    return () => {
      window.removeEventListener('baf_office_config_changed', refreshIdentity);
      window.removeEventListener('baf_logo_updated', refreshIdentity);
      window.removeEventListener('baf_settings_updated', refreshIdentity);
      window.removeEventListener('baf_pwa_identity_updated', refreshIdentity);
      window.removeEventListener('storage', refreshIdentity);
    };
  }, []);

  useEffect(() => {
    setImgError(false);
  }, [logoOverride, identity.officeLogo]);

  let sizeStyle: React.CSSProperties = {};
  if (typeof size === 'number') {
    sizeStyle = { width: size, height: size };
  }

  const getSizeClass = () => {
    if (typeof size === 'number') return '';
    if (size === 'sm') return 'h-8 w-8';
    if (size === 'md') return 'h-12 w-12';
    if (size === 'lg') return 'h-[84px] w-[84px]'; // 130% Scale (84px x 84px, 1.3x of base 64px) for login portal & headers
    if (size === 'xl') return 'h-24 w-24';
    if (size === '2xl') return 'h-32 w-32';
    return className;
  };

  const rawLogoSrc = logoOverride || identity.officeLogo || '/baf-logo.png';
  const normalizedLogoSrc =
    rawLogoSrc.includes('155-uasu-baf-logo')
      ? '/155-uasu-baf-logo.png?v=26'
      : rawLogoSrc.includes('/baf-logo')
        ? '/baf-logo.png'
        : rawLogoSrc.includes('office-management-logo') || rawLogoSrc.includes('BAF Logo')
          ? '/baf-logo.png'
          : rawLogoSrc;

  const activeLogoSrc = imgError ? '/baf-logo.png' : normalizedLogoSrc;

  return (
    <div
      onClick={onClick}
      title={title}
      className={`inline-flex items-center justify-center shrink-0 select-none overflow-visible aspect-square transition-all duration-300 ${
        onClick ? 'cursor-pointer active:scale-95' : ''
      } ${getSizeClass()}`}
      style={sizeStyle}
    >
      <img
        src={activeLogoSrc}
        alt={`${identity.officeName} Crest`}
        onError={() => setImgError(true)}
        className="h-full w-full object-contain drop-shadow-md"
      />
    </div>
  );
};

