export function BarChart({ data, valueKey, labelKey, color = "var(--accent)", maxValue }) {
  const max = maxValue || Math.max(...data.map(d => d[valueKey]), 1);
  return (
    <div className="chart-bar-list">
      {data.map((d, i) => {
        const pct = Math.round((d[valueKey] / max) * 100);
        return (
          <div key={i} className="chart-bar-row">
            <div className="chart-bar-label">{d[labelKey]}</div>
            <div className="chart-bar-track">
              <div className="chart-bar-fill" style={{ width: `${pct}%`, background: color }} />
            </div>
            <div className="chart-bar-val">{d[valueKey]}</div>
          </div>
        );
      })}
    </div>
  );
}

export function StackedBarChart({ data }) {
  return (
    <div className="chart-bar-list">
      {data.map((d, i) => {
        const total = d.total || 1;
        const finPct = Math.round((d.finished / total) * 100);
        const inPct = Math.round(((d.assessed - d.finished) / total) * 100);
        return (
          <div key={i} className="chart-bar-row">
            <div className="chart-bar-label">{d.label}</div>
            <div className="chart-bar-track" style={{ position: "relative" }}>
              <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${finPct}%`, background: "var(--green)", borderRadius: "3px 0 0 3px" }} />
              <div style={{ position: "absolute", left: `${finPct}%`, top: 0, height: "100%", width: `${inPct}%`, background: "var(--amber)" }} />
            </div>
            <div className="chart-bar-val">{d.finished}/{d.total}</div>
          </div>
        );
      })}
    </div>
  );
}

export function DonutChart({ segments, size = 130 }) {
  const total = segments.reduce((s, d) => s + d.value, 0) || 1;
  const r = 44;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const arcs = segments.map(seg => {
    const dash = (seg.value / total) * circ;
    const arc = { ...seg, dash, offset };
    offset += dash;
    return arc;
  });
  const largestSegment = segments.reduce((max, seg) => seg.value > max.value ? seg : max, segments[0] || { value: 0 });
  const pct = Math.round((largestSegment.value / total) * 100);

  return (
    <div className="chart-donut-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--bg3)" strokeWidth="14" />
        {arcs.map((arc, i) => (
          <circle
            key={i}
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke={arc.color}
            strokeWidth="14"
            strokeDasharray={`${arc.dash} ${circ - arc.dash}`}
            strokeDashoffset={-arc.offset + circ / 4}
          />
        ))}
        <text x={cx} y={cy - 8} textAnchor="middle" fontSize="20" fontWeight="600" fill="var(--text)">
          {total}
        </text>
        <text x={cx} y={cy + 8} textAnchor="middle" fontSize="10" fill="var(--text3)">
          total
        </text>
      </svg>
      <div className="chart-donut-legend">
        {segments.map((seg, i) => (
          <div key={i} className="chart-legend-item">
            <span className="chart-legend-dot" style={{ background: seg.color }} />
            <span className="chart-legend-label">{seg.label}</span>
            <span className="chart-legend-val">{seg.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
