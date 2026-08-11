import { useState } from "react";

function toCSV(rows) {
  return rows.map(r =>
    r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")
  ).join("\n");
}

function downloadCSV(filename, rows) {
  const blob = new Blob([toCSV(rows)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ExportMenu({ stats, company }) {
  const [open, setOpen] = useState(false);

  const exportCSV = () => {
    const { overall, moduleCompletion, evidenceCoverage, actionStatus, answerDistribution } = stats;
    const rows = [
      [`${company?.name || "Compliance"} Report`, new Date().toLocaleDateString()],
      [],
      ["COMPLETION METRICS"],
      ["Total Questions", "Assessed", "Finished"],
      [overall.total, overall.assessed, overall.finished],
      [],
      ["MODULE COMPLETION"],
      ["Module", "Name", "Total", "Assessed", "Finished"],
      ...moduleCompletion.map(m => [m.moduleId, m.name, m.total, m.assessed, m.finished]),
      [],
      ["EVIDENCE COVERAGE"],
      ["Module", "Covered", "Total"],
      ...evidenceCoverage.map(e => [e.moduleId, e.covered, e.total]),
      [],
      ["RISK DISTRIBUTION"],
      ["Answer", "Count"],
      ...answerDistribution.map(a => [a.answer, a.count]),
      [],
      ["ACTION STATUS"],
      ["Status", "Count"],
      ...actionStatus.map(a => [a.status, a.count])
    ];
    downloadCSV("compliance-report.csv", rows);
    setOpen(false);
  };

  const exportPDF = () => {
    setOpen(false);
    setTimeout(() => window.print(), 80);
  };

  return (
    <div className="export-wrap">
      <button className="btn btn-ghost" onClick={() => setOpen(o => !o)}>↓ Export</button>
      {open && (
        <>
          <div className="export-backdrop" onClick={() => setOpen(false)} />
          <div className="export-dropdown">
            <button className="export-item" onClick={exportCSV}>
              <span>CSV</span>
              <span className="export-item-sub">completion · evidence · risk · actions</span>
            </button>
            <button className="export-item" onClick={exportPDF}>
              <span>PDF</span>
              <span className="export-item-sub">print or save as PDF</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
