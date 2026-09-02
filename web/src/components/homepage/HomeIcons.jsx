/*
 * Simple, uniform monochrome marks for frameworks and integrations the homepage
 * references but which we don't ship real logo assets for. Each draws with
 * `currentColor` so CSS controls the tint per theme. These are deliberately
 * abstract glyphs, not reproductions of the brands' trademarks.
 */

const S = ({ children, label }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={label} className="hp-mark-svg">
    {children}
  </svg>
);

export const MARKS = {
  soc2: (
    <S label="SOC 2">
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
      <path d="M9 11.5l2 2 4-4.5" />
    </S>
  ),
  pci: (
    <S label="PCI DSS">
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 10h18" />
      <path d="M7 14.5h4" />
    </S>
  ),
  certin: (
    <S label="CERT-In">
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
      <circle cx="12" cy="11" r="2" />
      <path d="M12 13v3" />
    </S>
  ),
  m365: (
    <S label="Microsoft 365">
      <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1" />
      <rect x="13" y="3.5" width="7.5" height="7.5" rx="1" />
      <rect x="3.5" y="13" width="7.5" height="7.5" rx="1" />
      <rect x="13" y="13" width="7.5" height="7.5" rx="1" />
    </S>
  ),
  azure: (
    <S label="Azure">
      <path d="M9 4l-5.5 13H8l1.7-4.3L13 17l-4-2 3-8z" />
      <path d="M13 6l7.5 11H12" />
    </S>
  ),
  aws: (
    <S label="AWS">
      <path d="M5 10.5c2.5 1.6 11.5 1.6 14 0" />
      <path d="M4 15c4 3 12 3 16 0" />
      <path d="M18 13.5l1.5 1.5-1.5 1.5" />
      <path d="M7 6.5c1.8-1 7.2-1 9 0" />
    </S>
  ),
  gcp: (
    <S label="Google Cloud">
      <path d="M12 3l8 4.6v8.8L12 21l-8-4.6V7.6z" />
      <path d="M9 12a3 3 0 106 0 3 3 0 00-6 0z" />
    </S>
  ),
  zoho: (
    <S label="Zoho">
      <rect x="3.5" y="4" width="17" height="16" rx="3" />
      <path d="M8 8.5h7L8 15.5h7" />
    </S>
  ),
  jira: (
    <S label="Jira">
      <path d="M12 2l8 8-8 8-8-8z" />
      <path d="M12 8l4 4-4 4-4-4z" />
    </S>
  ),
  okta: (
    <S label="Okta">
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.2" />
    </S>
  ),
  slack: (
    <S label="Slack">
      <path d="M9.5 3.5L8 20.5" />
      <path d="M16 3.5L14.5 20.5" />
      <path d="M3.5 9h17" />
      <path d="M3 15h17" />
    </S>
  ),
};

export default function HomeMark({ name, className = "" }) {
  return <span className={`hp-mark ${className}`}>{MARKS[name] || null}</span>;
}
