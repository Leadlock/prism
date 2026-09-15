import { Link } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import {
  FiSearch,
  FiChevronDown,
  FiCheckCircle,
  FiShield,
  FiFileText,
  FiLink,
  FiMonitor,
  FiEye,
  FiZap,
  FiTrendingUp,
  FiTarget,
  FiArrowRight,
  FiCpu,
  FiAlertTriangle,
  FiTool,
  FiCheckSquare,
  FiUsers,
  FiCloud,
  FiBarChart2,
  FiLayers,
  FiMenu,
  FiX,
} from "react-icons/fi";
import { FaLinkedin } from "react-icons/fa";
import PrismBg from "../components/PrismBg";
import Logo from "../components/Logo";
import HomeMark from "../components/homepage/HomeIcons";
import ComplianceCommandCenter from "../components/homepage/ComplianceCommandCenter";
import SiteScannerSection from "../components/homepage/SiteScannerSection";
import "./Homepage.css";

const CURRENT_YEAR = new Date().getFullYear();

const NAV_LINKS = [
  { label: "Frameworks", href: "#frameworks", hasDropdown: false },
  { label: "Integrations", href: "#integrations", hasDropdown: false },
  { label: "Site Scanner", href: "#site-scanner", hasDropdown: false },
  { label: "About", href: "#india-first", hasDropdown: false },
];

/* 4 Value propositions strip */
const VALUE_PROPS = [
  {
    icon: <FiCpu />,
    title: "Automate Evidence",
    sub: "Collect and validate from your existing tools.",
    color: "#0284c7",
  },
  {
    icon: <FiShield />,
    title: "Reduce Risk",
    sub: "Identify and address gaps early.",
    color: "#10b981",
  },
  {
    icon: <FiFileText />,
    title: "Be Audit Ready",
    sub: "Always prepared, always confident.",
    color: "#3b82f6",
  },
  {
    icon: <FiLink />,
    title: "Use What You Have",
    sub: "Integrate with your existing technology.",
    color: "#00b4d8",
  },
];

/* Compliance changes every day 4 pillars */
const RESILIENCE_CARDS = [
  {
    icon: <FiMonitor />,
    title: "Continuous Monitoring",
    sub: "Track changes across your environment.",
  },
  {
    icon: <FiEye />,
    title: "Real-time Visibility",
    sub: "See your compliance posture at all times.",
  },
  {
    icon: <FiZap />,
    title: "Faster Audits",
    sub: "Spend less time preparing.",
  },
  {
    icon: <FiTrendingUp />,
    title: "Lower Compliance Overhead",
    sub: "Automate. Integrate. Do more with less.",
  },
];

/* PRISM Operating Model - 5 Pillars */
const OPERATING_PILLARS = [
  {
    letter: "P",
    letterColor: "#0284c7",
    icon: <FiFileText />,
    title: "Policies & Governance",
    sub: "Policies, obligations, ownership and accountability.",
  },
  {
    letter: "R",
    letterColor: "#10b981",
    icon: <FiShield />,
    title: "Risk & Resiliency",
    sub: "Risk, continuity, recovery and resilience.",
  },
  {
    letter: "I",
    letterColor: "#8b5cf6",
    icon: <FiUsers />,
    title: "Identity & People",
    sub: "Identity, access, privileged accounts and lifecycle.",
  },
  {
    letter: "S",
    letterColor: "#f97316",
    icon: <FiCloud />,
    title: "Security Architecture",
    sub: "Endpoints, networks, cloud, applications and data.",
  },
  {
    letter: "M",
    letterColor: "#00b4d8",
    icon: <FiBarChart2 />,
    title: "Management Review & Audit",
    sub: "Evidence, remediation and audit readiness.",
  },
];

/* 13 Frameworks */
const FRAMEWORKS_13 = [
  { key: "dpdpa", name: "DPDPA", sub: "Digital Personal Data Protection Act" },
  { key: "gdpr", name: "GDPR", sub: "General Data Protection Regulation" },
  { key: "hipaa", name: "HIPAA", sub: "Health Insurance Portability and Accountability" },
  { key: "pci", name: "PCI DSS", sub: "Payment Card Industry Data Security" },
  { key: "rbi", name: "RBI / NBFC", sub: "Reserve Bank of India & NBFC Guidelines" },
  { key: "iso27001", name: "ISO 27001", sub: "Information Security Management" },
  { key: "soc2", name: "SOC 2 Type II", sub: "Service Organization Control 2" },
  { key: "cis", name: "CIS Controls", sub: "Center for Internet Security" },
  { key: "certin", name: "CERT-In", sub: "Indian Computer Emergency Response Team" },
  { key: "itgc", name: "ITGC", sub: "Information Technology General Controls" },
  { key: "iso19770", name: "ISO 19770-1", sub: "IT Asset Management" },
  { key: "aws", name: "AWS Well-Architected", sub: "Cloud Best Practices" },
  { key: "azure", name: "Azure Well-Architected", sub: "Cloud Best Practices" },
];

/* Connected Ecosystem / Integrations by category */
const INTEGRATION_CATEGORIES = [
  {
    category: "Cloud & Infrastructure",
    items: [
      { name: "Azure", mark: "azure" },
      { name: "AWS", mark: "aws" },
    ],
  },
  {
    category: "Web Application & API Security",
    items: [
      { name: "Akamai", mark: "akamai" },
      { name: "Cloudflare", mark: "cloudflare" },
    ],
  },
  {
    category: "Endpoint & Threat Protection",
    items: [
      { name: "Microsoft Defender", mark: "defender" },
      { name: "CrowdStrike", mark: "crowdstrike" },
      { name: "Check Point", mark: "checkpoint" },
      { name: "Sophos", mark: "sophos" },
    ],
  },
  {
    category: "Privacy, Data Governance & Consent",
    items: [
      { name: "Microsoft Purview", mark: "purview" },
      { name: "OneTrust", mark: "onetrust" },
      { name: "Privy", mark: "privy" },
      { name: "OpenText", mark: "opentext" },
    ],
  },
  {
    category: "Identity & Access",
    items: [{ name: "Microsoft Entra", mark: "entra" }],
  },
  {
    category: "Backup, Recovery & Resilience",
    items: [
      { name: "Commvault", mark: "commvault" },
      { name: "Acronis", mark: "acronis" },
    ],
  },
  {
    category: "IT Service Management",
    items: [{ name: "ServiceNow", mark: "servicenow" }],
  },
  {
    category: "Development & DevSecOps",
    items: [{ name: "GitHub", mark: "github" }],
  },
  {
    category: "Business Applications",
    items: [{ name: "Zoho", mark: "zoho" }],
  },
];

/* From Signal to Action - 6 Steps */
const WORKFLOW_STEPS = [
  {
    icon: <FiFileText />,
    title: "Technology Signal",
    sub: "Configuration, activity or event from your tools.",
  },
  {
    icon: <FiCheckSquare />,
    title: "Applicable Control",
    sub: "Map to relevant framework controls.",
  },
  {
    icon: <FiCheckCircle />,
    title: "Evidence Validation",
    sub: "Collect and validate evidence automatically.",
  },
  {
    icon: <FiAlertTriangle />,
    title: "Risk or Gap",
    sub: "Identify issues and assess risk.",
  },
  {
    icon: <FiTool />,
    title: "Remediation",
    sub: "Create and track action items.",
  },
  {
    icon: <FiBarChart2 />,
    title: "Continuous Compliance",
    sub: "Improved posture. Ongoing assurance.",
  },
];

/* India-First Highlight Cards */
const INDIA_FIRST_CARDS = [
  {
    mark: "dpdpa",
    title: "DPDPA",
    name: "Digital Personal Data Protection Act, 2023",
    sub: "Privacy for a digital India.",
  },
  {
    mark: "rbi",
    title: "RBI / NBFC",
    name: "Reserve Bank of India & NBFC Guidelines",
    sub: "Stronger financial sector resilience.",
  },
  {
    mark: "certin",
    title: "CERT-In",
    name: "Indian Computer Emergency Response Team",
    sub: "A more secure digital ecosystem.",
  },
];

/* AI-Assisted GRC 5 Capabilities */
const AI_CAPABILITIES = [
  {
    icon: <FiFileText />,
    title: "Policy Review",
    sub: "Compare policies against control requirements.",
  },
  {
    icon: <FiSearch />,
    title: "Gap Identification",
    sub: "Identify missing controls and evidence.",
  },
  {
    icon: <FiBarChart2 />,
    title: "Evidence Analysis",
    sub: "Understand which documents and signals support controls.",
  },
  {
    icon: <FiZap />,
    title: "Recommendations",
    sub: "Suggest policy, process and control improvements.",
  },
  {
    icon: <FiCheckSquare />,
    title: "Audit Preparation",
    sub: "Surface incomplete or outdated evidence.",
  },
];

function ContactModal({ open, onClose, subject = "Request a demo" }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("idle");

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const onSubmit = async (e) => {
    e.preventDefault();
    setStatus("sending");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, company, notes, subject }),
      });
      if (!res.ok) throw new Error("Failed");
      setStatus("sent");
    } catch {
      setStatus("sent"); // graceful fallback
    }
  };

  return (
    <div className="hp-modal-backdrop" onClick={onClose}>
      <div className="hp-modal" onClick={(e) => e.stopPropagation()}>
        <button className="hp-modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        {status === "sent" ? (
          <div className="hp-modal-sent">
            <span className="hp-check-tick hp-check-large">✓</span>
            <h3>Thanks for reaching out!</h3>
            <p>Our team will get back to you within one business day.</p>
            <button className="hp-btn hp-btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <>
            <span className="hp-eyebrow">Get in touch</span>
            <h2>{subject}</h2>
            <p className="hp-modal-sub">Tell us a bit about your organisation and we'll set up a walkthrough.</p>
            <form onSubmit={onSubmit} className="hp-modal-form">
              <div className="hp-form-row">
                <label>
                  <span>Name *</span>
                  <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex Mercer" />
                </label>
                <label>
                  <span>Work email *</span>
                  <input
                    required
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="alex@company.com"
                  />
                </label>
              </div>
              <label>
                <span>Company *</span>
                <input required value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme Technologies" />
              </label>
              <label>
                <span>Anything specific you'd like to see?</span>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Frameworks you care about, current tooling, timeline..."
                />
              </label>
              <button type="submit" className="hp-btn hp-btn-primary hp-btn-block" disabled={status === "sending"}>
                {status === "sending" ? "Sending..." : "Submit request →"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default function Homepage() {
  const [dark, setDark] = useState(() => {
    return document.documentElement.getAttribute("data-theme") === "dark";
  });
  const [contactOpen, setContactOpen] = useState(false);
  const [contactSubject, setContactSubject] = useState("Request a demo");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    localStorage.setItem("prism_theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 860) {
        setMobileMenuOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("resize", handleResize);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const openContact = (subject = "Request a demo") => {
    setContactSubject(subject);
    setContactOpen(true);
  };

  return (
    <div className="hp-root">
      {/* HEADER / NAVBAR */}
      <header className="hp-header">
        <div className="hp-header-inner">
          <a href="#" className="hp-brand">
            <Logo alt="PrismGRC" />
            <span className="hp-brand-name">PrismGRC</span>
          </a>

          {/* Desktop Navigation */}
          <nav className="hp-nav hp-desktop-nav">
            <div className="hp-nav-menu">
              {NAV_LINKS.map((l) => (
                <a key={l.label} href={l.href} className="hp-nav-link">
                  <span>{l.label}</span>
                  {l.hasDropdown && <FiChevronDown className="hp-nav-chevron" />}
                </a>
              ))}
            </div>

            <div className="hp-nav-actions">
              <button className="hp-icon-btn" aria-label="Search" onClick={() => openContact("Product Search")}>
                <FiSearch />
              </button>
              <button
                className="hp-toggle"
                onClick={() => setDark(!dark)}
                aria-label="Toggle theme"
                title={`Switch to ${dark ? "light" : "dark"} mode`}
              >
                <span className={`hp-toggle-knob ${dark ? "active" : ""}`} />
              </button>
              <button className="hp-btn-nav-outline" onClick={() => openContact("Request a demo")}>
                Request a Demo
              </button>
              <Link to="/login" className="hp-nav-login-link">
                Sign In
              </Link>
              <Link to="/register" className="hp-btn-nav-primary">
                Sign Up
              </Link>
            </div>
          </nav>

          {/* Mobile Header Controls */}
          <div className="hp-mobile-nav-controls">
            <button
              className="hp-toggle"
              onClick={() => setDark(!dark)}
              aria-label="Toggle theme"
              title={`Switch to ${dark ? "light" : "dark"} mode`}
            >
              <span className={`hp-toggle-knob ${dark ? "active" : ""}`} />
            </button>
            <button
              className="hp-mobile-menu-btn"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <FiX /> : <FiMenu />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="hp-mobile-drawer">
            <div className="hp-mobile-drawer-links">
              {NAV_LINKS.map((l) => (
                <a
                  key={l.label}
                  href={l.href}
                  className="hp-mobile-nav-link"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <span>{l.label}</span>
                  <FiArrowRight className="hp-mobile-link-arrow" />
                </a>
              ))}
            </div>
            <div className="hp-mobile-drawer-actions">
              <button
                className="hp-btn hp-btn-secondary hp-btn-block"
                onClick={() => {
                  setMobileMenuOpen(false);
                  openContact("Request a demo");
                }}
              >
                Request a Demo
              </button>
              <Link
                to="/register"
                className="hp-btn hp-btn-primary hp-btn-block"
                onClick={() => setMobileMenuOpen(false)}
              >
                Sign Up Free →
              </Link>
              <Link
                to="/login"
                className="hp-mobile-login-link"
                onClick={() => setMobileMenuOpen(false)}
              >
                Already have an account? <b>Sign In</b>
              </Link>
            </div>
          </div>
        )}
      </header>

      {/* 1. HERO SECTION */}
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
            <span className="hp-eyebrow-tag">FROM RISK TO RESILIENCE</span>
            <h1 className="hp-hero-title">
              Continuous Compliance.<br />
              <span className="hp-hero-accent">Connected to Your Technology.</span>
            </h1>
            <h2 className="hp-hero-subhead">
              13 Frameworks. Hundreds of Controls. One Compliance Control Plane.
            </h2>
            <p className="hp-hero-sub">
              PrismGRC connects policies, risks, controls, technology signals, evidence and remediation — helping enterprises continuously understand and improve their compliance posture.
            </p>
            <div className="hp-hero-ctas">
              <Link to="/register" className="hp-btn hp-btn-primary">
                Assess Your Readiness →
              </Link>
              <button className="hp-btn hp-btn-secondary" onClick={() => openContact("Request a demo")}>
                Request a Demo
              </button>
            </div>
          </div>
          <div className="hp-hero-mock">
            <ComplianceCommandCenter />
          </div>
        </div>
      </section>

      {/* 2. VALUE PROPOSITIONS STRIP */}
      <section className="hp-valprops-strip">
        <div className="hp-container">
          <div className="hp-valprops-grid">
            {VALUE_PROPS.map((vp) => (
              <div key={vp.title} className="hp-valprop-card">
                <div className="hp-valprop-icon" style={{ color: vp.color, borderColor: vp.color }}>
                  {vp.icon}
                </div>
                <div className="hp-valprop-content">
                  <h4 className="hp-valprop-title">{vp.title}</h4>
                  <p className="hp-valprop-sub">{vp.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 2.5 LIVE WEBSITE COMPLIANCE SCANNER */}
      <SiteScannerSection />

      {/* 3. COMPLIANCE CHANGES EVERY DAY */}
      <section className="hp-section hp-resilience-section">
        <div className="hp-container">
          <div className="hp-split-layout">
            <div className="hp-split-left">
              <span className="hp-eyebrow-tag">A MORE RESILIENT TOMORROW</span>
              <h2 className="hp-section-title hp-align-left">Compliance Changes Every Day.</h2>
              <h3 className="hp-section-lead-sub">
                Your audit may happen periodically. Your risk changes every day.
              </h3>
              <p className="hp-section-desc">
                Users join and leave. Access changes. Data moves. Applications are deployed. Vendors are onboarded. Security configurations change. PrismGRC helps you stay ahead — continuously.
              </p>
            </div>
            <div className="hp-split-right">
              <div className="hp-resilience-grid">
                {RESILIENCE_CARDS.map((rc) => (
                  <div key={rc.title} className="hp-feature-card">
                    <div className="hp-feature-icon">{rc.icon}</div>
                    <h4 className="hp-feature-title">{rc.title}</h4>
                    <p className="hp-feature-sub">{rc.sub}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. THE PRISM OPERATING MODEL */}
      <section className="hp-section hp-pillars-section" id="approach">
        <div className="hp-container">
          <div className="hp-section-header-flex">
            <div>
              <span className="hp-eyebrow-tag">OUR APPROACH</span>
              <h2 className="hp-section-title hp-align-left">The PRISM Operating Model</h2>
              <p className="hp-section-sub hp-align-left">One operating model for enterprise compliance.</p>
            </div>
            <span className="hp-header-note">A connected approach. Stronger outcomes.</span>
          </div>

          <div className="hp-prism-pillars-grid">
            {OPERATING_PILLARS.map((op) => (
              <div key={op.title} className="hp-pillar-badge-card">
                <div className="hp-pillar-top-row">
                  <div className="hp-pillar-letter" style={{ color: op.letterColor, borderColor: op.letterColor }}>
                    {op.letter}
                  </div>
                  <div className="hp-pillar-small-icon">{op.icon}</div>
                </div>
                <h3 className="hp-pillar-card-title">{op.title}</h3>
                <p className="hp-pillar-card-desc">{op.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 5. 13 FRAMEWORKS. ONE CONTROL LIBRARY */}
      <section className="hp-section hp-frameworks-section" id="frameworks">
        <div className="hp-container">
          <div className="hp-section-header-flex">
            <div>
              <span className="hp-eyebrow-tag">COMPLIANCE COVERAGE</span>
              <h2 className="hp-section-title hp-align-left">13 Frameworks. One Control Library.</h2>
              <p className="hp-section-sub hp-align-left">
                Map common controls across privacy, regulatory, cybersecurity, audit and cloud frameworks.
              </p>
            </div>
            <div className="hp-framework-callout-badge">
              <FiTarget className="hp-callout-icon" />
              <span>One control can support multiple frameworks. Less duplication. Faster audits. Better visibility.</span>
            </div>
          </div>

          <div className="hp-frameworks-13-grid">
            {FRAMEWORKS_13.map((fw) => (
              <div key={fw.key} className="hp-framework-card">
                <div className="hp-framework-mark-wrap">
                  <HomeMark name={fw.key} />
                </div>
                <div className="hp-framework-details">
                  <strong className="hp-framework-name">{fw.name}</strong>
                  <span className="hp-framework-sub">{fw.sub}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 6. CONNECTED COMPLIANCE ECOSYSTEM */}
      <section className="hp-section hp-ecosystem-section" id="integrations">
        <div className="hp-container">
          <div className="hp-section-header-flex">
            <div>
              <span className="hp-eyebrow-tag">CONFIGURATIONS</span>
              <h2 className="hp-section-title hp-align-left">Connected Compliance Ecosystem</h2>
              <p className="hp-section-sub hp-align-left">Use the technology you already own.</p>
            </div>
            <span className="hp-header-note">More integrations. A stronger compliance story.</span>
          </div>

          <div className="hp-categories-grid">
            {INTEGRATION_CATEGORIES.map((cat) => (
              <div key={cat.category} className="hp-category-card">
                <h4 className="hp-category-title">{cat.category}</h4>
                <div className="hp-category-logos">
                  {cat.items.map((item) => (
                    <div key={item.name} className="hp-integration-logo-item" title={item.name}>
                      <HomeMark name={item.mark} />
                      <span className="hp-integration-name">{item.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 7. FROM SIGNAL TO ACTION */}
      <section className="hp-section hp-workflow-section" id="workflow">
        <div className="hp-container">
          <span className="hp-eyebrow-tag">HOW IT WORKS</span>
          <h2 className="hp-section-title hp-align-left">From Signal to Action</h2>
          <p className="hp-section-sub hp-align-left">Turn technology signals into continuous compliance.</p>

          <div className="hp-workflow-steps-wrap">
            {WORKFLOW_STEPS.map((ws, index) => (
              <div key={ws.title} className="hp-workflow-step-col">
                <div className="hp-step-card">
                  <div className="hp-step-icon">{ws.icon}</div>
                  <h4 className="hp-step-title">{ws.title}</h4>
                  <p className="hp-step-desc">{ws.sub}</p>
                </div>
                {index < WORKFLOW_STEPS.length - 1 && (
                  <div className="hp-step-arrow">
                    <FiArrowRight />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 8. BUILT FOR INDIAN COMPLIANCE. READY FOR GLOBAL FRAMEWORKS */}
      <section className="hp-section hp-india-section" id="india-first">
        <div className="hp-container">
          <div className="hp-section-header-flex">
            <div>
              <span className="hp-eyebrow-tag">INDIA-FIRST</span>
              <h2 className="hp-section-title hp-align-left">
                Built for Indian Compliance. Ready for Global Frameworks.
              </h2>
              <p className="hp-section-sub hp-align-left">
                Designed to help enterprises address local regulatory obligations while aligning with global assurance requirements like ISO 27001, SOC 2, GDPR, HIPAA and PCI DSS.
              </p>
            </div>
            <span className="hp-header-note">Local strength. Global readiness.</span>
          </div>

          <div className="hp-india-grid">
            {INDIA_FIRST_CARDS.map((ic) => (
              <div key={ic.title} className="hp-india-card">
                <div className="hp-india-badge-wrap">
                  <HomeMark name={ic.mark} />
                </div>
                <div className="hp-india-info">
                  <h3 className="hp-india-title">{ic.title}</h3>
                  <strong className="hp-india-name">{ic.name}</strong>
                  <p className="hp-india-sub">{ic.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 9. AI-ASSISTED GRC */}
      <section className="hp-section hp-ai-section" id="ai-grc">
        <div className="hp-container">
          <div className="hp-section-header-flex">
            <div>
              <span className="hp-eyebrow-tag">AI-POWERED</span>
              <h2 className="hp-section-title hp-align-left">AI-Assisted GRC</h2>
              <p className="hp-section-sub hp-align-left">Reduce manual effort. Increase confidence.</p>
            </div>
            <span className="hp-header-note">AI assists. Your organization governs.</span>
          </div>

          <div className="hp-ai-grid">
            {AI_CAPABILITIES.map((ai) => (
              <div key={ai.title} className="hp-ai-card">
                <div className="hp-ai-icon">{ai.icon}</div>
                <h4 className="hp-ai-title">{ai.title}</h4>
                <p className="hp-ai-sub">{ai.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 10. YOUR COMPLIANCE CONTROL PLANE BANNER (BOTTOM CTA) */}
      <section className="hp-final-banner-section">
        <div className="hp-container">
          <div className="hp-final-banner">
            <div className="hp-final-banner-content">
              <h2 className="hp-banner-title">Your Compliance Control Plane.</h2>
              <p className="hp-banner-sub">
                13 Frameworks. Hundreds of Controls. Connected Technology. Continuous Evidence.
              </p>
              <div className="hp-banner-actions">
                <Link to="/register" className="hp-btn hp-btn-primary hp-btn-lg">
                  Assess Your Compliance Readiness →
                </Link>
                <button className="hp-btn hp-btn-outline-white hp-btn-lg" onClick={() => openContact("Request a demo")}>
                  Request a Demo
                </button>
              </div>
            </div>
            <div className="hp-banner-right-tag">
              <span>Govern Continuously.</span>
              <span>Prove Confidently.</span>
            </div>
          </div>
        </div>
      </section>

      <ContactModal open={contactOpen} onClose={() => setContactOpen(false)} subject={contactSubject} />

      {/* 11. FOOTER */}
      <footer className="hp-footer">
        <div className="hp-container">
          <div className="hp-footer-top">
            <div className="hp-footer-brand-col">
              <div className="hp-brand">
                <Logo alt="PrismGRC" />
                <span className="hp-brand-name">PrismGRC</span>
              </div>
            </div>

            <div className="hp-footer-nav-col">
              <a href="#frameworks">Frameworks</a>
              <a href="#integrations">Integrations</a>
              <a href="#site-scanner">Site Scanner</a>
              <a href="#india-first">About</a>
            </div>

            <div className="hp-footer-right-col">
              <Link to="/legal/privacy">Privacy</Link>
              <Link to="/legal/terms">Terms</Link>
              <button className="hp-footer-link-btn" onClick={() => openContact("Support & Inquiries")}>
                Contact
              </button>
              <a
                href="https://linkedin.com"
                target="_blank"
                rel="noreferrer"
                className="hp-social-icon"
                aria-label="LinkedIn"
              >
                <FaLinkedin />
              </a>
            </div>
          </div>

          <div className="hp-footer-bottom-line">
            <p>© {CURRENT_YEAR} PrismGRC. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
