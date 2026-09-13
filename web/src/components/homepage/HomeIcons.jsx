import React from "react";

/* Clean, crisp SVG marks for frameworks and technology integrations */
export const MARKS = {
  dpdpa: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <circle cx="24" cy="24" r="22" stroke="#d97706" strokeWidth="2.5" fill="#fef3c7" fillOpacity="0.4" />
      <path d="M24 10 L28 18 L37 19 L30 25 L32 34 L24 29 L16 34 L18 25 L11 19 L20 18 Z" fill="#d97706" />
      <circle cx="24" cy="24" r="5" stroke="#92400e" strokeWidth="1.5" />
    </svg>
  ),
  gdpr: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <rect x="4" y="4" width="40" height="40" rx="8" fill="#1e3a8a" />
      <circle cx="24" cy="12" r="2" fill="#fbbf24" />
      <circle cx="32" cy="15" r="2" fill="#fbbf24" />
      <circle cx="36" cy="24" r="2" fill="#fbbf24" />
      <circle cx="32" cy="33" r="2" fill="#fbbf24" />
      <circle cx="24" cy="36" r="2" fill="#fbbf24" />
      <circle cx="16" cy="33" r="2" fill="#fbbf24" />
      <circle cx="12" cy="24" r="2" fill="#fbbf24" />
      <circle cx="16" cy="15" r="2" fill="#fbbf24" />
    </svg>
  ),
  hipaa: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <rect x="4" y="4" width="40" height="40" rx="8" fill="#0284c7" fillOpacity="0.15" stroke="#0284c7" strokeWidth="2" />
      <path d="M24 12v24M12 24h24" stroke="#0284c7" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M19 19h10v10H19z" fill="#0284c7" fillOpacity="0.3" />
    </svg>
  ),
  pci: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <rect x="4" y="4" width="40" height="40" rx="8" fill="#15803d" fillOpacity="0.15" stroke="#15803d" strokeWidth="2" />
      <rect x="11" y="15" width="26" height="18" rx="3" stroke="#15803d" strokeWidth="2.5" />
      <path d="M11 21h26" stroke="#15803d" strokeWidth="2.5" />
      <circle cx="17" cy="27" r="2" fill="#15803d" />
      <rect x="23" y="26" width="10" height="2" rx="1" fill="#15803d" />
    </svg>
  ),
  rbi: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <circle cx="24" cy="24" r="22" stroke="#0f766e" strokeWidth="2.5" fill="#ccfbf1" fillOpacity="0.35" />
      <circle cx="24" cy="24" r="17" stroke="#0f766e" strokeWidth="1.5" strokeDasharray="3 3" />
      <path d="M24 13v6M18 19h12M19 25h10M24 25v10" stroke="#0f766e" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  ),
  iso27001: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <rect x="4" y="4" width="40" height="40" rx="8" fill="#4338ca" fillOpacity="0.15" stroke="#4338ca" strokeWidth="2" />
      <path d="M24 10l12 5v9c0 7.5-5 13-12 15-7-2-12-7.5-12-15v-9l12-5z" stroke="#4338ca" strokeWidth="2.5" fill="#4338ca" fillOpacity="0.2" />
      <path d="M19 23l3.5 3.5 7-7" stroke="#4338ca" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  soc2: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <circle cx="24" cy="24" r="21" fill="#0369a1" />
      <text x="24" y="21" fill="#ffffff" fontSize="10" fontWeight="700" textAnchor="middle">AICPA</text>
      <text x="24" y="32" fill="#38bdf8" fontSize="11" fontWeight="800" textAnchor="middle">SOC 2</text>
    </svg>
  ),
  cis: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <circle cx="24" cy="24" r="21" stroke="#0d9488" strokeWidth="2.5" fill="#f0fdfa" />
      <path d="M16 24a8 8 0 1116 0 8 8 0 01-16 0" stroke="#0d9488" strokeWidth="3" strokeDasharray="38 12" />
      <text x="24" y="27" fill="#0d9488" fontSize="10" fontWeight="800" textAnchor="middle">CIS</text>
    </svg>
  ),
  certin: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <rect x="4" y="4" width="40" height="40" rx="8" fill="#0f172a" stroke="#0284c7" strokeWidth="2" />
      <circle cx="24" cy="24" r="14" stroke="#38bdf8" strokeWidth="2" />
      <circle cx="24" cy="24" r="6" fill="#38bdf8" />
      <path d="M24 10v4M24 34v4M10 24h4M34 24h4" stroke="#38bdf8" strokeWidth="2" />
    </svg>
  ),
  itgc: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <rect x="4" y="4" width="40" height="40" rx="8" fill="#4f46e5" fillOpacity="0.15" stroke="#4f46e5" strokeWidth="2" />
      <circle cx="24" cy="24" r="10" stroke="#4f46e5" strokeWidth="2" strokeDasharray="4 2" />
      <circle cx="24" cy="24" r="4" fill="#4f46e5" />
    </svg>
  ),
  iso19770: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <rect x="4" y="4" width="40" height="40" rx="8" fill="#dc2626" fillOpacity="0.15" stroke="#dc2626" strokeWidth="2" />
      <rect x="14" y="14" width="20" height="20" rx="3" stroke="#dc2626" strokeWidth="2.5" />
      <path d="M14 20h20M20 14v20" stroke="#dc2626" strokeWidth="2" />
    </svg>
  ),
  aws: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <rect x="4" y="4" width="40" height="40" rx="8" fill="#232f3e" />
      <path d="M14 22l4 6 4-6M28 22l2 6 2-6M36 22l-2 6 2-6" stroke="#ff9900" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 32c8 4 16 4 24 0" stroke="#ff9900" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  ),
  azure: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <rect x="4" y="4" width="40" height="40" rx="8" fill="#0078d4" fillOpacity="0.15" stroke="#0078d4" strokeWidth="2" />
      <path d="M18 10l-10 26h10l3.5-9 6 9h12.5l-10-14 8-12H26l-4 6-4-6z" fill="#0078d4" />
    </svg>
  ),
  akamai: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <circle cx="24" cy="24" r="20" fill="#0099de" fillOpacity="0.15" stroke="#0099de" strokeWidth="2" />
      <path d="M14 24c3-8 17-8 20 0s-17 8-20 0z" stroke="#0099de" strokeWidth="3" fill="#ff9900" fillOpacity="0.8" />
    </svg>
  ),
  cloudflare: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <rect x="4" y="4" width="40" height="40" rx="8" fill="#f38020" fillOpacity="0.15" stroke="#f38020" strokeWidth="2" />
      <path d="M15 30h20a6 6 0 000-12 8 8 0 00-15-2 6 6 0 00-5 14z" fill="#f38020" />
    </svg>
  ),
  defender: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <path d="M24 8l14 6v10c0 9-6 15-14 18-8-3-14-9-14-18V14l14-6z" fill="#0078d4" fillOpacity="0.2" stroke="#0078d4" strokeWidth="2" />
      <path d="M24 16l8 3.5v5.5c0 5-3.5 9-8 10.5-4.5-1.5-8-5.5-8-10.5v-5.5l8-3.5z" fill="#0078d4" />
    </svg>
  ),
  crowdstrike: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <rect x="4" y="4" width="40" height="40" rx="8" fill="#e01a22" fillOpacity="0.15" stroke="#e01a22" strokeWidth="2" />
      <path d="M16 28l8-14 8 14-8-4-8 4z" fill="#e01a22" />
    </svg>
  ),
  checkpoint: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <circle cx="24" cy="24" r="20" fill="#ea005a" fillOpacity="0.15" stroke="#ea005a" strokeWidth="2" />
      <circle cx="24" cy="24" r="8" fill="#ea005a" />
    </svg>
  ),
  sophos: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <rect x="4" y="4" width="40" height="40" rx="8" fill="#004e89" fillOpacity="0.15" stroke="#004e89" strokeWidth="2" />
      <path d="M14 26c1 5 7 6 11 4 4-2 6-6 4-10-2-4-7-4-10-3-4 1-5 4-5 9z" stroke="#004e89" strokeWidth="3" strokeLinecap="round" />
    </svg>
  ),
  purview: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <rect x="4" y="4" width="40" height="40" rx="8" fill="#0078d4" fillOpacity="0.15" stroke="#0078d4" strokeWidth="2" />
      <circle cx="24" cy="24" r="10" stroke="#0078d4" strokeWidth="2.5" />
      <circle cx="24" cy="24" r="4" fill="#0078d4" />
    </svg>
  ),
  onetrust: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <rect x="4" y="4" width="40" height="40" rx="8" fill="#059669" fillOpacity="0.15" stroke="#059669" strokeWidth="2" />
      <circle cx="24" cy="24" r="10" stroke="#059669" strokeWidth="3" />
      <path d="M24 18v12" stroke="#059669" strokeWidth="3" strokeLinecap="round" />
    </svg>
  ),
  privy: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <rect x="4" y="4" width="40" height="40" rx="8" fill="#6366f1" fillOpacity="0.15" stroke="#6366f1" strokeWidth="2" />
      <circle cx="24" cy="20" r="6" stroke="#6366f1" strokeWidth="2.5" />
      <path d="M14 34c0-5.5 4.5-8 10-8s10 2.5 10 8" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  ),
  opentext: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <rect x="4" y="4" width="40" height="40" rx="8" fill="#1e293b" stroke="#334155" strokeWidth="2" />
      <text x="24" y="28" fill="#38bdf8" fontSize="10" fontWeight="900" textAnchor="middle">opentext</text>
    </svg>
  ),
  entra: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <rect x="4" y="4" width="40" height="40" rx="8" fill="#0284c7" fillOpacity="0.15" stroke="#0284c7" strokeWidth="2" />
      <path d="M24 12l10 12-10 12-10-12z" fill="#0284c7" />
    </svg>
  ),
  commvault: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <rect x="4" y="4" width="40" height="40" rx="8" fill="#e11d48" fillOpacity="0.15" stroke="#e11d48" strokeWidth="2" />
      <path d="M14 24a10 10 0 0117-7M34 24a10 10 0 01-17 7" stroke="#e11d48" strokeWidth="3" strokeLinecap="round" />
    </svg>
  ),
  acronis: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <rect x="4" y="4" width="40" height="40" rx="8" fill="#0f172a" stroke="#0284c7" strokeWidth="2" />
      <circle cx="24" cy="24" r="10" stroke="#38bdf8" strokeWidth="3" />
      <circle cx="24" cy="24" r="3" fill="#ffffff" />
    </svg>
  ),
  servicenow: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <rect x="4" y="4" width="40" height="40" rx="8" fill="#293e40" stroke="#81b5a1" strokeWidth="2" />
      <path d="M16 28c3 4 9 4 12 1 3-3 3-8-1-10-4-2-9-1-11 3" stroke="#81b5a1" strokeWidth="3" strokeLinecap="round" />
    </svg>
  ),
  github: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <rect x="4" y="4" width="40" height="40" rx="8" fill="#181717" />
      <path d="M24 12a12 12 0 00-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6a4.7 4.7 0 011.2-3.3c-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.4 1.3a11.7 11.7 0 016.2 0c2.3-1.6 3.4-1.3 3.4-1.3.7 1.7.3 2.9.1 3.2a4.7 4.7 0 011.2 3.3c0 4.7-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0024 12z" fill="#ffffff" />
    </svg>
  ),
  zoho: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <rect x="4" y="4" width="18" height="18" rx="4" fill="#e11d48" />
      <rect x="26" y="4" width="18" height="18" rx="4" fill="#16a34a" />
      <rect x="4" y="26" width="18" height="18" rx="4" fill="#0284c7" />
      <rect x="26" y="26" width="18" height="18" rx="4" fill="#eab308" />
    </svg>
  ),
};

export default function HomeMark({ name, className = "" }) {
  return <span className={`hp-mark ${className}`}>{MARKS[name] || null}</span>;
}
