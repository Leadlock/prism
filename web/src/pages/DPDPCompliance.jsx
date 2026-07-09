import { useState } from "react";
import { apiFetch } from "../api/client.js";

function scoreColor(score) {
  if (score >= 75) return "var(--green)";
  if (score >= 60) return "var(--amber)";
  if (score >= 40) return "var(--red)";
  return "var(--red)";
}

function gradeLabel(grade) {
  const labels = { A: "Strong", B: "Good", C: "Partial", D: "Weak", F: "Critical" };
  return labels[grade] || grade;
}

export default function DPDPCompliance({ token, user, company }) {
  const [url, setUrl] = useState("");
  const [scanType, setScanType] = useState("website");
  const [headless, setHeadless] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [validationError, setValidationError] = useState("");
  const [result, setResult] = useState(null);

  const handleScan = async (e) => {
    e.preventDefault();
    setValidationError("");
    setError("");

    if (!url.trim()) {
      setValidationError("Please enter a URL to scan");
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const data = await apiFetch("/api/dpdpa/scan", {
        token,
        method: "POST",
        body: JSON.stringify({ url: url.trim(), type: scanType, headless }),
      });
      setResult(data);
    } catch (err) {
      setError(err.message || "Scan failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const downloadHtmlReport = () => {
    if (!result?.html) return;
    const blob = new Blob([result.html], { type: "text/html" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `compliance-report-${result.target || "scan"}.html`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const downloadJsonReport = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `compliance-report-${result.target || "scan"}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="dpdp-page">
      <div className="dpdp-header">
        <div>
          <div className="logo">PRISM</div>
          <h1 className="dpdp-title">DPDP Compliance Scanner</h1>
          <p className="dpdp-subtitle">
            Scan websites for DPDPA 2023 &amp; GDPR compliance
          </p>
        </div>
      </div>

      {/* Scan Form */}
      <div className="dpdp-form-card">
        <form onSubmit={handleScan} className="dpdp-form">
          <div className="dpdp-form-row">
            <div className="form-group" style={{ flex: 2 }}>
              <label htmlFor="scan-url">Target URL</label>
              <input
                id="scan-url"
                type="text"
                placeholder="https://example.com"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (validationError) setValidationError("");
                }}
                className={validationError ? "input-error" : ""}
                aria-describedby={validationError ? "url-error" : undefined}
                aria-invalid={!!validationError}
              />
              {validationError && (
                <span id="url-error" className="error-text" role="alert">
                  {validationError}
                </span>
              )}
            </div>

            <div className="form-group" style={{ flex: 1 }}>
              <label htmlFor="scan-type">Scan Type</label>
              <select
                id="scan-type"
                value={scanType}
                onChange={(e) => setScanType(e.target.value)}
              >
                <option value="website">Website</option>
                <option value="mobile">Mobile App</option>
              </select>
            </div>
          </div>

          <div className="dpdp-form-actions">
            <label className="dpdp-checkbox-label" htmlFor="headless-toggle">
              <input
                id="headless-toggle"
                type="checkbox"
                checked={headless}
                onChange={(e) => setHeadless(e.target.checked)}
              />
              <span>Headless mode (deep scan)</span>
            </label>

            <button
              type="submit"
              className="btn btn-primary dpdp-scan-btn"
              disabled={loading}
            >
              {loading ? "Scanning…" : "Start Scan"}
            </button>
          </div>
        </form>
      </div>

      {/* Error Display */}
      {error && (
        <div className="dpdp-error" role="alert">
          <span className="dpdp-error-icon">⚠</span>
          <span>{error}</span>
        </div>
      )}

      {/* Loading Indicator */}
      {loading && (
        <div className="dpdp-loading">
          <div className="loading-spinner" />
          <p>Scanning in progress… This may take up to 60 seconds.</p>
        </div>
      )}

      {/* Results */}
      {result && result.evaluation && (
        <div className="dpdp-results">
          {/* Download Actions */}
          <div className="dpdp-download-bar">
            <span className="dpdp-target">Results for: <strong>{result.target}</strong></span>
            <div className="dpdp-download-actions">
              <button className="btn btn-ghost" onClick={downloadHtmlReport}>
                ↓ HTML Report
              </button>
              <button className="btn btn-ghost" onClick={downloadJsonReport}>
                ↓ JSON Report
              </button>
            </div>
          </div>

          {/* Overall Score */}
          <div className="dpdp-scores-grid">
            <div className="dpdp-score-card dpdp-score-main">
              <div className="dpdp-score-value" style={{ color: scoreColor(result.evaluation.overall.score) }}>
                {result.evaluation.overall.score}
              </div>
              <div className="dpdp-score-label">Overall Score</div>
              <div className="dpdp-score-grade" style={{ color: scoreColor(result.evaluation.overall.score) }}>
                Grade {result.evaluation.overall.grade} — {result.evaluation.overall.label}
              </div>
            </div>

            {/* Framework Scores */}
            <div className="dpdp-score-card">
              <div className="dpdp-score-value" style={{ color: scoreColor(result.evaluation.frameworks.GDPR.score) }}>
                {result.evaluation.frameworks.GDPR.score}
              </div>
              <div className="dpdp-score-label">GDPR</div>
              <div className="dpdp-score-meta">
                <span className="dpdp-meta-pass">{result.evaluation.frameworks.GDPR.passed} passed</span>
                <span className="dpdp-meta-partial">{result.evaluation.frameworks.GDPR.partial} partial</span>
                <span className="dpdp-meta-fail">{result.evaluation.frameworks.GDPR.failed} failed</span>
              </div>
            </div>

            <div className="dpdp-score-card">
              <div className="dpdp-score-value" style={{ color: scoreColor(result.evaluation.frameworks.DPDPA.score) }}>
                {result.evaluation.frameworks.DPDPA.score}
              </div>
              <div className="dpdp-score-label">DPDPA</div>
              <div className="dpdp-score-meta">
                <span className="dpdp-meta-pass">{result.evaluation.frameworks.DPDPA.passed} passed</span>
                <span className="dpdp-meta-partial">{result.evaluation.frameworks.DPDPA.partial} partial</span>
                <span className="dpdp-meta-fail">{result.evaluation.frameworks.DPDPA.failed} failed</span>
              </div>
            </div>
          </div>

          {/* Category Breakdown */}
          {result.evaluation.categoryScores && result.evaluation.categoryScores.length > 0 && (
            <div className="dpdp-section">
              <h2 className="dpdp-section-title">Category Breakdown</h2>
              <div className="dpdp-categories">
                {result.evaluation.categoryScores
                  .slice()
                  .sort((a, b) => a.score - b.score)
                  .map((cat) => (
                    <div key={cat.name} className="dpdp-cat-row">
                      <div className="dpdp-cat-name">{cat.name}</div>
                      <div className="dpdp-cat-track">
                        <div
                          className="dpdp-cat-fill"
                          style={{ width: `${cat.score}%`, background: scoreColor(cat.score) }}
                        />
                      </div>
                      <div className="dpdp-cat-score" style={{ color: scoreColor(cat.score) }}>
                        {cat.score}%
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Remediation Priorities */}
          {result.evaluation.remediation && result.evaluation.remediation.length > 0 && (
            <div className="dpdp-section">
              <h2 className="dpdp-section-title">Remediation Priorities</h2>
              <div className="dpdp-remediation-list">
                {result.evaluation.remediation.map((item, idx) => (
                  <div key={item.id || idx} className="dpdp-remediation-item">
                    <div className="dpdp-remediation-header">
                      <span className={`dpdp-severity dpdp-sev-${item.severity}`}>
                        {item.severity}
                      </span>
                      <span className="dpdp-remediation-title">{item.title}</span>
                    </div>
                    {item.recommendation && (
                      <div className="dpdp-remediation-rec">{item.recommendation}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
