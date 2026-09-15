import { useState } from "react";
import { Link } from "react-router-dom";
import {
  FiSearch,
  FiCheckCircle,
  FiAlertTriangle,
  FiXCircle,
  FiMinus,
  FiDownload,
  FiArrowRight,
  FiShield,
  FiLock,
  FiFileText,
  FiEye,
  FiActivity,
  FiChevronDown,
  FiChevronUp,
} from "react-icons/fi";

const API_URL = import.meta.env.VITE_API_URL || "";

const STATUS_META = {
  pass: { icon: <FiCheckCircle />, color: "var(--hp-green)", label: "Pass", bg: "rgba(16, 185, 129, 0.12)" },
  partial: { icon: <FiAlertTriangle />, color: "var(--hp-amber)", label: "Partial", bg: "rgba(245, 158, 11, 0.12)" },
  fail: { icon: <FiXCircle />, color: "var(--hp-red)", label: "Fail", bg: "rgba(239, 68, 68, 0.12)" },
  na: { icon: <FiMinus />, color: "var(--hp-ink-3)", label: "N/A", bg: "rgba(148, 163, 184, 0.12)" },
};

function scoreColor(s) {
  if (s >= 75) return "var(--hp-green)";
  if (s >= 60) return "var(--hp-teal)";
  if (s >= 40) return "var(--hp-amber)";
  return "var(--hp-red)";
}

function ScoreGauge({ score, label, grade }) {
  const c = scoreColor(score);
  const radius = 46;
  const circ = 2 * Math.PI * radius;
  const offset = circ * (1 - Math.max(0, Math.min(100, score)) / 100);

  return (
    <div className="hp-scanner-gauge-wrap">
      <div className="hp-scanner-gauge-svg-wrap">
        <svg viewBox="0 0 110 110" className="hp-scanner-gauge-svg">
          <circle
            cx="55"
            cy="55"
            r={radius}
            fill="none"
            stroke="var(--hp-surface-3)"
            strokeWidth="9"
          />
          <circle
            cx="55"
            cy="55"
            r={radius}
            fill="none"
            stroke={c}
            strokeWidth="9"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform="rotate(-90 55 55)"
            style={{ transition: "stroke-dashoffset 0.8s ease" }}
          />
          <text x="55" y="49" textAnchor="middle" className="hp-scanner-gauge-num" fill={c}>
            {score}
          </text>
          <text x="55" y="65" textAnchor="middle" className="hp-scanner-gauge-max">
            /100
          </text>
        </svg>
        {grade && <span className="hp-scanner-grade-badge" style={{ color: c }}>{grade}</span>}
      </div>
      <div className="hp-scanner-gauge-label">{label}</div>
    </div>
  );
}

function CategoryBar({ name, score, passed, total }) {
  const c = scoreColor(score);
  return (
    <div className="hp-scanner-cat-row">
      <div className="hp-scanner-cat-header">
        <span className="hp-scanner-cat-name">{name}</span>
        <div className="hp-scanner-cat-score-wrap">
          {total !== undefined && (
            <span className="hp-scanner-cat-count">
              {passed}/{total} checks
            </span>
          )}
          <span className="hp-scanner-cat-val" style={{ color: c }}>
            {score}%
          </span>
        </div>
      </div>
      <div className="hp-scanner-cat-track">
        <div
          className="hp-scanner-cat-fill"
          style={{ width: `${Math.max(4, score)}%`, background: c }}
        />
      </div>
    </div>
  );
}

const SAMPLE_URLS = [
  "example.com",
  "wikipedia.org",
  "github.com",
];

const SCAN_CAPABILITIES = [
  { icon: <FiFileText />, title: "Privacy Notice & Terms", desc: "Checks for clear notice, purpose specification & contact information." },
  { icon: <FiShield />, title: "DPDPA 2023 Grievance Redressal", desc: "Detects Grievance Officer details and redressal mechanisms." },
  { icon: <FiEye />, title: "Cookie & Tracker Consent", desc: "Audits cookies, analytics scripts and consent collection banners." },
  { icon: <FiLock />, title: "Security & HTTPS Headers", desc: "Scans SSL, HSTS, CSP, and secure transmission protocols." },
];

export default function SiteScannerSection() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [expandedCats, setExpandedCats] = useState({});
  const [activeTab, setActiveTab] = useState("overview"); // 'overview' | 'categories' | 'remediation' | 'checks'
  const [downloading, setDownloading] = useState(false);

  const normalizeUrl = (input) => {
    let trimmed = input.trim();
    if (!trimmed) return "";
    if (!/^https?:\/\//i.test(trimmed)) {
      trimmed = "https://" + trimmed;
    }
    return trimmed;
  };

  const handleScan = async (e, customUrl) => {
    if (e) e.preventDefault();
    const targetUrl = normalizeUrl(customUrl || url);
    if (!targetUrl) return;

    setUrl(targetUrl);
    setError("");
    setResult(null);
    setLoading(true);

    try {
      const resp = await fetch(`${API_URL}/api/dpdpa/public-scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Scan could not be completed.");
      setResult(data);
      setActiveTab("overview");
    } catch (err) {
      setError(err.message || "Could not complete website scan. Please verify URL.");
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadReport = async () => {
    const targetUrl = result?.target || normalizeUrl(url);
    if (!targetUrl) return;
    setDownloading(true);
    try {
      const resp = await fetch(`${API_URL}/api/dpdpa/public-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl }),
      });
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error(d.error || "Failed to generate report.");
      }
      const html = await resp.text();
      const blob = new Blob([html], { type: "text/html" });
      const blobUrl = URL.createObjectURL(blob);
      const win = window.open(blobUrl, "_blank");
      if (!win) window.location.href = blobUrl;
    } catch (err) {
      alert("Report generation failed: " + err.message);
    } finally {
      setDownloading(false);
    }
  };

  const toggleCategory = (cat) => {
    setExpandedCats((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  const dpdpa = result?.evaluation?.frameworks?.DPDPA;
  const gdpr = result?.evaluation?.frameworks?.GDPR;
  const categories = result?.evaluation?.categoryScores || [];
  const remediation = result?.evaluation?.remediation || [];
  const checks = result?.evaluation?.results || [];

  return (
    <section className="hp-section hp-scanner-section" id="site-scanner">
      <div className="hp-container">
        {/* Section Header */}
        <div className="hp-section-header-flex">
          <div>
            <span className="hp-eyebrow-tag">
              <FiActivity /> FREE LIVE SCANNER
            </span>
            <h2 className="hp-section-title hp-align-left">
              Instant Website Compliance Scanner
            </h2>
            <p className="hp-section-sub hp-align-left">
              Audit any website against India's <b>DPDPA 2023</b> and <b>GDPR</b> privacy regulations in seconds.
              Get your real-time compliance score, tracker insights, and step-by-step remediation items.
            </p>
          </div>
          <span className="hp-header-note">100% Free · No Registration Required</span>
        </div>

        {/* Scanner Input Card */}
        <div className="hp-scanner-input-card">
          <form onSubmit={(e) => handleScan(e)} className="hp-scanner-form">
            <div className="hp-scanner-input-wrap">
              <FiSearch className="hp-scanner-search-icon" />
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Enter website URL (e.g. https://yourcompany.com)"
                className="hp-scanner-input"
                disabled={loading}
                required
              />
              <button
                type="submit"
                disabled={loading}
                className="hp-btn hp-btn-primary hp-scanner-btn"
              >
                {loading ? (
                  <>
                    <span className="hp-scanner-spinner" />
                    <span>Scanning…</span>
                  </>
                ) : (
                  <>
                    <span>Scan Website</span>
                    <FiArrowRight />
                  </>
                )}
              </button>
            </div>

            {/* Quick Sample Links */}
            <div className="hp-scanner-samples">
              <span className="hp-scanner-samples-label">Try sample:</span>
              <div className="hp-scanner-sample-chips">
                {SAMPLE_URLS.map((sample) => (
                  <button
                    key={sample}
                    type="button"
                    className="hp-scanner-chip"
                    onClick={() => handleScan(null, `https://${sample}`)}
                    disabled={loading}
                  >
                    {sample}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div className="hp-scanner-error-box">
                <FiAlertTriangle />
                <span>{error}</span>
              </div>
            )}
          </form>
        </div>

        {/* Loading State Animation */}
        {loading && (
          <div className="hp-scanner-loading-state">
            <div className="hp-scanner-radar-wrap">
              <div className="hp-scanner-radar-circle" />
              <div className="hp-scanner-radar-sweep" />
              <FiActivity className="hp-scanner-radar-icon" />
            </div>
            <h3 className="hp-scanner-loading-title">Analyzing {url}…</h3>
            <p className="hp-scanner-loading-desc">
              Checking cookies, tracking scripts, consent notices, Grievance Officer disclosures, SSL & security headers.
            </p>
          </div>
        )}

        {/* Scan Results View */}
        {result && !loading && (
          <div className="hp-scanner-results-card">
            {/* Results Header Bar */}
            <div className="hp-scanner-res-topbar">
              <div className="hp-scanner-res-target">
                <span className="hp-scanner-res-badge">LIVE SCAN RESULT</span>
                <h3 className="hp-scanner-res-url">{result.target}</h3>
                <span className="hp-scanner-res-time">
                  Scanned just now
                </span>
              </div>
              <div className="hp-scanner-res-actions">
                <button
                  className="hp-btn hp-btn-secondary hp-scanner-report-btn"
                  onClick={handleDownloadReport}
                  disabled={downloading}
                >
                  <FiDownload />
                  <span>{downloading ? "Generating…" : "Download PDF Report"}</span>
                </button>
                <Link to="/register" className="hp-btn hp-btn-primary hp-scanner-assess-btn">
                  <span>Track in Workspace</span>
                  <FiArrowRight />
                </Link>
              </div>
            </div>

            {/* Score Gauges & Quick Stats */}
            <div className="hp-scanner-metrics-grid">
              <div className="hp-scanner-gauges-col">
                {dpdpa && (
                  <ScoreGauge
                    score={dpdpa.score}
                    label={`DPDPA 2023 (${dpdpa.label})`}
                    grade={dpdpa.grade}
                  />
                )}
                {gdpr && (
                  <ScoreGauge
                    score={gdpr.score}
                    label={`GDPR (${gdpr.label})`}
                    grade={gdpr.grade}
                  />
                )}
              </div>

              {dpdpa && (
                <div className="hp-scanner-stats-col">
                  <h4 className="hp-scanner-stats-heading">Checks Breakdown</h4>
                  <div className="hp-scanner-stats-grid">
                    <div className="hp-scanner-stat-pill" style={{ borderColor: "var(--hp-green)" }}>
                      <span className="hp-scanner-stat-num" style={{ color: "var(--hp-green)" }}>
                        {dpdpa.passed}
                      </span>
                      <span className="hp-scanner-stat-label">Passed</span>
                    </div>
                    <div className="hp-scanner-stat-pill" style={{ borderColor: "var(--hp-amber)" }}>
                      <span className="hp-scanner-stat-num" style={{ color: "var(--hp-amber)" }}>
                        {dpdpa.partial}
                      </span>
                      <span className="hp-scanner-stat-label">Partial</span>
                    </div>
                    <div className="hp-scanner-stat-pill" style={{ borderColor: "var(--hp-red)" }}>
                      <span className="hp-scanner-stat-num" style={{ color: "var(--hp-red)" }}>
                        {dpdpa.failed}
                      </span>
                      <span className="hp-scanner-stat-label">Failed</span>
                    </div>
                    <div className="hp-scanner-stat-pill" style={{ borderColor: "var(--hp-ink-3)" }}>
                      <span className="hp-scanner-stat-num" style={{ color: "var(--hp-ink-3)" }}>
                        {dpdpa.notApplicable}
                      </span>
                      <span className="hp-scanner-stat-label">N/A</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Results Navigation Tabs */}
            <div className="hp-scanner-tabs">
              <button
                className={`hp-scanner-tab ${activeTab === "overview" ? "active" : ""}`}
                onClick={() => setActiveTab("overview")}
              >
                Categories Overview ({categories.length})
              </button>
              <button
                className={`hp-scanner-tab ${activeTab === "remediation" ? "active" : ""}`}
                onClick={() => setActiveTab("remediation")}
              >
                Remediation Actions ({remediation.length})
              </button>
              <button
                className={`hp-scanner-tab ${activeTab === "checks" ? "active" : ""}`}
                onClick={() => setActiveTab("checks")}
              >
                All Checks ({checks.length})
              </button>
            </div>

            {/* Tab 1: Categories Overview */}
            {activeTab === "overview" && (
              <div className="hp-scanner-tab-content">
                <div className="hp-scanner-cat-list">
                  {categories.map((c) => (
                    <CategoryBar
                      key={c.name}
                      name={c.name}
                      score={c.score}
                      passed={c.passed}
                      total={c.total}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Tab 2: Remediation Actions */}
            {activeTab === "remediation" && (
              <div className="hp-scanner-tab-content">
                <div className="hp-scanner-remediation-list">
                  {remediation.map((r, i) => {
                    const sev = r.severity?.toLowerCase();
                    return (
                      <div key={i} className={`hp-scanner-remediation-card hp-sev-${sev}`}>
                        <div className="hp-scanner-rem-header">
                          <span className={`hp-scanner-sev-pill hp-sev-badge-${sev}`}>
                            {r.severity}
                          </span>
                          <span className="hp-scanner-rem-title">{r.title}</span>
                          {r.reference && (
                            <span className="hp-scanner-rem-ref">{r.reference}</span>
                          )}
                        </div>
                        {r.detail && <p className="hp-scanner-rem-detail">{r.detail}</p>}
                        {r.recommendation && (
                          <div className="hp-scanner-rem-rec">
                            <b>Recommendation:</b> {r.recommendation}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Tab 3: All Checks Accordion */}
            {activeTab === "checks" && (
              <div className="hp-scanner-tab-content">
                <div className="hp-scanner-checks-accordion">
                  {Array.from(new Set(checks.map((c) => c.category))).map((cat) => {
                    const items = checks.filter((c) => c.category === cat);
                    const isOpen = !!expandedCats[cat];
                    return (
                      <div key={cat} className="hp-scanner-check-group">
                        <button
                          className="hp-scanner-group-toggle"
                          onClick={() => toggleCategory(cat)}
                        >
                          <span className="hp-scanner-group-name">{cat}</span>
                          <span className="hp-scanner-group-badge">
                            {items.length} checks {isOpen ? <FiChevronUp /> : <FiChevronDown />}
                          </span>
                        </button>
                        {isOpen && (
                          <div className="hp-scanner-group-body">
                            {items.map((item, idx) => {
                              const meta = STATUS_META[item.status] || STATUS_META.na;
                              return (
                                <div key={idx} className="hp-scanner-check-item">
                                  <span className="hp-scanner-check-icon" style={{ color: meta.color }}>
                                    {meta.icon}
                                  </span>
                                  <div className="hp-scanner-check-info">
                                    <div className="hp-scanner-check-title">{item.title}</div>
                                    {item.detail && (
                                      <div className="hp-scanner-check-detail">{item.detail}</div>
                                    )}
                                    {item.reference && (
                                      <div className="hp-scanner-check-ref">{item.reference}</div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Bottom Callout inside Results */}
            <div className="hp-scanner-bottom-cta">
              <div className="hp-scanner-bottom-cta-text">
                <h4>Transform audit findings into automated evidence</h4>
                <p>PRISM connects your policies, controls and remediation workflow in one control plane.</p>
              </div>
              <Link to="/register" className="hp-btn hp-btn-primary">
                Get Started Free →
              </Link>
            </div>
          </div>
        )}

        {/* Feature Highlights (when not scanned or as general info) */}
        {!result && !loading && (
          <div className="hp-scanner-highlights-grid">
            {SCAN_CAPABILITIES.map((cap) => (
              <div key={cap.title} className="hp-scanner-highlight-card">
                <div className="hp-scanner-highlight-icon">{cap.icon}</div>
                <h4 className="hp-scanner-highlight-title">{cap.title}</h4>
                <p className="hp-scanner-highlight-desc">{cap.desc}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
