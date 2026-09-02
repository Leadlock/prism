import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, apiDownload } from "../api/client.js";
import { BarChart, DonutChart, StackedBarChart } from "../components/Charts.jsx";
import {
  GRID_COLS, ROW_PX, GRID_MARGIN,
  buildLayout, moveItem, resizeItem,
  layoutRows, itemBox, colWidth, pxToCell,
} from "../utils/gridLayout.js";
import ExportMenu from "../components/ExportMenu.jsx";
import Logo from "../components/Logo";
import NotificationBell from "../components/NotificationBell.jsx";

const WIDGET_DEFS = [
  { id: "maturity-dist",      cls: "dash-card dash-card-wide" },
  { id: "module-bar",         cls: "dash-card dash-card-wide" },
  { id: "module-donuts",      cls: "",          style: { gridColumn: "1 / -1" } },
  { id: "answer-dist",        cls: "dash-card" },
  { id: "evidence-coverage",  cls: "dash-card dash-card-wide" },
  { id: "action-status",      cls: "dash-card" },
  { id: "evidence-requests",  cls: "dash-card" },
  { id: "evidence-vault",     cls: "dash-card" },
  { id: "score-eligible",     cls: "dash-card" },
  { id: "automated-coverage", cls: "dash-card" },
  { id: "notes-coverage",     cls: "dash-card" },
  { id: "recently-reviewed",  cls: "dash-card dash-card-wide" },
  { id: "rejected-controls",  cls: "dash-card dash-card-wide" },
];
const DEFAULT_WIDGET_ORDER = WIDGET_DEFS.map(w => w.id);

// Health tone for a 0–100 ratio: teal/green healthy, amber mid, red low.
const toneFor = (pct) =>
  pct >= 75 ? "var(--green)" : pct >= 45 ? "var(--dp-accent)" : pct >= 20 ? "var(--amber)" : "var(--red)";

// The leading-edge data-rule value + colour for a widget. Panels that aren't a
// single ratio return null and the rule stays a quiet hairline.
function ruleFor(id, s) {
  if (!s) return null;
  const ratio = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
  switch (id) {
    case "maturity-dist": {
      const m = s.maturityDistribution || {};
      const n = (m.l1 || 0) + (m.l2 || 0) + (m.l3 || 0) + (m.l4 || 0) + (m.l5 || 0);
      const score = n > 0 ? ((m.l1 || 0) + 2 * (m.l2 || 0) + 3 * (m.l3 || 0) + 4 * (m.l4 || 0) + 5 * (m.l5 || 0)) / n : 0;
      return { pct: Math.round((score / 5) * 100) };
    }
    case "module-bar": return { pct: ratio(s.overall?.finished || 0, s.overall?.total || 0) };
    case "answer-dist": {
      const get = (a) => s.answerDistribution?.find((x) => x.answer === a)?.count || 0;
      const assessed = s.overall?.assessed || 0;
      return { pct: ratio(get("IMPLEMENTED") + get("NOT_APPLICABLE") + 0.5 * get("PARTIALLY_IMPLEMENTED"), assessed) };
    }
    case "evidence-coverage": {
      const cov = (s.evidenceCoverage || []).reduce((t, e) => t + (e.covered || 0), 0);
      const tot = (s.evidenceCoverage || []).reduce((t, e) => t + (e.total || 0), 0);
      return { pct: ratio(cov, tot) };
    }
    case "score-eligible": return { pct: ratio(s.scoreEligible?.count || 0, s.scoreEligible?.total || 0) };
    case "automated-coverage": return { pct: ratio(s.automatedCoverage?.count || 0, s.automatedCoverage?.total || 0) };
    case "notes-coverage": {
      const nm = s.notesMetrics || {};
      const withAny = (nm.withNotes || 0) + (nm.withReviewerNotes || 0);
      return { pct: ratio(withAny, withAny + (nm.withoutAnyNotes || 0)) };
    }
    case "rejected-controls":
      return (s.rejectedControls || []).length > 0
        ? { pct: 100, color: "var(--red)" }
        : { pct: 100, color: "var(--green)" };
    default:
      return null;
  }
}

// One-shot count-up for the standing headline. Honours reduced-motion.
function CountUp({ value, suffix = "", duration = 700 }) {
  const [n, setN] = useState(() =>
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? value : 0
  );
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setN(value); return; }
    let raf;
    const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / duration);
      setN(Math.round((1 - Math.pow(1 - p, 3)) * value));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{n}{suffix}</>;
}

const AVG_MATURITY_LABEL = ["not yet rated", "L1 — Ad-hoc", "L2 — Repeatable", "L3 — Defined", "L4 — Managed", "L5 — Optimised"];

export default function Dashboard({ token, user, company, onLogout, theme, onThemeToggle, isVerified }) {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedModule, setSelectedModule] = useState(null);
  const [moduleData, setModuleData] = useState(null);
  const [moduleError, setModuleError] = useState("");
  const [loadingModule, setLoadingModule] = useState(false);
  const [auditorNotesModal, setAuditorNotesModal] = useState(null);
  const auditorNotesRef = useRef("");
  const [reviewLockedOpen, setReviewLockedOpen] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [dashPriorityFilter, setDashPriorityFilter] = useState("");
  const [dashTagFilter, setDashTagFilter] = useState("");
  const [dashOwnerFilter, setDashOwnerFilter] = useState("");
  const [dashStatusFilter, setDashStatusFilter] = useState("");
  const [dashFramework, setDashFramework] = useState("");
  const [frameworks, setFrameworks] = useState([]);
  const [availableTags, setAvailableTags] = useState([]);
  const [availableOwners, setAvailableOwners] = useState([]);

  // Widget drag-and-drop order (persisted to localStorage)
  const [widgetOrder, setWidgetOrder] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("prism-widget-order") || "null");
      if (!saved) return DEFAULT_WIDGET_ORDER;
      const merged = saved.filter(id => DEFAULT_WIDGET_ORDER.includes(id));
      DEFAULT_WIDGET_ORDER.forEach(id => { if (!merged.includes(id)) merged.push(id); });
      return merged;
    } catch { return DEFAULT_WIDGET_ORDER; }
  });
  const [dashMenuOpen, setDashMenuOpen] = useState(false);
  const [dashFiltersOpen, setDashFiltersOpen] = useState(false);

  // ── Dashboard layout engine — 12-col grid, absolute-positioned + animated ──
  const defaultW = (id) => {
    const def = WIDGET_DEFS.find((w) => w.id === id);
    if (def?.style?.gridColumn === "1 / -1" || id === "module-donuts") return 12;
    if ((def?.cls || "").includes("dash-card-wide")) return 8;
    return 4;
  };
  const [savedLayout, setSavedLayout] = useState(() => {
    try { return JSON.parse(localStorage.getItem("prism-widget-layout") || "{}") || {}; }
    catch { return {}; }
  });
  const [heights, setHeights] = useState({});        // measured content height per id (row units)
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 820px)").matches
  );
  const [gridW, setGridW] = useState(0);             // grid container inner width (px)
  const [editLayout, setEditLayout] = useState(false);
  // live gesture state: { id, mode: "move"|"e"|"s"|"se", items } — items is the working layout
  const [gesture, setGesture] = useState(null);

  const gridRef = useRef(null);
  const contentRefs = useRef(new Map());
  const roRef = useRef(null);
  const itemsRef = useRef([]);
  const gestureRef = useRef(null);
  useEffect(() => { gestureRef.current = gesture; }, [gesture]);

  const saveOrder = (next) => {
    setWidgetOrder(next);
    try { localStorage.setItem("prism-widget-order", JSON.stringify(next)); } catch {}
  };

  const persist = (items) => {
    const map = {};
    for (const it of items) map[it.id] = { x: it.x, y: it.y, w: it.w, h: it.h };
    setSavedLayout(map);
    try { localStorage.setItem("prism-widget-layout", JSON.stringify(map)); } catch {}
  };

  const resetLayout = () => {
    saveOrder(DEFAULT_WIDGET_ORDER);
    setSavedLayout({});
    setHeights({});
    try { localStorage.removeItem("prism-widget-layout"); } catch {}
  };

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 820px)");
    const h = (e) => setNarrow(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);

  // Track the grid's inner width so px geometry stays in sync with the viewport.
  useEffect(() => {
    if (narrow || !gridRef.current) return;
    const el = gridRef.current;
    const ro = new ResizeObserver(() => setGridW(el.clientWidth));
    ro.observe(el);
    setGridW(el.clientWidth);
    return () => ro.disconnect();
  }, [narrow, stats]);

  // Measure each widget's natural content height → row units (only used until the
  // user resizes that widget, after which the saved height wins).
  useEffect(() => {
    const ro = new ResizeObserver((entries) => {
      setHeights((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const entry of entries) {
          const id = entry.target.dataset.wid;
          if (!id) continue;
          // .dash-card-measure flows at natural height incl. its own 18px padding;
          // + slack (card border + rounding) so a widget's row-span never clips
          // its content — there are no scrollbars inside widgets.
          const rows = Math.max(5, Math.ceil((entry.target.offsetHeight + 22) / (ROW_PX + GRID_MARGIN)));
          if ((next[id] ?? 0) !== rows) { next[id] = rows; changed = true; }
        }
        return changed ? next : prev;
      });
    });
    roRef.current = ro;
    for (const el of contentRefs.current.values()) ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Stable ref callback per widget id (recreating it each render would make
  // React thrash observe/unobserve and drop height measurements).
  const refCbs = useRef(new Map());
  const setContentRef = (id) => {
    if (!refCbs.current.has(id)) {
      refCbs.current.set(id, (el) => {
        const map = contentRefs.current;
        if (el) {
          el.dataset.wid = id;
          map.set(id, el);
          roRef.current?.observe(el);
        } else {
          const prev = map.get(id);
          if (prev) roRef.current?.unobserve(prev);
          map.delete(id);
        }
      });
    }
    return refCbs.current.get(id);
  };

  const colW = () => colWidth(gridW || (gridRef.current?.clientWidth ?? 1200));

  const startGesture = (e, id, mode) => {
    if (!editLayout || !gridRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const base = itemsRef.current.map((i) => ({ ...i }));
    const start = base.find((i) => i.id === id);
    if (!start) return;
    const cw = colW();
    const stride = cw + GRID_MARGIN;
    const rowStride = ROW_PX + GRID_MARGIN;
    const startBox = itemBox(start, cw);
    const px0 = { x: e.clientX, y: e.clientY };
    let working = base;

    const move = (ev) => {
      const rawDx = ev.clientX - px0.x;
      const rawDy = ev.clientY - px0.y;
      const dxCells = Math.round(rawDx / stride);
      const dyCells = Math.round(rawDy / rowStride);
      if (mode === "move") {
        working = moveItem(base, id, start.x + dxCells, start.y + dyCells);
        itemsRef.current = working;
        setGesture({ id, mode, items: working, ghost: { left: startBox.left + rawDx, top: startBox.top + rawDy } });
      } else {
        const w = mode === "s" ? start.w : start.w + dxCells;
        const h = mode === "e" ? start.h : start.h + dyCells;
        working = resizeItem(base, id, w, h, heights[id] || 5);
        itemsRef.current = working;
        setGesture({ id, mode, items: working });
      }
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      persist(working);
      setGesture(null);
    };
    setGesture({ id, mode, items: base });
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  };

  const generateMonthOptions = () => {
    const options = [];
    for (let year = new Date().getFullYear() + 1; year >= 2023; year--) {
      for (let month = 12; month >= 1; month--) {
        options.push(`${year}-${String(month).padStart(2, '0')}`);
      }
    }
    return options;
  };

  // Load filter options (tags, owners) from the sheet once on mount
  useEffect(() => {
    apiFetch("/api/questions", { token })
      .then(qs => {
        const tags = new Set();
        const owners = new Set();
        for (const q of qs || []) {
          if (q.tags) q.tags.split(",").forEach(t => { const s = t.trim(); if (s) tags.add(s); });
          if (q.defaultOwner || q.default_owner) owners.add(q.defaultOwner || q.default_owner);
        }
        setAvailableTags([...tags].sort());
        setAvailableOwners([...owners].sort());
      })
      .catch(() => {});
  }, [token]);

  // The compliance frameworks this company has activated (drives the scope switch)
  useEffect(() => {
    apiFetch("/api/frameworks/mine", { token })
      .then(fw => setFrameworks(Array.isArray(fw) ? fw : []))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    let url = `/api/dashboard?month=${selectedMonth}`;
    if (dashFramework) url += `&framework=${encodeURIComponent(dashFramework)}`;
    if (dashPriorityFilter) url += `&priority=${encodeURIComponent(dashPriorityFilter)}`;
    if (dashTagFilter) url += `&tag=${encodeURIComponent(dashTagFilter)}`;
    if (dashOwnerFilter) url += `&owner=${encodeURIComponent(dashOwnerFilter)}`;
    if (dashStatusFilter) url += `&status=${encodeURIComponent(dashStatusFilter)}`;
    apiFetch(url, { token })
      .then(data => { if (active) { setStats(data); setLoading(false); } })
      .catch(err => { if (active) { setError(err.message); setLoading(false); } });
    return () => { active = false; };
  }, [token, selectedMonth, dashFramework, dashPriorityFilter, dashTagFilter, dashOwnerFilter, dashStatusFilter]);

  const isAdmin       = user?.role === "ADMIN";
  const isLeadOrAdmin = user?.role === "ADMIN" || user?.role === "LEAD";
  const isAuditor     = user?.role === "AUDITOR";

  const openModule = async (module) => {
    setSelectedModule(module);
    setModuleData(null);
    setModuleError("");
    setLoadingModule(true);
    try {
      const [questions, assessments, evidence] = await Promise.all([
        apiFetch(`/api/questions?moduleId=${encodeURIComponent(module.moduleId)}`, { token }),
        apiFetch(`/api/assessments?moduleId=${encodeURIComponent(module.moduleId)}&month=${selectedMonth}`, { token }),
        apiFetch(`/api/evidence?moduleId=${encodeURIComponent(module.moduleId)}&month=${selectedMonth}`, { token })
      ]);
      setModuleData({
        questions:   questions   || [],
        assessments: assessments || [],
        evidence:    evidence    || [],
      });
    } catch (err) {
      setModuleError(err.message || "Failed to load module data");
    } finally {
      setLoadingModule(false);
    }
  };

  const closeModule = () => {
    setSelectedModule(null);
    setModuleData(null);
    setModuleError("");
  };

  const promptAuditorApproval = (assessmentId, status) => {
    auditorNotesRef.current = "";
    setAuditorNotesModal({ assessmentId, status });
  };

  const confirmAuditorApproval = async () => {
    const { assessmentId, status } = auditorNotesModal;
    const notes = auditorNotesRef.current;
    setAuditorNotesModal(null);
    await updateAssessmentStatus(assessmentId, status, notes);
  };

  const updateAssessmentStatus = async (assessmentId, status, auditorNotes) => {
    const moduleId = selectedModule?.moduleId;
    try {
      const response = await apiFetch(`/api/assessments/${assessmentId}`, {
        token,
        method: "PUT",
        body: JSON.stringify({
          reviewStatus: status,
          auditedBy: user?.email,
          auditorNotes: auditorNotes || undefined
        })
      });

      if (!response) throw new Error("Failed to update assessment");

      const [questions, assessments, evidence] = await Promise.all([
        apiFetch(`/api/questions?moduleId=${encodeURIComponent(moduleId)}`, { token }),
        apiFetch(`/api/assessments?moduleId=${encodeURIComponent(moduleId)}&month=${selectedMonth}`, { token }),
        apiFetch(`/api/evidence?moduleId=${encodeURIComponent(moduleId)}&month=${selectedMonth}`, { token })
      ]);
      setModuleData({
        questions:   questions   || [],
        assessments: assessments || [],
        evidence:    evidence    || []
      });

      const dashData = await apiFetch(`/api/dashboard?month=${selectedMonth}`, { token });
      setStats(dashData);
    } catch (err) {
      setError(err.message);
    }
  };

  const viewEvidence = async (id, filename) => {
    try {
      const endpoint = isAuditor ? `/api/evidence/${id}/view` : `/api/evidence/${id}/download`;
      const res = await fetch(apiDownload(endpoint), {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`Failed to load file (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      alert(`Error viewing file: ${e.message}`);
      setError(e.message || "Failed to view file");
    }
  };

  const renderWidget = (id) => {
    if (!stats) return null;

    switch (id) {

      case "maturity-dist": {
        const md = stats.maturityDistribution || {};
        const levels = [
          { key: "l1", label: "L1 — Ad-hoc",     color: "var(--red)" },
          { key: "l2", label: "L2 — Repeatable",  color: "var(--amber)" },
          { key: "l3", label: "L3 — Defined",     color: "var(--teal)" },
          { key: "l4", label: "L4 — Managed",     color: "var(--accent2)" },
          { key: "l5", label: "L5 — Optimised",   color: "var(--green)" },
        ];
        const total = levels.reduce((s, l) => s + (md[l.key] || 0), 0);
        const avg = total > 0
          ? (levels.reduce((s, l, i) => s + (i + 1) * (md[l.key] || 0), 0) / total)
          : 0;
        return (
          <>
            <div className="dash-card-title">
              Maturity distribution
              {total > 0 && <span className="dash-card-tag">avg L{avg.toFixed(1)}</span>}
            </div>
            {total === 0 ? (
              <p className="dash-empty">No maturity levels recorded this period.</p>
            ) : (
              <div className="dash-bars">
                {levels.map(({ key, label, color }) => {
                  const val = md[key] || 0;
                  const pct = Math.round((val / total) * 100);
                  return (
                    <div key={key} className="dash-bar-row">
                      <span className="dash-bar-label">{label}</span>
                      <span className="dash-bar-track">
                        <span className="dash-bar-fill" style={{ width: `${pct}%`, background: color }} />
                      </span>
                      <span className="dash-bar-val">{val}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        );
      }

      case "module-bar":
        return (
          <>
            <div className="dash-card-title">
              Per-module completion
              <span className="dash-card-tag">{stats.moduleCompletion.length} modules</span>
            </div>
            <div className="chart-legend-row">
              <span className="chart-legend-dot" style={{ background: "var(--green)" }} />
              <span style={{ fontSize: 11, color: "var(--dp-quiet)" }}>Signed off</span>
              <span className="chart-legend-dot" style={{ background: "var(--amber)", marginLeft: 12 }} />
              <span style={{ fontSize: 11, color: "var(--dp-quiet)" }}>Assessed</span>
            </div>
            <StackedBarChart
              data={stats.moduleCompletion.map(m => ({
                label: m.moduleId,
                finished: m.finished,
                assessed: m.assessed,
                total: m.total
              }))}
            />
          </>
        );

      case "module-donuts":
        return (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 16 }}>
            {stats.moduleCompletion.map((module, idx) => {
              const assessedNotFinished = Math.max(0, module.assessed - module.finished);
              const notStarted = Math.max(0, module.total - Math.max(module.assessed, module.finished));
              const pct = module.total > 0 ? Math.round((module.finished / module.total) * 100) : 0;
              return (
                <div
                  key={idx}
                  className="dash-card"
                  style={{ cursor: "pointer", margin: 0, "--rule": `${pct}%`, "--rule-color": toneFor(pct) }}
                  onClick={() => openModule(module)}
                >
                  <div className="dash-card-title">
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{module.name}</span>
                    <span className="dash-card-tag">{module.moduleId}</span>
                  </div>
                  <DonutChart
                    size={112}
                    centerValue={`${pct}%`}
                    centerCaption="signed off"
                    segments={[
                      { label: "Signed off",  value: module.finished,     color: "var(--green)" },
                      { label: "In progress", value: assessedNotFinished, color: "var(--amber)" },
                      { label: "Not started", value: notStarted,          color: "var(--dp-surface-2)" }
                    ]}
                  />
                  <div style={{ marginTop: 12, fontSize: 11, color: "var(--dp-quiet)", textAlign: "center" }}>
                    {module.finished} of {module.total} controls
                  </div>
                </div>
              );
            })}
          </div>
        );

      case "answer-dist": {
        const answered = (a) => stats.answerDistribution.find(x => x.answer === a)?.count || 0;
        return (
          <>
            <div className="dash-card-title">
              Answer mix
              <span className="dash-card-tag">{stats.overall.assessed} assessed</span>
            </div>
            <DonutChart
              centerValue={answered("IMPLEMENTED")}
              centerCaption="impl."
              size={132}
              segments={[
                { label: "Implemented",        value: stats.answerDistribution.find(a => a.answer === "IMPLEMENTED")?.count || 0,           color: "var(--green)" },
                { label: "Not Implemented",    value: stats.answerDistribution.find(a => a.answer === "NOT_IMPLEMENTED")?.count || 0,       color: "var(--red)" },
                { label: "Partial",            value: stats.answerDistribution.find(a => a.answer === "PARTIALLY_IMPLEMENTED")?.count || 0, color: "var(--amber)" },
                { label: "Planned",            value: stats.answerDistribution.find(a => a.answer === "PLANNED")?.count || 0,               color: "var(--dp-accent)" },
                { label: "Not Applicable",     value: stats.answerDistribution.find(a => a.answer === "NOT_APPLICABLE")?.count || 0,        color: "var(--dp-quiet)" }
              ]}
            />
          </>
        );
      }

      case "evidence-coverage": {
        const cov = stats.evidenceCoverage.reduce((t, e) => t + (e.covered || 0), 0);
        const tot = stats.evidenceCoverage.reduce((t, e) => t + (e.total || 0), 0);
        return (
          <>
            <div className="dash-card-title">
              Evidence coverage
              <span className="dash-card-tag">{cov} of {tot} controls</span>
            </div>
            <BarChart
              data={stats.evidenceCoverage.map(e => ({ label: e.moduleId, value: e.covered, total: e.total }))}
              valueKey="value"
              labelKey="label"
              color="var(--dp-accent)"
              maxValue={Math.max(...stats.evidenceCoverage.map(e => e.total), 1)}
            />
          </>
        );
      }

      case "action-status":
        return (
          <>
            <div className="dash-card-title">Action status</div>
            {stats.actionStatus.length === 0 ? (
              <p className="dash-empty">No remediation actions yet.</p>
            ) : (
              <BarChart
                data={stats.actionStatus.map(a => ({
                  label: (a.status || "OPEN").replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()),
                  value: a.count,
                }))}
                valueKey="value"
                labelKey="label"
                color="var(--dp-accent)"
              />
            )}
          </>
        );

      case "evidence-requests":
        if (!stats.requestMetrics) return null;
        return (
          <div onClick={() => navigate("/requests")} style={{ cursor: "pointer" }}>
            <div className="dash-card-title">
              Evidence requests
              <span className="dash-card-tag">tap to open</span>
            </div>
            <div className="dash-kpi-row">
              <div className="dash-kpi">
                <div className="dash-kpi-val" style={{ color: "var(--dp-accent)" }}>{stats.requestMetrics.open}</div>
                <div className="dash-kpi-label">Open</div>
              </div>
              <div className="dash-kpi">
                <div className="dash-kpi-val" style={{ color: "var(--red)" }}>{stats.requestMetrics.overdue}</div>
                <div className="dash-kpi-label">Overdue</div>
              </div>
              <div className="dash-kpi">
                <div className="dash-kpi-val" style={{ color: "var(--green)" }}>{stats.requestMetrics.completed}</div>
                <div className="dash-kpi-label">Completed</div>
              </div>
            </div>
            {stats.requestMetrics.byUser?.length > 0 && (
              <div style={{ marginTop: 12, borderTop: "1px solid var(--dp-line)", paddingTop: 10 }}>
                <div style={{ fontSize: 11, color: "var(--dp-quiet)", marginBottom: 6, fontWeight: 600 }}>By assignee</div>
                {stats.requestMetrics.byUser.map((u, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: "var(--dp-quiet)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "80%" }}>{u.name}</span>
                    <span style={{ color: "var(--dp-ink)", fontFamily: "var(--mono)", flexShrink: 0 }}>{u.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );

      case "evidence-vault":
        if (!stats.vaultMetrics) return null;
        return (
          <div onClick={() => navigate("/vault")} style={{ cursor: "pointer" }}>
            <div className="dash-card-title">
              Evidence vault
              <span className="dash-card-tag">tap to open</span>
            </div>
            <div className="dash-kpi-row">
              <div className="dash-kpi">
                <div className="dash-kpi-val" style={{ color: "var(--teal)" }}>{stats.vaultMetrics.totalVersions}</div>
                <div className="dash-kpi-label">Total versions</div>
              </div>
              <div className="dash-kpi">
                <div className="dash-kpi-val" style={{ color: "var(--dp-accent)" }}>{stats.vaultMetrics.updatedThisMonth}</div>
                <div className="dash-kpi-label">Updated this month</div>
              </div>
            </div>
            {stats.vaultMetrics.latestModifiedTitle && (
              <div style={{ marginTop: 12, borderTop: "1px solid var(--dp-line)", paddingTop: 10 }}>
                <div style={{ fontSize: 11, color: "var(--dp-quiet)", marginBottom: 4, fontWeight: 600 }}>Last modified</div>
                <div style={{ fontSize: 12, color: "var(--dp-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{stats.vaultMetrics.latestModifiedTitle}</div>
                {stats.vaultMetrics.latestModifiedAt && (
                  <div style={{ fontSize: 11, color: "var(--dp-quiet)", marginTop: 2 }}>
                    {new Date(stats.vaultMetrics.latestModifiedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </div>
                )}
              </div>
            )}
          </div>
        );

      case "score-eligible": {
        if (stats.scoreEligible === undefined) return null;
        const pct = stats.scoreEligible.total > 0
          ? Math.round((stats.scoreEligible.count / stats.scoreEligible.total) * 100) : 0;
        return (
          <>
            <div className="dash-card-title">
              Score-eligible controls
              <span className="dash-card-tag">{pct}%</span>
            </div>
            <div className="dash-figure">
              <DonutChart
                segments={[
                  { label: "Eligible", value: stats.scoreEligible.count, color: "var(--green)" },
                  { label: "Other",    value: Math.max(0, stats.scoreEligible.total - stats.scoreEligible.count), color: "var(--dp-surface-2)" }
                ]}
                size={92}
                centerValue={`${pct}%`}
                centerCaption="eligible"
              />
              <div>
                <div className="dash-figure-val">{stats.scoreEligible.count}</div>
                <div className="dash-figure-label">of {stats.scoreEligible.total} controls scored</div>
              </div>
            </div>
          </>
        );
      }

      case "automated-coverage": {
        if (stats.automatedCoverage === undefined) return null;
        const pct = stats.automatedCoverage.total > 0
          ? Math.round((stats.automatedCoverage.count / stats.automatedCoverage.total) * 100) : 0;
        return (
          <>
            <div className="dash-card-title">
              Automated coverage
              <span className="dash-card-tag">{pct}%</span>
            </div>
            <div className="dash-figure">
              <DonutChart
                segments={[
                  { label: "Automated", value: stats.automatedCoverage.count, color: "var(--dp-accent)" },
                  { label: "Other",     value: Math.max(0, stats.automatedCoverage.total - stats.automatedCoverage.count), color: "var(--dp-surface-2)" }
                ]}
                size={92}
                centerValue={`${pct}%`}
                centerCaption="automated"
              />
              <div>
                <div className="dash-figure-val">{stats.automatedCoverage.count}</div>
                <div className="dash-figure-label">of {stats.automatedCoverage.total} controls automated</div>
              </div>
            </div>
          </>
        );
      }

      case "notes-coverage":
        if (!stats.notesMetrics) return null;
        return (
          <>
            <div className="dash-card-title">Notes coverage</div>
            <div className="dash-kpi-row">
              <div className="dash-kpi">
                <div className="dash-kpi-val" style={{ color: "var(--teal)" }}>{stats.notesMetrics.withNotes}</div>
                <div className="dash-kpi-label">Internal notes</div>
              </div>
              <div className="dash-kpi">
                <div className="dash-kpi-val" style={{ color: "var(--amber)" }}>{stats.notesMetrics.withReviewerNotes}</div>
                <div className="dash-kpi-label">Reviewer notes</div>
              </div>
              <div className="dash-kpi">
                <div className="dash-kpi-val" style={{ color: "var(--dp-quiet)" }}>{stats.notesMetrics.withoutAnyNotes}</div>
                <div className="dash-kpi-label">No notes</div>
              </div>
            </div>
          </>
        );

      case "recently-reviewed": {
        const items = stats.recentlyReviewed || [];
        if (items.length === 0) return null;
        const fmtTime = (iso) => {
          if (!iso) return "";
          const diff = Date.now() - new Date(iso).getTime();
          const mins = Math.floor(diff / 60000);
          if (mins < 60) return `${mins}m ago`;
          const hrs = Math.floor(mins / 60);
          if (hrs < 24) return `${hrs}h ago`;
          return `${Math.floor(hrs / 24)}d ago`;
        };
        return (
          <>
            <div className="dash-card-title">
              Recent reviews
              <span className="dash-card-tag">{items.length} this month</span>
            </div>
            <div className="dash-list">
              {items.map(item => {
                const approved = item.reviewStatus === "FINISHED";
                return (
                  <div
                    key={item.id}
                    className="dash-list-row"
                    style={{ "--row-tone": approved ? "var(--green)" : "var(--amber)" }}
                  >
                    <span style={{ flexShrink: 0, color: approved ? "var(--green)" : "var(--amber)" }}>
                      {approved ? "✓" : "•"}
                    </span>
                    <span className="dash-list-code">{item.questId}</span>
                    <span className="dash-list-main">{item.controlArea || item.moduleId}</span>
                    <span className="dash-list-meta">{item.reviewedBy?.split("@")[0]}</span>
                    <span className="dash-list-meta">{fmtTime(item.reviewedAt)}</span>
                  </div>
                );
              })}
            </div>
          </>
        );
      }

      case "rejected-controls": {
        const items = stats.rejectedControls || [];
        const fmtTime = (iso) => {
          if (!iso) return "";
          const diff = Date.now() - new Date(iso).getTime();
          const mins = Math.floor(diff / 60000);
          if (mins < 60) return `${mins}m ago`;
          const hrs = Math.floor(mins / 60);
          if (hrs < 24) return `${hrs}h ago`;
          return `${Math.floor(hrs / 24)}d ago`;
        };
        return (
          <>
            <div className="dash-card-title">
              Rejected controls
              <span className="dash-card-tag" style={items.length > 0 ? { color: "var(--red)" } : undefined}>
                {items.length > 0 ? `${items.length} to rework` : "all clear"}
              </span>
            </div>
            {items.length === 0 ? (
              <p className="dash-empty" style={{ color: "var(--green)" }}>
                <span>✓</span> Nothing sent back this cycle.
              </p>
            ) : (
              <div className="dash-list">
                {items.map(item => {
                  const byAuditor = item.auditorNotes && item.auditorNotes.trim();
                  const rejectorEmail = byAuditor ? item.auditedBy : item.reviewedBy;
                  const rejectorLabel = byAuditor ? "Auditor" : "Reviewer";
                  const reason = byAuditor ? item.auditorNotes : item.reviewerNotes;
                  const rejectedAt = byAuditor ? item.auditedAt : item.reviewedAt;
                  return (
                    <div
                      key={item.id}
                      className="dash-list-row"
                      style={{ "--row-tone": "var(--red)", flexDirection: "column", alignItems: "stretch", gap: 5, cursor: "pointer" }}
                      onClick={(e) => { e.stopPropagation(); navigate(`/tracker?quest=${encodeURIComponent(item.questId)}`); }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="dash-list-code" style={{ color: "var(--red)" }}>{item.questId}</span>
                        <span className="dash-list-main" style={{ fontWeight: 600 }}>{item.controlArea}</span>
                        <span className="dash-list-meta" style={{ fontFamily: "var(--mono)", fontSize: 10 }}>{rejectorLabel}</span>
                        {rejectedAt && <span className="dash-list-meta">{fmtTime(rejectedAt)}</span>}
                      </div>
                      {reason && (
                        <div style={{ fontSize: 12, color: "var(--dp-quiet)", lineHeight: 1.5 }}>
                          <span style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
                            {rejectorEmail?.split("@")[0] || rejectorLabel}:{" "}
                          </span>
                          {reason}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        );
      }

      default:
        return null;
    }
  };

  const activeFilterCount = [dashStatusFilter, dashPriorityFilter, dashOwnerFilter, dashTagFilter].filter(Boolean).length;
  const clearDashFilters = () => { setDashTagFilter(""); setDashPriorityFilter(""); setDashOwnerFilter(""); setDashStatusFilter(""); };

  // ── Audit-standing hero (derived, read-only) ──
  const pctOf = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
  const monthLabel = new Date(selectedMonth + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const activeFramework = frameworks.find((f) => f.key === dashFramework);
  const frameworkLabel = activeFramework
    ? activeFramework.name
    : frameworks.length === 1
      ? frameworks[0].name
      : frameworks.length > 1
        ? "All frameworks"
        : "Compliance workspace";
  const o = stats?.overall || { total: 0, assessed: 0, finished: 0 };
  const inProgress = Math.max(0, o.assessed - o.finished);
  const notStarted = Math.max(0, o.total - Math.max(o.assessed, o.finished));
  const signedOffPct = pctOf(o.finished, o.total);
  const md = stats?.maturityDistribution || {};
  const mdN = (md.l1 || 0) + (md.l2 || 0) + (md.l3 || 0) + (md.l4 || 0) + (md.l5 || 0);
  const avgMat = mdN > 0
    ? ((md.l1 || 0) + 2 * (md.l2 || 0) + 3 * (md.l3 || 0) + 4 * (md.l4 || 0) + 5 * (md.l5 || 0)) / mdN
    : 0;
  const avgMatLabel = AVG_MATURITY_LABEL[Math.round(avgMat)] || "not yet rated";
  const evCov = (stats?.evidenceCoverage || []).reduce((t, e) => t + (e.covered || 0), 0);
  const evTot = (stats?.evidenceCoverage || []).reduce((t, e) => t + (e.total || 0), 0);
  const openActions = (stats?.actionStatus || [])
    .filter((a) => !["DONE", "CLOSED", "COMPLETED"].includes(a.status))
    .reduce((t, a) => t + (a.count || 0), 0);
  const overdue = stats?.overdueQuestions || 0;

  return (
    <div className="dash-shell fade-in" id="print-area">
      <div className="dash-header no-print">
        <div className="dash-brand">
          <div className="dash-brand-logo">
            <Logo style={{ height: 82, display: "block", transform: "scale(0.46)", transformOrigin: "left center" }} />
          </div>
          {company?.name && (
            <>
              <div className="dash-brand-rule" />
              <div className="dash-brand-text">
                <span className="dash-brand-name">{company.name}</span>
                <span className="dash-brand-kicker">{frameworkLabel}</span>
              </div>
            </>
          )}
        </div>
        <div className="dash-header-actions">
          {/* Compliance scope — only when the company runs more than one framework */}
          {frameworks.length > 1 && (
            <select
              className="month-selector"
              value={dashFramework}
              onChange={(e) => setDashFramework(e.target.value)}
              title="Scope the dashboard to one compliance framework"
            >
              <option value="">All frameworks</option>
              {frameworks.map((f) => (
                <option key={f.key} value={f.key}>{f.name}</option>
              ))}
            </select>
          )}
          {/* Month */}
          <select className="month-selector" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}>
            {generateMonthOptions().map(month => (
              <option key={month} value={month}>
                {new Date(month + '-01').toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}
              </option>
            ))}
          </select>
          {/* Filters — collapsed into a popover */}
          <div style={{ position: "relative" }}>
            <button
              className={`btn ${activeFilterCount ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setDashFiltersOpen(v => !v)}
              title="Filter by status, priority, owner or tag"
            >
              ⚑ Filters{activeFilterCount ? ` · ${activeFilterCount}` : ""}
            </button>
            {dashFiltersOpen && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 1999 }} onClick={() => setDashFiltersOpen(false)} />
                <div style={{
                  position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 2000,
                  background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 10,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.18)", width: 244, padding: 14,
                  display: "flex", flexDirection: "column", gap: 10,
                }}>
                  <label className="dash-filter-field">
                    <span>Status</span>
                    <select className="month-selector" value={dashStatusFilter} onChange={(e) => setDashStatusFilter(e.target.value)}>
                      <option value="">All statuses</option>
                      <option value="IMPLEMENTED">Implemented</option>
                      <option value="PARTIALLY_IMPLEMENTED">Partially Implemented</option>
                      <option value="PLANNED">Planned</option>
                      <option value="NOT_IMPLEMENTED">Not Implemented</option>
                      <option value="NOT_APPLICABLE">Not Applicable</option>
                    </select>
                  </label>
                  <label className="dash-filter-field">
                    <span>Priority</span>
                    <select className="month-selector" value={dashPriorityFilter} onChange={(e) => setDashPriorityFilter(e.target.value)}>
                      <option value="">All priorities</option>
                      <option value="Critical">Critical</option>
                      <option value="High">High</option>
                      <option value="Medium">Medium</option>
                      <option value="Low">Low</option>
                    </select>
                  </label>
                  {availableOwners.length > 0 && (
                    <label className="dash-filter-field">
                      <span>Owner</span>
                      <select className="month-selector" value={dashOwnerFilter} onChange={(e) => setDashOwnerFilter(e.target.value)}>
                        <option value="">All owners</option>
                        {availableOwners.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </label>
                  )}
                  {availableTags.length > 0 && (
                    <label className="dash-filter-field">
                      <span>Tag</span>
                      <select className="month-selector" value={dashTagFilter} onChange={(e) => setDashTagFilter(e.target.value)}>
                        <option value="">All tags</option>
                        {availableTags.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </label>
                  )}
                  {activeFilterCount > 0 && (
                    <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={clearDashFilters}>
                      Clear all filters
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
          {/* Core actions */}
          <div className="dash-segment">
            <span className="dash-segment-btn active">Detailed</span>
            <button className="dash-segment-btn" onClick={() => navigate("/executive")}>Executive</button>
          </div>
          {!narrow && (
            <button
              className={`btn ${editLayout ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setEditLayout(v => !v)}
              title="Rearrange and resize dashboard widgets"
            >
              {editLayout ? "✓ Done" : "✎ Customize"}
            </button>
          )}
          <NotificationBell token={token} />
          {!isAuditor && <button className="btn btn-ghost" onClick={() => navigate("/tracker")}>Tracker</button>}
          {stats && <ExportMenu stats={stats} company={company} />}
          {/* ⋮ overflow menu */}
          <div style={{ position: "relative" }}>
            <button
              className="btn btn-ghost"
              style={{ padding: "6px 10px", fontSize: 18, lineHeight: 1 }}
              onClick={() => setDashMenuOpen(v => !v)}
              title="More"
            >⋮</button>
            {dashMenuOpen && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 1999 }} onClick={() => setDashMenuOpen(false)} />
                <div style={{
                  position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 2000,
                  background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 10,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.18)", minWidth: 160, padding: "6px 0",
                }}>
                  {isAdmin && <button className="btn btn-ghost" style={{ display: "block", width: "100%", textAlign: "left", borderRadius: 0, padding: "8px 16px", fontSize: 13 }} onClick={() => { setDashMenuOpen(false); navigate("/admin"); }}>Admin</button>}
                  {isAdmin && isVerified !== false && <button className="btn btn-ghost" style={{ display: "block", width: "100%", textAlign: "left", borderRadius: 0, padding: "8px 16px", fontSize: 13 }} onClick={() => { setDashMenuOpen(false); navigate("/auditors"); }}>Auditors</button>}
                  {isLeadOrAdmin && <button className="btn btn-ghost" style={{ display: "block", width: "100%", textAlign: "left", borderRadius: 0, padding: "8px 16px", fontSize: 13 }} onClick={() => { setDashMenuOpen(false); isVerified === false ? setReviewLockedOpen(true) : navigate("/review"); }}>Review</button>}
                  {(isLeadOrAdmin || isAuditor) && <button className="btn btn-ghost" style={{ display: "block", width: "100%", textAlign: "left", borderRadius: 0, padding: "8px 16px", fontSize: 13 }} onClick={() => { setDashMenuOpen(false); navigate("/settings/integrations"); }}>Integrations</button>}
                  <button className="btn btn-ghost" style={{ display: "block", width: "100%", textAlign: "left", borderRadius: 0, padding: "8px 16px", fontSize: 13 }} onClick={() => { setDashMenuOpen(false); navigate("/executive"); }}>Executive overview</button>
                  <button className="btn btn-ghost" style={{ display: "block", width: "100%", textAlign: "left", borderRadius: 0, padding: "8px 16px", fontSize: 13 }} onClick={() => { setDashMenuOpen(false); navigate("/findings"); }}>Findings</button>
                  <div style={{ height: 1, background: "var(--border2)", margin: "4px 0" }} />
                  <button className="btn btn-ghost" style={{ display: "block", width: "100%", textAlign: "left", borderRadius: 0, padding: "8px 16px", fontSize: 13 }} onClick={() => { setDashMenuOpen(false); resetLayout(); }}>⊞ Reset Layout</button>
                  <button className="btn btn-ghost" style={{ display: "block", width: "100%", textAlign: "left", borderRadius: 0, padding: "8px 16px", fontSize: 13 }} onClick={() => { setDashMenuOpen(false); onThemeToggle(); }}>{theme === "dark" ? "☀ Light mode" : "☾ Dark mode"}</button>
                  <button className="btn btn-ghost" style={{ display: "block", width: "100%", textAlign: "left", borderRadius: 0, padding: "8px 16px", fontSize: 13, color: "var(--red, #ef4444)" }} onClick={() => { setDashMenuOpen(false); onLogout(); }}>Logout</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {stats && !loading && (
        <div className="dash-standing">
          <div className="dash-standing-hero">
            <div className="dash-eyebrow">
              Audit standing
              <span className="dash-tag">{monthLabel}</span>
              {activeFramework && <span className="dash-tag">{activeFramework.name}</span>}
            </div>
            <div className="dash-standing-num">
              <CountUp value={signedOffPct} /><span className="dash-standing-pct">%</span>
            </div>
            <div className="dash-standing-num-label">
              {o.total > 0
                ? `of ${o.total} in-scope controls signed off`
                : "no controls in scope yet"}
            </div>
            <div
              className="dash-tristate"
              role="img"
              aria-label={`${o.finished} signed off, ${inProgress} in progress, ${notStarted} not started`}
            >
              <span style={{ width: `${pctOf(o.finished, o.total)}%`, background: "var(--green)" }} />
              <span style={{ width: `${pctOf(inProgress, o.total)}%`, background: "var(--amber)" }} />
            </div>
            <div className="dash-tristate-legend">
              <span><span className="dash-tristate-dot" style={{ background: "var(--green)" }} />Signed off <i>{o.finished}</i></span>
              <span><span className="dash-tristate-dot" style={{ background: "var(--amber)" }} />In progress <i>{inProgress}</i></span>
              <span><span className="dash-tristate-dot" style={{ background: "var(--dp-line-strong)" }} />Not started <i>{notStarted}</i></span>
            </div>
          </div>

          <div className="dash-standing-read">
            <p className="dash-standing-sentence">
              {o.total > 0 ? (
                <>
                  <b>{o.assessed} of {o.total}</b> controls assessed, <b>{o.finished}</b> signed off.
                  {" "}Average maturity sits at <b>{avgMatLabel}</b>.
                  {" "}{overdue > 0
                    ? <><b>{overdue}</b> {overdue === 1 ? "assessment is" : "assessments are"} overdue.</>
                    : "Nothing is overdue."}
                </>
              ) : (
                "Import your control set to start tracking audit readiness."
              )}
            </p>
            <div className="dash-readouts">
              <div className="dash-readout">
                <span className="dash-readout-val">{pctOf(evCov, evTot)}%</span>
                <span className="dash-readout-label">Evidence coverage</span>
              </div>
              <div className="dash-readout">
                <span className="dash-readout-val">{openActions}</span>
                <span className="dash-readout-label">Open actions</span>
              </div>
              <div className="dash-readout">
                <span className="dash-readout-val">{stats.scoreEligible?.count ?? 0}</span>
                <span className="dash-readout-label">Score-eligible controls</span>
              </div>
              <div className="dash-readout">
                <span className="dash-readout-val">{stats.automatedCoverage?.count ?? 0}</span>
                <span className="dash-readout-label">Automated checks</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {(dashPriorityFilter || dashTagFilter || dashOwnerFilter || dashStatusFilter) && !loading && (
        <div style={{
          margin: "14px 28px 0",
          padding: "8px 14px",
          background: "color-mix(in srgb, var(--dp-accent) 8%, transparent)",
          border: "1px solid color-mix(in srgb, var(--dp-accent) 28%, transparent)",
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 13,
          color: "var(--dp-quiet)",
        }}>
          <span style={{ color: "var(--dp-accent)", fontWeight: 600 }}>Filtered:</span>
          {dashStatusFilter && <span>Status: <strong>{dashStatusFilter.replace(/_/g, " ")}</strong></span>}
          {dashPriorityFilter && <span>Priority: <strong>{dashPriorityFilter}</strong></span>}
          {dashOwnerFilter && <span>Owner: <strong>{dashOwnerFilter}</strong></span>}
          {dashTagFilter && <span>Tag: <strong>{dashTagFilter}</strong></span>}
          {stats?.overall?.total === 0 && (
            <span style={{ color: "var(--red, #ef4444)", marginLeft: 4 }}>— no questions match this filter</span>
          )}
          <button
            onClick={clearDashFilters}
            style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 13 }}
          >
            ✕ Clear filters
          </button>
        </div>
      )}
      {error && <div className="error-text" style={{ padding: "0 28px 16px" }}>{error}</div>}

      {loading ? (
        <div className="tracker-loading">
          <div className="loading-spinner" />
          <p>Loading dashboard…</p>
        </div>
      ) : stats ? (
        (() => {
          const rendered = widgetOrder
            .map((id) => ({ id, def: WIDGET_DEFS.find((w) => w.id === id), content: renderWidget(id) }))
            .filter((x) => x.def && x.content !== null);

          const ruleStyleFor = (id) => {
            const r = ruleFor(id, stats);
            return r ? { "--rule": `${r.pct}%`, "--rule-color": r.color || toneFor(r.pct) } : undefined;
          };

          // Narrow screens: single-column stack, no layout engine.
          if (narrow) {
            return (
              <div className="dash-grid-stack">
                {rendered.map(({ id, def, content }) => (
                  <div key={id} className={`dash-widget ${def.cls}`} style={ruleStyleFor(id)}>
                    <div className="dash-card-scroll"><div className="dash-card-measure">{content}</div></div>
                  </div>
                ))}
              </div>
            );
          }

          const order = rendered.map((x) => x.id);
          const base = buildLayout(order, savedLayout, heights, defaultW);
          const items = gesture ? gesture.items : base;
          itemsRef.current = items;
          const byId = Object.fromEntries(items.map((i) => [i.id, i]));
          const cw = colWidth(gridW || 1200);
          const rows = layoutRows(items);
          return (
            <div className={`dash-canvas-wrap ${editLayout ? "dash-canvas-edit" : ""}`}>
              <div
                ref={gridRef}
                className="dash-canvas"
                style={{ height: rows * (ROW_PX + GRID_MARGIN) + 4 }}
              >
              {gesture?.ghost && byId[gesture.id] && (
                (() => {
                  const slot = itemBox(byId[gesture.id], cw);
                  return (
                    <div
                      className="dash-drop-slot"
                      style={{ transform: `translate(${slot.left}px, ${slot.top}px)`, width: slot.width, height: slot.height }}
                    />
                  );
                })()
              )}
              {rendered.map(({ id, def, content }) => {
                const it = byId[id];
                if (!it) return null;
                const slotBox = itemBox(it, cw);
                const active = gesture?.id === id;
                const box = active && gesture.ghost
                  ? { ...slotBox, left: gesture.ghost.left, top: gesture.ghost.top }
                  : slotBox;
                return (
                  <div
                    key={id}
                    className={`dash-widget ${def.cls} ${editLayout ? "dash-widget-edit" : ""} ${active ? "dash-widget-active" : ""}`}
                    style={{
                      transform: `translate(${box.left}px, ${box.top}px)`,
                      width: box.width,
                      height: box.height,
                      transition: active ? "none" : undefined,
                      zIndex: active ? 30 : undefined,
                      userSelect: editLayout ? "none" : "auto",
                      ...ruleStyleFor(id),
                    }}
                  >
                    {editLayout && (
                      <button
                        type="button"
                        className="dash-grip no-print"
                        title="Drag to move"
                        onPointerDown={(e) => startGesture(e, id, "move")}
                      >⠿ <span>Move</span></button>
                    )}
                    <div className="dash-card-scroll">
                      <div className="dash-card-measure" ref={setContentRef(id)}>{content}</div>
                    </div>
                    {editLayout && (
                      <>
                        <span className="dash-rz dash-rz-e no-print" title="Resize width"
                          onPointerDown={(e) => startGesture(e, id, "e")} />
                        <span className="dash-rz dash-rz-s no-print" title="Resize height"
                          onPointerDown={(e) => startGesture(e, id, "s")} />
                        <span className="dash-rz dash-rz-se no-print" title="Resize"
                          onPointerDown={(e) => startGesture(e, id, "se")} />
                      </>
                    )}
                  </div>
                );
              })}
              </div>
            </div>
          );
        })()
      ) : null}

      {/* Module Detail Modal */}
      {selectedModule && (
        <div className="modal-overlay" onClick={closeModule}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <div className="module-modal-header">
              <div>
                <div className="module-modal-title">{selectedModule.moduleId}</div>
                <div className="module-modal-subtitle">{selectedModule.name}</div>
              </div>
              <button className="modal-close" onClick={closeModule}>×</button>
            </div>

            <div className="module-modal-content">
              {loadingModule ? (
                <div style={{ padding: 40, textAlign: "center", color: "var(--text3)" }}>
                  <div className="loading-spinner" />
                  <p style={{ marginTop: 16 }}>Loading module data...</p>
                </div>
              ) : moduleError ? (
                <div style={{ padding: 32, textAlign: "center", color: "var(--red)" }}>
                  <p style={{ fontWeight: 600 }}>Failed to load module</p>
                  <p style={{ fontSize: 13, marginTop: 8, color: "var(--text2)" }}>{moduleError}</p>
                </div>
              ) : moduleData && moduleData.questions.length === 0 ? (
                <div style={{ padding: 40, textAlign: "center", color: "var(--text3)", fontSize: 14 }}>
                  No questions found for this module.
                </div>
              ) : moduleData ? (
                <div className="quest-details-list">
                  {moduleData.questions
                    .filter(q => {
                      if (dashPriorityFilter && q.priority !== dashPriorityFilter) return false;
                      if (dashTagFilter) {
                        const qTags = (q.tags || '').split(',').map(t => t.trim());
                        if (!qTags.includes(dashTagFilter)) return false;
                      }
                      return true;
                    })
                    .map(q => {
                      const qId = q.questId || q.quest_id;
                      const assessment = (moduleData.assessments || []).find(a =>
                        (a.questId || a.quest_id) === qId
                      );
                      const ev = (moduleData.evidence || []).filter(e => e.questId === q.questId);
                      const statusColor = assessment?.review_status === "FINISHED" || assessment?.reviewStatus === "FINISHED"
                        ? "var(--green)"
                        : assessment ? "var(--amber)" : "var(--text3)";

                      return (
                        <div key={q.questId || q.quest_id} className="quest-detail-item">
                          <div className="quest-detail-header">
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>
                                {q.questId || q.quest_id}: {q.controlArea || q.control_area}
                              </div>
                              <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 4 }}>
                                {q.baselineQuestion || q.baseline_question}
                              </div>
                              <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                                {q.priority && (
                                  <span className={`priority-badge priority-${(q.priority || '').toLowerCase()}`}>
                                    {q.priority}
                                  </span>
                                )}
                                {(q.tags || '').split(',').filter(t => t.trim()).map(tag => (
                                  <span key={tag.trim()} className="tag-badge">{tag.trim()}</span>
                                ))}
                              </div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                              {assessment && (
                                <>
                                  <div className="quest-badge" style={{ background: statusColor }}>
                                    {assessment.answer}
                                  </div>
                                  <div className="quest-maturity">
                                    L{assessment.currentLevel || assessment.current_level}
                                  </div>
                                  {assessment.comments && (
                                    <span title={assessment.comments.slice(0, 100)} style={{ fontSize: 11, fontWeight: 600, padding: "2px 6px", borderRadius: 4, background: "var(--bg4)", color: "var(--text2)", border: "1px solid var(--border2)", cursor: "default" }}>📝 Notes</span>
                                  )}
                                  {(assessment.reviewerNotes || assessment.reviewer_notes) && (
                                    <span title={(assessment.reviewerNotes || assessment.reviewer_notes).slice(0, 100)} style={{ fontSize: 11, fontWeight: 600, padding: "2px 6px", borderRadius: 4, background: "var(--bg4)", color: "var(--amber)", border: "1px solid var(--border2)", cursor: "default" }}>👁 Review</span>
                                  )}
                                </>
                              )}
                            </div>
                          </div>

                          {assessment && (
                            <div style={{ marginTop: 12, fontSize: 12, color: "var(--text3)" }}>
                              <div><strong>Status:</strong> {assessment.reviewStatus || assessment.review_status}</div>
                              {assessment.comments && (
                                <div style={{ marginTop: 4 }}><strong>Internal Notes:</strong> {assessment.comments}</div>
                              )}
                              {(assessment.reviewedBy || assessment.reviewed_by) && (
                                <div style={{ marginTop: 4 }}>
                                  <strong>Reviewed by:</strong> {assessment.reviewedBy || assessment.reviewed_by}
                                  {(assessment.reviewedAt || assessment.reviewed_at) && (
                                    <span style={{ marginLeft: 6 }}>
                                      on {new Date(assessment.reviewedAt || assessment.reviewed_at).toLocaleString()}
                                    </span>
                                  )}
                                </div>
                              )}
                              {(assessment.reviewerNotes || assessment.reviewer_notes) && (
                                <div style={{ marginTop: 4, color: "var(--amber)" }}>
                                  <strong>Reviewer Notes:</strong> {assessment.reviewerNotes || assessment.reviewer_notes}
                                </div>
                              )}
                              {(assessment.auditedBy || assessment.audited_by) && (
                                <div style={{ marginTop: 4 }}>
                                  <strong>Audited by:</strong> {assessment.auditedBy || assessment.audited_by}
                                  {(assessment.auditedAt || assessment.audited_at) && (
                                    <span style={{ marginLeft: 6 }}>
                                      on {new Date(assessment.auditedAt || assessment.audited_at).toLocaleString()}
                                    </span>
                                  )}
                                </div>
                              )}
                              {(assessment.auditorNotes || assessment.auditor_notes) && (
                                <div style={{ marginTop: 4, color: "var(--amber)" }}>
                                  <strong>Auditor notes:</strong> {assessment.auditorNotes || assessment.auditor_notes}
                                </div>
                              )}
                            </div>
                          )}

                          {ev.length > 0 && (
                            <div className="evidence-list-modal">
                              <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 6, fontWeight: 600, textTransform: "uppercase" }}>
                                Evidence ({ev.length})
                              </div>
                              {ev.map(e => (
                                <div key={e.id} className="evidence-item-modal">
                                  <span style={{ flex: 1, fontSize: 12 }}>
                                    {e.evidenceName || e.evidence_name}
                                  </span>
                                  <div style={{ display: "flex", gap: 6 }}>
                                    {(e.filePath || e.file_path) && (
                                      <button
                                        className="btn-compact"
                                        onClick={() => viewEvidence(e.id, e.evidenceName || e.evidence_name)}
                                      >
                                        View File
                                      </button>
                                    )}
                                    {(e.evidenceLink || e.evidence_link) && (
                                      <a
                                        href={e.evidenceLink || e.evidence_link}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="btn-compact"
                                      >
                                        View Link
                                      </a>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {isAuditor && assessment && ["Submitted", "FINISHED"].includes(assessment.reviewStatus || assessment.review_status) && (
                            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                              <button
                                className="btn btn-primary"
                                style={{ flex: 1, fontSize: 11, padding: "6px 12px" }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  promptAuditorApproval(assessment.id, "FINISHED");
                                }}
                              >
                                ✓ {(assessment.reviewStatus || assessment.review_status) === "FINISHED" ? "Re-approve" : "Approve"}
                              </button>
                              <button
                                className="btn btn-ghost"
                                style={{ flex: 1, fontSize: 11, padding: "6px 12px" }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  promptAuditorApproval(assessment.id, "WIP");
                                }}
                              >
                                ✗ Reject
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Review locked modal (unverified accounts) */}
      {reviewLockedOpen && (
        <div className="modal-overlay" onClick={() => setReviewLockedOpen(false)}>
          <div className="module-modal" style={{ maxWidth: 420, textAlign: "center" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 48, marginBottom: 16, marginTop: 8 }}>🔒</div>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 10, color: "var(--text)" }}>Review Workflow Locked</h2>
            <p style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.6, marginBottom: 20 }}>
              The review workflow is available after your account is verified by a platform administrator.
            </p>
            <button className="btn btn-ghost" style={{ width: "100%" }} onClick={() => setReviewLockedOpen(false)}>Close</button>
          </div>
        </div>
      )}

      {/* Auditor notes modal */}
      {auditorNotesModal && (
        <div className="modal-overlay" onClick={() => setAuditorNotesModal(null)}>
          <div className="module-modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div className="module-modal-header">
              <div className="module-modal-title">
                {auditorNotesModal.status === "FINISHED" ? "Approve assessment" : "Reject assessment"}
              </div>
              <button className="modal-close" onClick={() => setAuditorNotesModal(null)}>×</button>
            </div>
            <div className="module-modal-content" style={{ padding: 20 }}>
              <label style={{ display: "block", marginBottom: 8, fontSize: 13, color: "var(--text2)" }}>
                Notes for contributor (optional)
              </label>
              <textarea
                className="comments-textarea"
                rows={4}
                placeholder="Add feedback, comments, or instructions for the contributor..."
                onChange={e => { auditorNotesRef.current = e.target.value; }}
                style={{ width: "100%", marginBottom: 16 }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className={`btn ${auditorNotesModal.status === "FINISHED" ? "btn-primary" : "btn-ghost"}`}
                  style={{ flex: 1 }}
                  onClick={confirmAuditorApproval}
                >
                  {auditorNotesModal.status === "FINISHED" ? "✓ Confirm Approval" : "✗ Confirm Rejection"}
                </button>
                <button className="btn btn-ghost" onClick={() => setAuditorNotesModal(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
