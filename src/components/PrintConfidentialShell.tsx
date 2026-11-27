import React from 'react';

interface PrintConfidentialShellProps {
  children: React.ReactNode;
  showOnScreen?: boolean;
  className?: string;
}

export const PrintConfidentialShell: React.FC<PrintConfidentialShellProps> = ({
  children,
  showOnScreen = false,
  className = '',
}) => {
  return (
    <div className={`print-conf-table ${className}`}>
      <div className={showOnScreen ? 'print-conf-thead print-conf-show-screen' : 'print-conf-thead'}>
        <div className="print-conf-row">
          <div className="print-conf-cell pb-0.5 print:pb-0.5">
            <div className="print-conf-banner text-slate-500" style={{ color: '#64748b' }}>CONFIDENTIAL</div>
          </div>
        </div>
      </div>

      <div className="print-conf-tbody">
        <div className="print-conf-row">
          <div className="print-conf-cell">{children}</div>
        </div>
      </div>

      <div className={showOnScreen ? 'print-conf-tfoot print-conf-show-screen' : 'print-conf-tfoot'}>
        <div className="print-conf-row">
          <div className="print-conf-cell pt-0.5 print:pt-0.5">
            <div className="print-conf-banner text-slate-500" style={{ color: '#64748b' }}>CONFIDENTIAL</div>
          </div>
        </div>
      </div>
    </div>
  );
};
