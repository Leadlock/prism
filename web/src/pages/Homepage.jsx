import { Link } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import { FaAws, FaMicrosoft, FaGithub } from "react-icons/fa";
import PrismBg from "../components/PrismBg";
import Logo from "../components/Logo";

const CURRENT_YEAR = new Date().getFullYear();

const DPDP_PENALTIES = [
  { label: "Failure to implement reasonable security safeguards to prevent a breach", amountCrore: 250, amountLabel: "₹250 Cr" },
  { label: "Failure to notify a personal data breach", amountCrore: 200, amountLabel: "₹200 Cr" },
  { label: "Non-compliance by Significant Data Fiduciaries (SDFs)", amountCrore: 150, amountLabel: "₹150 Cr" },
  { label: "Other violations under the Act", amountCrore: 50, amountLabel: "₹50 Cr" },
];
const DPDP_MAX_PENALTY_CRORE = Math.max(...DPDP_PENALTIES.map(p => p.amountCrore));

const CONNECTORS = [
  {
    key: "aws",
    name: "AWS",
    Icon: FaAws,
    color: "#FF9900",
    tagline: "Live connector",
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
    tagline: "Live connector",
    bullets: [
      "Storage accounts block public blob access",
      "Activity Log diagnostics configured",
      "Network security groups don't expose management ports publicly",
    ],
  },
  {
    key: "github",
    name: "GitHub",
    Icon: FaGithub,
    color: "#181717",
    darkColor: "#f0f6fc",
    tagline: "Live connector",
    bullets: [
      "Organization-wide two-factor authentication enforced",
      "Branch protection requires review before merging",
      "Secret scanning enabled",
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

  const set = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));

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
      <div className="contact-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Contact PRISM">
        <button className="contact-modal-close" onClick={onClose} aria-label="Close">✕</button>
        {sent ? (
          <div className="contact-modal-success">
            <div className="contact-modal-success-icon">✓</div>
            <h2>Message sent!</h2>
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
            <a href="#why" className="hp-nav-link">Why PRISM</a>
            <a href="#about" className="hp-nav-link">About Us</a>
            <Link to="/register" className="hp-nav-cta">Test Your Compliance</Link>
            <button className="hp-toggle" onClick={() => setDark(!dark)} aria-label="Toggle theme">
              <span className={`hp-toggle-knob ${dark ? "active" : ""}`} />
            </button>
            <Link to="/login" className="hp-cta-btn">Sign In</Link>
          </nav>
        </div>
      </header>

      {/* SECTION 1 — Hero */}
      <section className="hp-section hp-hero" id="hero">
        <PrismBg
          animationType="hover"
          height={4.0}
          baseWidth={5.0}
          glow={1.0}
          bloom={1.0}
          noise={0.2}
          scale={2.8}
          hueShift={0}
          colorFrequency={1.3}
          hoverStrength={1.8}
          inertia={0.04}
          timeScale={0.4}
          offset={{ x: 0, y: -80 }}
          transparent={true}
          suspendWhenOffscreen={true}
        />
        <div className="hp-hero-content">
          <h1 className="hp-hero-title">Know your score. Fix your gaps.<br />Prove your readiness.</h1>
          <p className="hp-hero-sub">PRISM is your compliance readiness workspace — structured, measurable, and always audit-ready.</p>
          <div className="hp-hero-ctas">
            <button className="hp-btn hp-btn-primary" onClick={() => openContact("Start Compliance Assessment")}>Start Your Compliance Assessment</button>
            <button className="hp-btn hp-btn-secondary" onClick={() => openContact("Schedule a PRISM Walkthrough")}>Schedule a PRISM Walkthrough</button>
          </div>
        </div>
      </section>

      {/* SECTION — Cost of Non-Compliance (DPDPA penalties) */}
      <section className="hp-section hp-penalties-section" id="penalties">
        <div className="hp-container">
          <h2 className="hp-section-title">The Cost of Getting It Wrong</h2>
          <p className="hp-section-sub">
            The DPDP Act 2023 empowers the Data Protection Board of India to levy penalties per instance of non-compliance — here's what's at stake.
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
            <button className="hp-btn hp-btn-primary" onClick={() => openContact("Assess DPDP Exposure")}>Assess Your DPDP Exposure</button>
          </div>
        </div>
      </section>

      {/* SECTION 2 — Platform Overview */}
      <section className="hp-section hp-platform-section" id="platform">
        <div className="hp-container">
          <h2 className="hp-section-title">One structured place for everything compliance</h2>
          <p className="hp-section-sub">Maintain policies, documents, screenshots, approvals and implementation records in one structured place.</p>
          <div className="hp-cards-row">
            <div className="hp-card">
              <div className="hp-card-icon"><img src="/icons/organize.svg" alt="Organize" /></div>
              <h3>Organize</h3>
              <p>Centralize all compliance artifacts — policies, evidence, screenshots, and approvals — in a single workspace.</p>
            </div>
            <div className="hp-card">
              <div className="hp-card-icon"><img src="/icons/report.svg" alt="Report" /></div>
              <h3>Report</h3>
              <p>Generate a clear view of readiness for management, customers, auditors and internal governance teams.</p>
            </div>
            <div className="hp-card">
              <div className="hp-card-icon"><img src="/icons/track.svg" alt="Track" /></div>
              <h3>Track</h3>
              <p>Monitor progress continuously with maturity scoring, gap identification, and action tracking.</p>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 3 — Framework Readiness (merged with One Platform, Multiple Journeys) */}
      <section className="hp-section hp-frameworks-section">
        <div className="hp-container">
          <h2 className="hp-section-title">One Platform, Multiple Journeys</h2>
          <p className="hp-section-sub">Start with one framework. Expand as your compliance program grows. Structured assessments across every obligation.</p>
          <div className="hp-fw-grid">
            {/* DPDP */}
            <div className="hp-fw-card hp-fw-dpdp">
              <div className="hp-fw-card-header">
                <img src="/icons/dpdpact.png" alt="DPDP" className="hp-fw-icon-img" />
                <div>
                  <h3>DPDP Act 2023</h3>
                  <p className="hp-fw-tagline">India's Digital Personal Data Protection</p>
                </div>
              </div>
              <ul className="hp-fw-list">
                <li>Personal data discovery & mapping</li>
                <li>Consent readiness assessment</li>
                <li>Data principal rights workflows</li>
                <li>Vendor & processor accountability</li>
                <li>Breach response preparedness</li>
                <li>Retention & deletion controls</li>
                <li>Governance & evidence tracking</li>
              </ul>
              <Link to="/assess/dpdp" className="hp-btn hp-btn-primary hp-fw-btn">Assess DPDP Readiness</Link>
            </div>

            {/* ISO 27001 */}
            <div className="hp-fw-card hp-fw-iso">
              <div className="hp-fw-card-header">
                <img src="/icons/iso27001.png" alt="ISO 27001" className="hp-fw-icon-img" />
                <div>
                  <h3>ISO 27001</h3>
                  <p className="hp-fw-tagline">International Information Security Standard</p>
                </div>
              </div>
              <ul className="hp-fw-list">
                <li>Control-wise self-assessment</li>
                <li>Annex A mapping & gap analysis</li>
                <li>Policy review & documentation</li>
                <li>Risk & asset governance</li>
                <li>Evidence management & upload</li>
                <li>Audit preparation workspace</li>
                <li>Corrective action tracking</li>
              </ul>
              <Link to="/assess/iso27001" className="hp-btn hp-btn-primary hp-fw-btn">Start ISO 27001 Assessment</Link>
            </div>

            {/* GDPR */}
            <div className="hp-fw-card hp-fw-gdpr">
              <div className="hp-fw-card-header">
                <img src="/icons/gdpr.svg" alt="GDPR" className="hp-fw-icon-img" />
                <div>
                  <h3>GDPR</h3>
                  <p className="hp-fw-tagline">EU General Data Protection Regulation</p>
                </div>
              </div>
              <ul className="hp-fw-list">
                <li>Data processing inventory & lawful basis</li>
                <li>Data subject rights management</li>
                <li>Privacy impact assessments (DPIA)</li>
                <li>Cross-border transfer safeguards</li>
                <li>Consent management & records</li>
                <li>Data breach notification readiness</li>
                <li>DPO governance & accountability</li>
              </ul>
              <Link to="/assess/gdpr" className="hp-btn hp-btn-primary hp-fw-btn">Assess GDPR Readiness</Link>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION — Integrations / evidence sources */}
      <section className="hp-section hp-integrations-section" id="integrations">
        <div className="hp-container">
          <h2 className="hp-section-title">Where PRISM Pulls Its Evidence</h2>
          <p className="hp-section-sub">
            Connect the systems you already run. PRISM continuously pulls evidence so your team isn't screenshotting consoles before every audit.
          </p>
          <div className="hp-fw-grid hp-integrations-grid">
            {CONNECTORS.map((c) => (
              <div key={c.key} className="hp-fw-card hp-integration-card">
                <div className="hp-fw-card-header">
                  <div className="hp-integration-icon">
                    <c.Icon size={26} color={dark && c.darkColor ? c.darkColor : c.color} />
                  </div>
                  <div>
                    <h3>{c.name}</h3>
                    <p className="hp-fw-tagline">{c.tagline}</p>
                  </div>
                </div>
                <ul className="hp-fw-list">
                  {c.bullets.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </div>
            ))}

            <div className="hp-fw-card hp-integration-card hp-integration-teaser">
              <div className="hp-fw-card-header">
                <div className="hp-integration-icon hp-integration-icon-teaser">+</div>
                <div>
                  <h3>More on the way</h3>
                  <p className="hp-fw-tagline">New connectors added regularly</p>
                </div>
              </div>
              <p className="hp-integration-teaser-text">
                We're continuously expanding coverage across cloud, identity, and DevOps tooling.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 5 — Designed for Every Owner */}
      <section className="hp-section hp-roles-section">
        <div className="hp-container">
          <h2 className="hp-section-title">Designed for Every Owner of Compliance</h2>
          <p className="hp-section-sub">PRISM gives every stakeholder clarity on their compliance responsibilities.</p>
          <div className="hp-roles-grid">
            {[
              { role: "Leadership", desc: "Board-level readiness visibility and risk posture" },
              { role: "CISO", desc: "Security control status and gap prioritization" },
              { role: "DPO", desc: "Data protection compliance tracking and evidence" },
              { role: "GRC Team", desc: "Cross-framework governance and audit coordination" },
              { role: "IT Head", desc: "Technical control implementation and monitoring" },
              { role: "HR Head", desc: "People-related policy compliance and training records" },
              { role: "Legal", desc: "Regulatory obligation mapping and contract compliance" },
              { role: "Department Owners", desc: "Department-level control ownership and action items" },
            ].map((r, i) => (
              <div key={i} className="hp-role-card">
                <h4>{r.role}</h4>
                <p>{r.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 8 — Compliance Score Is Only the Beginning */}
      <section className="hp-section hp-score-section">
        <div className="hp-container">
          <h2 className="hp-section-title">Your Compliance Score Is Only the Beginning</h2>
          <p className="hp-section-sub">PRISM goes beyond a number — actionable intelligence for continuous improvement.</p>
          <div className="hp-insights-list">
            {[
              "Fully implemented vs. partially implemented controls",
              "Missing evidence and documentation gaps",
              "Teams and departments needing to act",
              "Priority actions ranked by risk impact",
              "Readiness trend tracking over time",
            ].map((item, i) => (
              <div key={i} className="hp-insight-item">
                <span className="hp-insight-num">{i + 1}</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 9 — Pricing */}
      <section className="hp-section hp-pricing-section" id="pricing">
        <div className="hp-container">
          <h2 className="hp-section-title">Simple, Transparent Pricing</h2>
          <p className="hp-section-sub">Choose the plan that fits your compliance journey.</p>
          <div className="hp-pricing-row">
            <div className="hp-pricing-card">
              <div className="hp-pricing-tag">Best for startups</div>
              <h3>PRISM Lite</h3>
              <div className="hp-pricing-price">₹8,000<span className="hp-pricing-period">/user/mo</span></div>
              <ul className="hp-pricing-features">
                <li>Single framework assessment</li>
                <li>Minimum 5 users</li>
                <li>Evidence upload</li>
                <li>Basic dashboard</li>
                <li>10 hours of Guided Support</li>
              </ul>
              <button className="hp-btn hp-btn-primary" onClick={() => openContact("Get Started — PRISM Lite")}>Start Free Trial</button>
            </div>
            <div className="hp-pricing-card hp-pricing-featured">
              <div className="hp-pricing-tag">Most popular</div>
              <h3>Professional</h3>
              <div className="hp-pricing-price">₹15,000<span>/user/mo</span></div>
              <ul className="hp-pricing-features">
                <li>All frameworks (DPDP, ISO, GDPR)</li>
                <li>Unlimited roles & permissions</li>
                <li>Advanced reporting</li>
                <li>AI Assisted Gap Analysis</li>
                <li>30 Hours of Priority Support</li>
              </ul>
              <button className="hp-btn hp-btn-secondary" onClick={() => openContact("Get Started — Professional")}>Get Started</button>
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
              <button className="hp-btn hp-btn-secondary" onClick={() => openContact("Enterprise — Contact Sales")}>Contact Sales</button>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION — Why PRISM */}
      <section className="hp-section hp-why-section" id="why">
        <div className="hp-container">
          <div style={{ marginBottom: 48 }}>
            <h2 className="hp-section-title" style={{ textAlign: "left" }}>Why PRISM?</h2>
            <p className="hp-section-sub" style={{ textAlign: "left" }}>Most compliance tools are built for auditors. PRISM is built for the teams who actually do the work.</p>
          </div>

          <div className="hp-why-compare">
            <div className="hp-why-col hp-why-col-bad">
              <div className="hp-why-col-header">
                <img src="/icons/cross-circle.svg" alt="" className="hp-why-col-icon-img" />
                <h3>The old way</h3>
              </div>
              <ul className="hp-why-list">
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
                <img src="/icons/check-circle.svg" alt="" className="hp-why-col-icon-img" />
                <h3>The PRISM way</h3>
              </div>
              <ul className="hp-why-list">
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
              { stat: "5 min", label: "to get your first compliance score" },
              { stat: "3 frameworks", label: "DPDP · ISO 27001 · GDPR in one place" },
              { stat: "150+", label: "controls tracked per assessment" },
              { stat: "Always", label: "audit-ready, not just at renewal" },
            ].map((s, i) => (
              <div key={i} className="hp-why-stat">
                <div className="hp-why-stat-num">{s.stat}</div>
                <div className="hp-why-stat-label">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION — About Us */}
      <section className="hp-section hp-about-section" id="about">
        <div className="hp-container">
          <div style={{ marginBottom: 48 }}>
            <h2 className="hp-section-title" style={{ textAlign: "left" }}>About PRISM</h2>
            <p className="hp-section-sub" style={{ textAlign: "left" }}>We built the tool we wished existed when we were doing compliance ourselves.</p>
          </div>

          <div className="hp-about-layout">
            <div className="hp-about-story">
              <h3>Our story</h3>
              <p>
                PRISM was born out of frustration. Every compliance programme we worked on ran into the same problems — questions buried in spreadsheets, evidence scattered across drives, and a scramble every time an auditor asked for something. The tools available were either overpriced enterprise platforms or barebones checklists that required a consultant to interpret.
              </p>
              <p>
                We built PRISM to be the compliance platform that actually works the way compliance teams do — structured enough to satisfy auditors, practical enough for every-day use by the people who own the controls.
              </p>
              <p>
                PRISM is developed by <strong>Neozaar</strong>, a technology company focused on governance, risk, and compliance tooling for Indian and global organisations. We started with a focus on India's DPDP Act because we believed it deserved a purpose-built tool — not an afterthought bolt-on.
              </p>
            </div>
            <div className="hp-about-values">
              {[
                { icon: "◎", title: "Practitioners first", body: "Every feature is designed by people who have sat in the CISO chair, written policies, and faced auditors. We don't build features we wouldn't use ourselves." },
                { icon: "◈", title: "Transparency", body: "No black-box scoring. Every maturity level, every control weight, every calculation is visible and explainable to your team and your auditors." },
                { icon: "◆", title: "Indian regulatory depth", body: "DPDP Act 2023 compliance isn't a checkbox we added. It's where we started. We track rule-making updates and adapt the platform as the regulatory picture evolves." },
                { icon: "▣", title: "Built to last", body: "Compliance is a programme, not a project. PRISM is designed for teams who manage compliance year-round, not just in the weeks before an audit." },
              ].map((v, i) => (
                <div key={i} className="hp-about-value-card">
                  <div className="hp-about-value-icon">{v.icon}</div>
                  <div>
                    <h4>{v.title}</h4>
                    <p>{v.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="hp-about-contact">
            <div className="hp-about-contact-inner">
              <h3>Get in touch</h3>
              <p>Questions about PRISM, partnership opportunities, or enterprise pricing? We respond within one business day.</p>
              <div className="hp-about-contact-links">
                <button className="hp-btn hp-btn-primary" onClick={() => openContact("Email enquiry")}>Email us →</button>
                <button className="hp-btn hp-btn-secondary" onClick={() => openContact("Start free")}>Start free →</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 12 — Final CTA */}
      {/* SECTION — Final CTA */}
      <section className="hp-final-cta-section">
        <div className="hp-final-cta-overlay"></div>
        <div className="hp-final-cta-content">
          <h2>Get audit-ready before the audit begins.</h2>
          <p>Stop scrambling. Start measuring. Be always prepared.</p>
          <div className="hp-final-cta-btns">
            <button className="hp-btn hp-btn-primary hp-final-btn" onClick={() => openContact("Start Compliance Assessment")}>Start Your Compliance Assessment</button>
            <button className="hp-btn hp-btn-secondary hp-final-btn" onClick={() => openContact("Schedule a PRISM Walkthrough")}>Schedule a PRISM Walkthrough</button>
          </div>
        </div>
      </section>

      <ContactModal open={contactOpen} onClose={() => setContactOpen(false)} subject={contactSubject} />

      {/* FOOTER */}
      <footer className="hp-footer">
        <div className="hp-footer-inner">
          <div className="hp-footer-grid">
            <div className="hp-footer-brand">
              <div style={{ height: 56, overflow: "hidden", display: "flex", alignItems: "center", marginBottom: 12 }}>
                <Logo style={{ height: 80, display: "block", transform: "scale(0.85)", transformOrigin: "center center" }} />
              </div>
              <p>Your compliance readiness workspace.</p>
              <p className="hp-footer-tagline">Make compliance measurable, manageable and continuous.</p>
            </div>
            <div className="hp-footer-col">
              <h4>Product</h4>
              <a href="#platform">Platform</a>
              <a href="#pricing">Pricing</a>
              <a href="#why">Why PRISM</a>
            </div>
            <div className="hp-footer-col">
              <h4>Company</h4>
              <a href="#">About</a>
              <a href="#">Careers</a>
              <a href="#">Contact</a>
            </div>
            <div className="hp-footer-col">
              <h4>Resources</h4>
              <a href="#">Documentation</a>
              <a href="#">Blog</a>
              <Link to="/support">Support</Link>
            </div>
            <div className="hp-footer-col">
              <h4>Legal</h4>
              <Link to="/privacy-policy">Privacy Policy</Link>
              <Link to="/terms-of-service">Terms of Service</Link>
              <a href="#" onClick={(e) => { e.preventDefault(); window.dispatchEvent(new Event("open-cookie-banner")); }}>Cookie Settings</a>
            </div>
          </div>
          <div className="hp-footer-bottom">
            <p>&copy; {CURRENT_YEAR} PRISM. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
