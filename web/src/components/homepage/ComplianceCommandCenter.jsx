import React from "react";
import {
  FiGrid,
  FiLayers,
  FiCheckSquare,
  FiAlertTriangle,
  FiFileText,
  FiCheckCircle,
  FiList,
  FiBarChart2,
  FiLink,
  FiSearch,
  FiChevronDown,
} from "react-icons/fi";

export default function ComplianceCommandCenter() {
  return (
    <div className="hp-ccc-mockup" role="img" aria-label="Prism compliance command centre dashboard preview">
      {/* Mini Sidebar */}
      <aside className="hp-ccc-sidebar">
        <div className="hp-ccc-side-logo">
          <span className="hp-ccc-logo-mark">⏶</span>
          <span className="hp-ccc-logo-text">PrismGRC</span>
        </div>
        <nav className="hp-ccc-side-nav">
          <div className="hp-ccc-side-item active">
            <FiGrid /> <span>Dashboard</span>
          </div>
          <div className="hp-ccc-side-item">
            <FiLayers /> <span>Frameworks</span>
          </div>
          <div className="hp-ccc-side-item">
            <FiCheckSquare /> <span>Controls</span>
          </div>
          <div className="hp-ccc-side-item">
            <FiAlertTriangle /> <span>Risks</span>
          </div>
          <div className="hp-ccc-side-item">
            <FiFileText /> <span>Evidence</span>
          </div>
          <div className="hp-ccc-side-item">
            <FiList /> <span>Tasks</span>
          </div>
          <div className="hp-ccc-side-item">
            <FiBarChart2 /> <span>Reports</span>
          </div>
          <div className="hp-ccc-side-item">
            <FiLink /> <span>Integrations</span>
          </div>
        </nav>
      </aside>

      {/* Main Panel */}
      <main className="hp-ccc-main">
        {/* Top search & user row */}
        <div className="hp-ccc-topbar">
          <div className="hp-ccc-search-box">
            <FiSearch className="hp-ccc-search-icon" />
            <input
              type="text"
              readOnly
              value=""
              placeholder="Search controls, evidence, risks..."
              className="hp-ccc-search-input"
            />
          </div>
          <div className="hp-ccc-user-menu">
            <span className="hp-ccc-user-name">Acme Technologies</span>
            <FiChevronDown className="hp-ccc-chevron" />
            <div className="hp-ccc-avatar">A</div>
          </div>
        </div>

        {/* Section Header */}
        <div className="hp-ccc-header-row">
          <h3 className="hp-ccc-heading">Compliance Overview</h3>
          <button className="hp-ccc-filter-btn">
            <span>Last 30 days</span>
            <FiChevronDown />
          </button>
        </div>

        {/* 4 Metric KPI Cards */}
        <div className="hp-ccc-kpi-grid">
          <div className="hp-ccc-kpi-card">
            <div className="hp-ccc-kpi-icon hp-kpi-blue">
              <FiLayers />
            </div>
            <div className="hp-ccc-kpi-info">
              <span className="hp-ccc-kpi-label">Frameworks</span>
              <strong className="hp-ccc-kpi-val">13</strong>
            </div>
          </div>

          <div className="hp-ccc-kpi-card">
            <div className="hp-ccc-kpi-icon hp-kpi-teal">
              <FiCheckSquare />
            </div>
            <div className="hp-ccc-kpi-info">
              <span className="hp-ccc-kpi-label">Controls</span>
              <strong className="hp-ccc-kpi-val">342</strong>
            </div>
          </div>

          <div className="hp-ccc-kpi-card">
            <div className="hp-ccc-kpi-icon hp-kpi-green">
              <FiCheckCircle />
            </div>
            <div className="hp-ccc-kpi-info">
              <span className="hp-ccc-kpi-label">Compliant</span>
              <strong className="hp-ccc-kpi-val">78%</strong>
            </div>
          </div>

          <div className="hp-ccc-kpi-card">
            <div className="hp-ccc-kpi-icon hp-kpi-red">
              <FiAlertTriangle />
            </div>
            <div className="hp-ccc-kpi-info">
              <span className="hp-ccc-kpi-label">Open Items</span>
              <strong className="hp-ccc-kpi-val">56</strong>
            </div>
          </div>
        </div>

        {/* 2 Chart Panels */}
        <div className="hp-ccc-charts-row">
          {/* Posture Trend */}
          <div className="hp-ccc-chart-box">
            <div className="hp-ccc-box-head">
              <span className="hp-ccc-box-title">Compliance Posture Trend</span>
              <span className="hp-ccc-badge-green">70% Compliant</span>
            </div>
            <div className="hp-ccc-trend-visual">
              <div className="hp-ccc-y-axis">
                <span>100%</span>
                <span>75%</span>
                <span>50%</span>
                <span>25%</span>
                <span>0%</span>
              </div>
              <div className="hp-ccc-svg-wrap">
                <svg viewBox="0 0 240 100" className="hp-ccc-svg-chart" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="postureGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#00b4d8" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#00b4d8" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>
                  {/* Grid Lines */}
                  <line x1="0" y1="10" x2="240" y2="10" stroke="rgba(150,160,180,0.15)" />
                  <line x1="0" y1="32" x2="240" y2="32" stroke="rgba(150,160,180,0.15)" />
                  <line x1="0" y1="55" x2="240" y2="55" stroke="rgba(150,160,180,0.15)" />
                  <line x1="0" y1="78" x2="240" y2="78" stroke="rgba(150,160,180,0.15)" />
                  <line x1="0" y1="95" x2="240" y2="95" stroke="rgba(150,160,180,0.2)" />

                  {/* Area fill */}
                  <path
                    d="M 10,75 C 50,72 80,60 120,48 C 160,35 200,30 230,28 L 230,95 L 10,95 Z"
                    fill="url(#postureGrad)"
                  />
                  {/* Line */}
                  <path
                    d="M 10,75 C 50,72 80,60 120,48 C 160,35 200,30 230,28"
                    fill="none"
                    stroke="#00b4d8"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                  {/* Highlight dots */}
                  <circle cx="10" cy="75" r="3" fill="#00b4d8" />
                  <circle cx="55" cy="70" r="3" fill="#00b4d8" />
                  <circle cx="100" cy="54" r="3" fill="#00b4d8" />
                  <circle cx="145" cy="42" r="3" fill="#00b4d8" />
                  <circle cx="190" cy="32" r="3" fill="#00b4d8" />
                  <circle cx="230" cy="28" r="4" fill="#10b981" stroke="#ffffff" strokeWidth="1.5" />
                </svg>
                <div className="hp-ccc-x-axis">
                  <span>Jan</span>
                  <span>Feb</span>
                  <span>Mar</span>
                  <span>Apr</span>
                  <span>May</span>
                  <span>Jun</span>
                </div>
              </div>
            </div>
          </div>

          {/* Framework Coverage */}
          <div className="hp-ccc-chart-box">
            <div className="hp-ccc-box-head">
              <span className="hp-ccc-box-title">Framework Coverage</span>
            </div>
            <div className="hp-ccc-donut-layout">
              <div className="hp-ccc-donut-container">
                <svg viewBox="0 0 36 36" className="hp-ccc-donut-svg">
                  {/* Gray background track */}
                  <circle
                    cx="18"
                    cy="18"
                    r="15.9155"
                    fill="transparent"
                    stroke="#f1f5f9"
                    strokeWidth="4"
                  />
                  {/* Compliant segment (78%) */}
                  <circle
                    cx="18"
                    cy="18"
                    r="15.9155"
                    fill="transparent"
                    stroke="#00b4d8"
                    strokeWidth="4.2"
                    strokeDasharray="78 22"
                    strokeDashoffset="25"
                    strokeLinecap="round"
                  />
                  {/* In Progress segment (15%) */}
                  <circle
                    cx="18"
                    cy="18"
                    r="15.9155"
                    fill="transparent"
                    stroke="#fbbf24"
                    strokeWidth="4.2"
                    strokeDasharray="15 85"
                    strokeDashoffset="-53"
                    strokeLinecap="round"
                  />
                  {/* Not Compliant segment (7%) */}
                  <circle
                    cx="18"
                    cy="18"
                    r="15.9155"
                    fill="transparent"
                    stroke="#f87171"
                    strokeWidth="4.2"
                    strokeDasharray="7 93"
                    strokeDashoffset="-68"
                    strokeLinecap="round"
                  />
                </svg>
                <div className="hp-ccc-donut-center">
                  <strong>78%</strong>
                </div>
              </div>

              <div className="hp-ccc-donut-legend">
                <div className="hp-ccc-legend-item">
                  <span className="hp-legend-dot dot-blue" />
                  <span className="hp-legend-name">Compliant</span>
                  <span className="hp-legend-pct">78%</span>
                </div>
                <div className="hp-ccc-legend-item">
                  <span className="hp-legend-dot dot-yellow" />
                  <span className="hp-legend-name">In Progress</span>
                  <span className="hp-legend-pct">15%</span>
                </div>
                <div className="hp-ccc-legend-item">
                  <span className="hp-legend-dot dot-red" />
                  <span className="hp-legend-name">Not Compliant</span>
                  <span className="hp-legend-pct">7%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
