import { Link } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import { FaAws, FaMicrosoft, FaGithub } from "react-icons/fa";
import { SiZoho, SiGoogle, SiGooglecloud } from "react-icons/si";
import PrismBg from "../components/PrismBg";
import Logo from "../components/Logo";
import HomeMark from "../components/homepage/HomeIcons";
import ComplianceCommandCenter from "../components/homepage/ComplianceCommandCenter";
import ManagementDashboardMock from "../components/homepage/ManagementDashboardMock";
import { Donut } from "../components/homepage/charts";
import "./Homepage.css";

const CURRENT_YEAR = new Date().getFullYear();

const NAV_LINKS = [
  { label: "Platform", href: "#pillars" },
  { label: "Solutions", href: "#dpdpa" },
  { label: "Frameworks", href: "#frameworks" },
  { label: "Integrations", href: "#integrations" },
  { label: "Pricing", href: "#pricing" },
];

const HERO_CHIPS = [
  { title: "Unified platform", sub: "One source of truth" },
  { title: "Real-time visibility", sub: "People, process & tech" },
  { title: "Audit ready", sub: "Evidence at your fingertips" },
  { title: "Built for India", sub: "DPDP-ready by design" },
];

const FRAMEWORKS = [
  { name: "DPDP Act", kind: "img", src: "/icons/dpdpact.png" },
  { name: "ISO 27001", kind: "img", src: "/icons/iso27001.png" },
  { name: "SOC 2", kind: "mark", mark: "soc2" },
  { name: "PCI DSS", kind: "mark", mark: "pci" },
  { name: "GDPR", kind: "img", src: "/icons/gdpr.svg" },
  { name: "CERT-In", kind: "mark", mark: "certin" },
];

const PILLARS = [
  { title: "Policies & Governance", body: "Create, approve and maintain policies with structured ownership and accountability." },
  { title: "Risk & Resiliency", body: "Identify, assess and treat risks with a continuous resilience mindset." },
  { title: "Identity & People", body: "Manage access, roles and user lifecycle with least privilege and segregation." },
  { title: "Security Architecture", body: "Align technical controls to business objectives and security standards." },
  { title: "Management Review & Audit", body: "Drive management action with insights, evidence and audit readiness." },
];

const FLOW_STEPS = [
  { title: "Define", body: "Set policies, standards and control objectives." },
  { title: "Implement", body: "Roll out controls across people, process and technology." },
  { title: "Monitor", body: "Continuously track control performance and collect evidence." },
  { title: "Assess", body: "Measure risk, validate controls and score readiness." },
  { title: "Act & Improve", body: "Prioritise remediation and close gaps continuously." },
];

const DPDPA_METRICS = [
  { label: "Data mapping", value: 68, status: "In progress" },
  { label: "Consent management", value: 81, status: "On track" },
  { label: "Individual rights", value: 64, status: "Needs work" },
  { label: "Breach management", value: 75, status: "In progress" },
];

const DPDPA_CHECKS = [
  "Lawful use & purpose defined",
  "Data retention configured",
  "Data principal rights enabled",
  "Breach response tested",
];

const DPDP_PENALTIES = [
  { label: "Failure to implement reasonable security safeguards to prevent a breach", amountCrore: 250, amountLabel: "₹250 Cr" },
  { label: "Failure to notify a personal data breach", amountCrore: 200, amountLabel: "₹200 Cr" },
  { label: "Non-compliance by Significant Data Fiduciaries (SDFs)", amountCrore: 150, amountLabel: "₹150 Cr" },
  { label: "Other violations under the Act", amountCrore: 50, amountLabel: "₹50 Cr" },
];
const DPDP_MAX_PENALTY_CRORE = Math.max(...DPDP_PENALTIES.map((p) => p.amountCrore));

const MGMT_HIGHLIGHTS = [
  "Real-time compliance posture and trends",
  "Risk heatmap and control effectiveness",
  "Department-wise readiness and ownership",
  "Audit plan, findings and remediation status",
  "Executive reports in one click",
];

// Real connectors shipped in the app (see api/src/connectors/registry.js).
// Bullets are condensed from each connector's actual evidence checks.
const CONNECTORS = [
  {
    key: "aws",
    name: "AWS",
    Icon: FaAws,
    color: "#FF9900",
    bullets: [
      "IAM users have multi-factor authentication enabled",
      "CloudTrail logging enabled across all regions",
      "S3 buckets block public access",
    ],
  },
  {
    key: "azure",
    name: "Microsoft Azure",
    Icon: FaMicrosoft,
    color: "#0078D4",
    bullets: [
      "Storage accounts block public blob access",
      "Activity Log diagnostics configured",
      "Network security groups don't expose management ports",
    ],
  },
  {
    key: "github",
    name: "GitHub",
    Icon: FaGithub,
    color: "#24292f",
    darkColor: "#e6edf3",
    bullets: [
      "Organization-wide two-factor authentication enforced",
      "Branch protection requires review before merging",
      "Secret scanning enabled",
    ],
  },
  {
    key: "m365",
    name: "Microsoft 365",
    Icon: FaMicrosoft,
    color: "#D83B01",
    bullets: [
      "Mailbox audit logging is enabled",
      "Automatic external mail forwarding is blocked",
      "SharePoint & OneDrive external sharing is restricted",
    ],
  },
  {
    key: "entra",
    name: "Microsoft Entra ID",
    Icon: FaMicrosoft,
    color: "#12A5F4",
    bullets: [
      "Multi-factor authentication is enforced tenant-wide",
      "Conditional Access blocks legacy authentication",
      "Global Administrator assignments are limited and just-in-time",
    ],
  },
  {
    key: "purview",
    name: "Microsoft Purview",
    Icon: FaMicrosoft,
    color: "#8661C5",
    bullets: [
      "Registered data sources have a recent successful scan",
      "Scanned assets have classifications applied",
      "Unified audit logging is enabled",
    ],
  },
  {
    key: "teams",
    name: "Microsoft Teams",
    Icon: FaMicrosoft,
    color: "#6264A7",
    bullets: [
      "External domain federation is restricted",
      "Chat with unmanaged consumer accounts is blocked",
      "Unsanctioned third-party storage is disabled",
    ],
  },
  {
    key: "defender",
    name: "Microsoft Defender",
    Icon: FaMicrosoft,
    color: "#0D6EFD",
    bullets: [
      "Managed devices are onboarded to Defender for Endpoint",
      "Onboarded devices report healthy sensors",
      "Critical exploitable vulnerabilities are remediated within SLA",
    ],
  },
  {
    key: "google_workspace",
    name: "Google Workspace",
    Icon: SiGoogle,
    color: "#4285F4",
    bullets: [
      "2-Step Verification is enforced for all users",
      "Super admin role is limited to a reviewed set",
      "Drive external sharing defaults are restricted",
    ],
  },
  {
    key: "gcp",
    name: "Google Cloud",
    Icon: SiGooglecloud,
    color: "#4285F4",
    bullets: [
      "Project Owner role assignments are limited",
      "Service account keys are rotated regularly",
      "Storage buckets enforce public access prevention",
    ],
  },
  {
    key: "zoho",
    name: "Zoho",
    Icon: SiZoho,
    color: "#E61E25",
    bullets: [
      "Multi-factor authentication is enforced org-wide",
      "Single sign-on is enforced for all apps",
      "Inactive and terminated users are deprovisioned",
    ],
  },
];

function ContactModal({ open, onClose, subject }) {
  const [form, setForm] = useState({ name: "", email: "", company: "", message: "" });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const firstRef = useRef(null);

  useEffect(() => {
    if (open) {
      setForm({ name: "", email: "", company: "", message: "" });
      setSent(false);
      setError("");
      setTimeout(() => firstRef.current?.focus(), 80);
    }
  }, [open]);

  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    if (open) document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) {
      setError("Name and email are required.");
      return;
    }
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, _subject: subject || "PRISM enquiry" }),
      });
      if (res.ok) { setSent(true); }
      else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Could not send message. Please email ab@neozaar.com directly.");
      }
    } catch {
      setError("Could not send message. Please email ab@neozaar.com directly.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="contact-modal-overlay" onClick={onClose}>
      <div className="contact-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Contact PRISM">
        <button className="contact-modal-close" onClick={onClose} aria-label="Close">✕</button>
        {sent ? (
          <div className="contact-modal-success">
            <div className="contact-modal-success-icon">✓</div>
            <h2>Message sent</h2>
            <p>We'll get back to you within one business day.</p>
            <button className="hp-btn hp-btn-primary" onClick={onClose} style={{ marginTop: 24 }}>Done</button>
          </div>
        ) : (
          <>
            <div className="contact-modal-head">
              <h2>Get in touch</h2>
              <p>Tell us a bit about yourself and we'll reach out within one business day.</p>
            </div>
            <form className="contact-modal-form" onSubmit={handleSubmit} noValidate>
              <div className="contact-field-row">
                <div className="contact-field">
                  <label>Name *</label>
                  <input ref={firstRef} type="text" placeholder="Priya Sharma" value={form.name} onChange={set("name")} required />
                </div>
                <div className="contact-field">
                  <label>Work email *</label>
                  <input type="email" placeholder="priya@acme.com" value={form.email} onChange={set("email")} required />
                </div>
              </div>
              <div className="contact-field">
                <label>Company</label>
                <input type="text" placeholder="Acme Corp" value={form.company} onChange={set("company")} />
              </div>
              <div className="contact-field">
                <label>Message</label>
                <textarea placeholder="Tell us about your compliance needs…" rows={4} value={form.message} onChange={set("message")} />
              </div>
              {error && <p className="contact-modal-error">{error}</p>}
              <button type="submit" className="hp-btn hp-btn-primary contact-modal-submit" disabled={sending}>
                {sending ? "Sending…" : "Send message →"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function NewsletterField({ onSubmit }) {
  const [email, setEmail] = useState("");
  return (
    <form
      className="hp-newsletter"
      onSubmit={(e) => { e.preventDefault(); onSubmit(email); }}
    >
      <input
        type="email"
        placeholder="Enter your email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        aria-label="Email address"
      />
      <button type="submit" aria-label="Subscribe">→</button>
    </form>
  );
}

function ConnectorMarquee({ items, dark, variant = "chip", reverse = false, speed = 60 }) {
  const loop = [...items, ...items];
  return (
    <div className={`hp-marquee hp-marquee-${variant}`} aria-label="Supported connectors">
      <div
        className={`hp-marquee-track${reverse ? " hp-marquee-reverse" : ""}`}
        style={{ animationDuration: `${speed}s` }}
      >
        {loop.map((c, i) => {
          const hidden = i >= items.length;
          const icon = <c.Icon size={variant === "card" ? 24 : 22} color={dark && c.darkColor ? c.darkColor : c.color} />;
          if (variant === "card") {
            return (
              <div className="hp-connector-card" key={i} aria-hidden={hidden}>
                <div className="hp-connector-head">
                  <span className="hp-connector-icon">{icon}</span>
                  <div>
                    <h4>{c.name}</h4>
                    <p>Live connector</p>
                  </div>
                </div>
                <ul>
                  {c.bullets.map((b, bi) => <li key={bi}>{b}</li>)}
                </ul>
              </div>
            );
          }
          return (
            <div className="hp-connector-chip" key={i} aria-hidden={hidden}>
              <span className="hp-connector-icon">{icon}</span>
              <div>
                <h4>{c.name}</h4>
                <p>Live connector</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Homepage() {
  const [dark, setDark] = useState(() => localStorage.getItem("theme") === "dark");
  const [contactOpen, setContactOpen] = useState(false);
  const [contactSubject, setContactSubject] = useState("PRISM enquiry");

  const openContact = (subject = "PRISM enquiry") => {
    setContactSubject(subject);
    setContactOpen(true);
  };

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  return (
    <div className="hp">
      {/* HEADER */}
      <header className="hp-header">
        <div className="hp-header-inner">
          <div className="hp-logo-wrap">
            <Logo className="hp-logo-img" />
          </div>
          <nav className="hp-nav">
            <div className="hp-nav-menu">
              {NAV_LINKS.map((l) => (
                <a key={l.label} href={l.href} className="hp-nav-link">{l.label}</a>
              ))}
            </div>
            <button className="hp-toggle" onClick={() => setDark(!dark)} aria-label="Toggle theme">
              <span className={`hp-toggle-knob ${dark ? "active" : ""}`} />
            </button>
            <Link to="/login" className="hp-nav-signin">Sign In</Link>
            <button className="hp-cta-btn" onClick={() => openContact("Request a demo")}>Request a Demo</button>
          </nav>
        </div>
      </header>

      {/* HERO */}
      <section className="hp-hero" id="hero">
        <PrismBg
          animationType="hover"
          height={3.4}
          baseWidth={5.0}
          glow={0.5}
          bloom={0.5}
          noise={0.15}
          scale={3.4}
          hueShift={0}
          colorFrequency={1.1}
          hoverStrength={1.0}
          inertia={0.05}
          timeScale={0.28}
          offset={{ x: 0, y: -120 }}
          transparent
          suspendWhenOffscreen
        />
        <div className="hp-hero-inner">
          <div className="hp-hero-copy">
            <h1 className="hp-hero-title">
              One platform.<br />
              <span className="hp-hero-accent">Every control.</span><br />
              Continuous compliance.
            </h1>
            <p className="hp-hero-sub">
              PRISM unifies governance, risk, security and compliance so your organisation
              stays secure, audit-ready and future-prepared.
            </p>
            <div className="hp-hero-ctas">
              <button className="hp-btn hp-btn-primary" onClick={() => openContact("Request a demo")}>Request a Demo →</button>
              <Link to="/register" className="hp-btn hp-btn-secondary">Start Your Compliance Assessment →</Link>
            </div>
            <div className="hp-chips">
              {HERO_CHIPS.map((c) => (
                <div key={c.title} className="hp-chip">
                  <strong>{c.title}</strong>
                  <span>{c.sub}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="hp-hero-mock">
            <ComplianceCommandCenter />
          </div>
        </div>
      </section>

      {/* FRAMEWORK STRIP */}
      <section className="hp-strip" id="frameworks">
        <p className="hp-strip-caption">Built to help you comply with global and India-specific frameworks</p>
        <div className="hp-logos-strip">
          {FRAMEWORKS.map((f) => (
            <div key={f.name} className="hp-logo-mark">
              {f.kind === "img"
                ? <img src={f.src} alt="" />
                : <HomeMark name={f.mark} />}
              <span>{f.name}</span>
            </div>
          ))}
        </div>
      </section>

      {/* FIVE PILLARS */}
      <section className="hp-section" id="pillars">
        <div className="hp-container">
          <h2 className="hp-section-title">The five pillars of PRISM</h2>
          <p className="hp-section-sub">
            One connected programme across policies, risk, people, technology and management action.
          </p>
          <div className="hp-pillars-grid">
            {PILLARS.map((p, i) => (
              <div key={p.title} className="hp-pillar-card">
                <span className="hp-pillar-index">{String(i + 1).padStart(2, "0")}</span>
                <h3>{p.title}</h3>
                <p>{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CONNECTED END TO END */}
      <section className="hp-section hp-flow-section">
        <div className="hp-container">
          <h2 className="hp-section-title">Connected. End to end.</h2>
          <p className="hp-section-sub">
            PRISM links policies, departments, technology controls, evidence and management
            action in one continuous loop.
          </p>
          <ol className="hp-flow">
            {FLOW_STEPS.map((s, i) => (
              <li key={s.title} className="hp-flow-step">
                <span className="hp-flow-num">{i + 1}</span>
                <h4>{s.title}</h4>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* DPDPA READINESS */}
      <section className="hp-section hp-dpdpa-section" id="dpdpa">
        <div className="hp-container">
          <div className="hp-dpdpa">
            <div className="hp-dpdpa-lead">
              <h2 className="hp-section-title hp-align-left">DPDPA readiness, built for India</h2>
              <p className="hp-section-sub hp-align-left">
                PRISM helps you operationalise privacy by design and meet data fiduciary
                obligations under the Digital Personal Data Protection Act.
              </p>
              <Donut value={72} size={150} caption="Moderate" color="var(--amber)" />
              <Link to="/assess/dpdp" className="hp-btn hp-btn-primary">
                Assess your DPDPA compliance →
              </Link>
            </div>
            <div className="hp-dpdpa-right">
              <div className="hp-dpdpa-metrics">
                {DPDPA_METRICS.map((m) => (
                  <div key={m.label} className="hp-metric-card">
                    <span className="hp-metric-value">{m.value}%</span>
                    <span className="hp-metric-label">{m.label}</span>
                    <span className="hp-metric-status">{m.status}</span>
                  </div>
                ))}
              </div>
              <ul className="hp-checklist">
                {DPDPA_CHECKS.map((c) => (
                  <li key={c}><span className="hp-check-tick">✓</span>{c}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* COST OF NON-COMPLIANCE */}
      <section className="hp-section hp-penalties-section" id="penalties">
        <div className="hp-container">
          <h2 className="hp-section-title">The cost of getting it wrong</h2>
          <p className="hp-section-sub">
            The DPDP Act 2023 empowers the Data Protection Board of India to levy penalties
            per instance of non-compliance — here's what's at stake.
          </p>
          <div className="hp-penalty-list">
            {DPDP_PENALTIES.map((p, i) => {
              const pct = (p.amountCrore / DPDP_MAX_PENALTY_CRORE) * 100;
              return (
                <div key={i} className="hp-penalty-row">
                  <div className="hp-penalty-row-head">
                    <span className="hp-penalty-label">{p.label}</span>
                    <span className="hp-penalty-amount">Up to {p.amountLabel}</span>
                  </div>
                  <div className="hp-penalty-bar-track">
                    <div className="hp-penalty-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="hp-penalty-cta">
            <Link to="/assess/dpdp" className="hp-btn hp-btn-primary">Assess your DPDPA exposure →</Link>
          </div>
        </div>
      </section>

      {/* INTEGRATIONS */}
      <section className="hp-section hp-integrations-section" id="integrations">
        <div className="hp-container">
          <h2 className="hp-section-title">Seamless integrations</h2>
          <p className="hp-section-sub">
            Connect PRISM with the ecosystem you already run for a unified compliance picture.
          </p>
          <ConnectorMarquee items={CONNECTORS} dark={dark} />

          <h3 className="hp-subhead">Where PRISM pulls its evidence</h3>
          <p className="hp-section-sub">
            Live connectors continuously collect evidence so your team isn't screenshotting
            consoles before every audit.
          </p>
          <ConnectorMarquee items={CONNECTORS} dark={dark} variant="card" speed={90} />
        </div>
      </section>

      {/* MANAGEMENT DASHBOARD */}
      <section className="hp-section hp-mgmt-section">
        <div className="hp-container">
          <div className="hp-mgmt">
            <div className="hp-mgmt-lead">
              <h2 className="hp-section-title hp-align-left">Management dashboard at a glance</h2>
              <ul className="hp-mgmt-highlights">
                {MGMT_HIGHLIGHTS.map((h) => (
                  <li key={h}><span className="hp-check-tick">✓</span>{h}</li>
                ))}
              </ul>
              <button className="hp-btn hp-btn-primary" onClick={() => openContact("Request a demo")}>Request a Demo →</button>
            </div>
            <ManagementDashboardMock />
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className="hp-section hp-pricing-section" id="pricing">
        <div className="hp-container">
          <h2 className="hp-section-title">Simple, transparent pricing</h2>
          <p className="hp-section-sub">Choose the plan that fits your compliance journey.</p>
          <div className="hp-pricing-row">
            <div className="hp-pricing-card">
              <div className="hp-pricing-tag">Best for startups</div>
              <h3>PRISM Lite</h3>
              <div className="hp-pricing-price">₹8,000<span>/user/mo</span></div>
              <ul className="hp-pricing-features">
                <li>Single framework assessment</li>
                <li>Minimum 5 users</li>
                <li>Evidence upload</li>
                <li>Basic dashboard</li>
                <li>10 hours of guided support</li>
              </ul>
              <button className="hp-btn hp-btn-primary" onClick={() => openContact("Get started — PRISM Lite")}>Start free trial</button>
            </div>
            <div className="hp-pricing-card hp-pricing-featured">
              <div className="hp-pricing-tag">Most popular</div>
              <h3>Professional</h3>
              <div className="hp-pricing-price">₹15,000<span>/user/mo</span></div>
              <ul className="hp-pricing-features">
                <li>Any 3 frameworks</li>
                <li>Unlimited roles & permissions</li>
                <li>Advanced reporting</li>
                <li>AI-assisted gap analysis</li>
                <li>30 hours of priority support</li>
              </ul>
              <button className="hp-btn hp-btn-secondary" onClick={() => openContact("Get started — Professional")}>Get started</button>
            </div>
            <div className="hp-pricing-card">
              <div className="hp-pricing-tag">Best for enterprises</div>
              <h3>Enterprise</h3>
              <div className="hp-pricing-price">Custom</div>
              <ul className="hp-pricing-features">
                <li>Everything in Professional</li>
                <li>Dedicated account manager</li>
                <li>Custom integrations</li>
                <li>SLA guarantees</li>
                <li>On-premise option</li>
                <li>Training & onboarding</li>
              </ul>
              <button className="hp-btn hp-btn-secondary" onClick={() => openContact("Enterprise — contact sales")}>Contact sales</button>
            </div>
          </div>
        </div>
      </section>

      {/* WHY PRISM */}
      <section className="hp-section hp-why-section" id="why">
        <div className="hp-container">
          <div className="hp-why-head">
            <h2 className="hp-section-title hp-align-left">Why PRISM?</h2>
            <p className="hp-section-sub hp-align-left">
              Most compliance tools are built for auditors. PRISM is built for the teams
              who actually do the work.
            </p>
          </div>
          <div className="hp-why-compare">
            <div className="hp-why-col hp-why-col-bad">
              <div className="hp-why-col-header">
                <img src="/icons/cross-circle.svg" alt="" />
                <h3>The old way</h3>
              </div>
              <ul>
                <li>Spreadsheets emailed back and forth</li>
                <li>No one knows who owns which control</li>
                <li>Evidence buried in shared drives and inboxes</li>
                <li>Compliance happens only before an audit</li>
                <li>Gap reports that sit unread in a folder</li>
                <li>Consultants charge ₹15L to tell you what's missing</li>
              </ul>
            </div>
            <div className="hp-why-col hp-why-col-good">
              <div className="hp-why-col-header">
                <img src="/icons/check-circle.svg" alt="" />
                <h3>The PRISM way</h3>
              </div>
              <ul>
                <li>Single workspace — every control, every owner, every month</li>
                <li>Assigned ownership with due dates and reminders</li>
                <li>Evidence attached to the exact control it supports</li>
                <li>Continuous maturity scoring — always audit-ready</li>
                <li>Actionable gap reports with remediation priorities</li>
                <li>Your team runs it — consultants review it</li>
              </ul>
            </div>
          </div>
          <div className="hp-why-stats">
            {[
              { stat: "5 min", label: "to your first compliance score" },
              { stat: "Multiple frameworks", label: "DPDP · ISO 27001 · GDPR & more in one place" },
              { stat: "150+", label: "controls tracked per assessment" },
              { stat: "Always", label: "audit-ready, not just at renewal" },
            ].map((s) => (
              <div key={s.stat} className="hp-why-stat">
                <div className="hp-why-stat-num">{s.stat}</div>
                <div className="hp-why-stat-label">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ABOUT */}
      <section className="hp-section hp-about-section" id="about">
        <div className="hp-container">
          <div className="hp-why-head">
            <h2 className="hp-section-title hp-align-left">About PRISM</h2>
            <p className="hp-section-sub hp-align-left">
              We built the tool we wished existed when we were doing compliance ourselves.
            </p>
          </div>
          <div className="hp-about-layout">
            <div className="hp-about-story">
              <span className="hp-eyebrow">Our story</span>
              <p>
                PRISM was born out of frustration. Every compliance programme we worked on ran
                into the same problems — questions buried in spreadsheets, evidence scattered
                across drives, and a scramble every time an auditor asked for something.
              </p>
              <p>
                We built PRISM to work the way compliance teams do — structured enough to
                satisfy auditors, practical enough for everyday use by the people who own the
                controls. We started with India's DPDP Act because we believed it deserved a
                purpose-built tool, not an afterthought bolt-on.
              </p>
              <p className="hp-about-byline">
                Developed by <strong>Neozaar</strong> — governance, risk and compliance
                tooling for Indian and global organisations.
              </p>
            </div>
            <div className="hp-about-values">
              {[
                { title: "Practitioners first", body: "Every feature is designed by people who have sat in the CISO chair, written policies and faced auditors." },
                { title: "Transparency", body: "No black-box scoring. Every maturity level and calculation is visible and explainable." },
                { title: "Indian regulatory depth", body: "DPDP Act 2023 isn't a checkbox we added — it's where we started, and we track rule-making as it evolves." },
                { title: "Built to last", body: "Compliance is a programme, not a project. PRISM is built for teams who manage it year-round." },
              ].map((v) => (
                <div key={v.title} className="hp-about-value-card">
                  <h4>{v.title}</h4>
                  <p>{v.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="hp-final-cta-section">
        <div className="hp-final-cta-overlay" />
        <div className="hp-final-cta-content">
          <h2>One platform. Every control. Continuous compliance.</h2>
          <p>Make compliance a strategic advantage.</p>
          <div className="hp-final-cta-btns">
            <button className="hp-btn hp-btn-primary hp-final-btn" onClick={() => openContact("Request a demo")}>Request a Demo →</button>
            <Link to="/register" className="hp-btn hp-btn-secondary hp-final-btn">Start Your Compliance Assessment →</Link>
          </div>
        </div>
      </section>

      <ContactModal open={contactOpen} onClose={() => setContactOpen(false)} subject={contactSubject} />

      {/* FOOTER */}
      <footer className="hp-footer">
        <div className="hp-footer-inner">
          <div className="hp-footer-grid">
            <div className="hp-footer-brand">
              <div className="hp-footer-logo"><Logo /></div>
              <p>The unified governance, risk, security and compliance platform for modern enterprises.</p>
            </div>
            <div className="hp-footer-col">
              <h4>Platform</h4>
              <a href="#pillars">Overview</a>
              <a href="#integrations">Integrations</a>
              <a href="#pricing">Pricing</a>
            </div>
            <div className="hp-footer-col">
              <h4>Solutions</h4>
              <a href="#dpdpa">DPDPA readiness</a>
              <a href="#frameworks">Frameworks</a>
              <a href="#why">Why PRISM</a>
            </div>
            <div className="hp-footer-col">
              <h4>Resources</h4>
              <Link to="/support">Support</Link>
              <a href="#about">About us</a>
              <a href="#penalties">DPDP penalties</a>
            </div>
            <div className="hp-footer-col hp-footer-subscribe">
              <h4>Stay updated</h4>
              <p>Compliance and governance insights, occasionally.</p>
              <NewsletterField onSubmit={() => openContact("Newsletter signup")} />
            </div>
          </div>
          <div className="hp-footer-bottom">
            <p>&copy; {CURRENT_YEAR} PRISM. All rights reserved.</p>
            <div className="hp-footer-legal">
              <Link to="/privacy-policy">Privacy Policy</Link>
              <Link to="/terms-of-service">Terms of Service</Link>
              <a href="#" onClick={(e) => { e.preventDefault(); window.dispatchEvent(new Event("open-cookie-banner")); }}>Cookie Settings</a>
              <span className="hp-locale-chip">🇮🇳 India</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
