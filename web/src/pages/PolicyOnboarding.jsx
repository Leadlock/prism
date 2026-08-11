import { useRef, useState } from "react";
import { apiFetch, apiUpload } from "../api/client.js";
import { TECH_CATEGORIES } from "../utils/techCategories.js";

// ─── Policy data ──────────────────────────────────────────────────────────────

const POLICY_GROUPS = [
  {
    id: "governance", label: "Governance & Security", color: "#3E5771",
    policies: [
      { id: "information-security-policy", name: "Information Security Policy", desc: "Overarching framework for protecting information assets" },
      { id: "access-control-policy",        name: "Access Control Policy",        desc: "Rules governing system and data access permissions" },
      { id: "password-policy",              name: "Password Policy",              desc: "Requirements for passwords and authentication" },
      { id: "identity-governance-policy",   name: "Identity Governance Policy",   desc: "Identity lifecycle and access review processes" },
    ],
  },
  {
    id: "people-vendors", label: "People & Vendors", color: "#4CA8A0",
    policies: [
      { id: "hr-policies",              name: "HR Policies",              desc: "Employee conduct, onboarding, and offboarding rules" },
      { id: "vendor-management-policy", name: "Vendor Management Policy", desc: "Third-party selection, contracting, and oversight" },
      { id: "third-party-risk-policy",  name: "Third-Party Risk Policy",  desc: "Risk assessment framework for external parties" },
    ],
  },
  {
    id: "resilience", label: "Resilience & Recovery", color: "#D49A4E",
    policies: [
      { id: "incident-response-plan",   name: "Incident Response Plan",   desc: "Procedures for detecting and handling security incidents" },
      { id: "business-continuity-plan", name: "Business Continuity Plan", desc: "Maintaining critical operations during disruptions" },
      { id: "disaster-recovery-plan",   name: "Disaster Recovery Plan",   desc: "Restoring systems and data after a disaster" },
    ],
  },
  {
    id: "data-privacy", label: "Data & Privacy", color: "#D65B5B",
    policies: [
      { id: "data-protection-policy",    name: "Data Protection Policy",    desc: "How personal data is collected, stored, and protected" },
      { id: "privacy-notice",            name: "Privacy Notice",            desc: "Public disclosure of personal data processing" },
      { id: "consent-management-policy", name: "Consent Management Policy", desc: "Capturing and revoking individual consent" },
    ],
  },
  {
    id: "tech-ops", label: "Technology & Operations", color: "#5B7A99",
    policies: [
      { id: "acceptable-use-policy",         name: "Acceptable Use Policy",                desc: "Rules for using company IT resources appropriately" },
      { id: "backup-policy",                 name: "Backup Policy",                        desc: "Data backup frequency, retention, and verification" },
      { id: "cloud-security-policy",         name: "Cloud Security Policy",                desc: "Security controls for cloud-hosted services" },
      { id: "ai-governance-policy",          name: "AI Governance Policy",                 desc: "Responsible use and oversight of AI systems" },
      { id: "standard-operating-procedures", name: "Standard Operating Procedures (SOPs)", desc: "Step-by-step guides for routine operations" },
    ],
  },
];

const ALL_POLICIES = POLICY_GROUPS.flatMap(g => g.policies);
const TOTAL_POLICIES = ALL_POLICIES.length;


// ─── Main component ───────────────────────────────────────────────────────────

export default function PolicyOnboarding({ token, onComplete }) {
  const [activeTab, setActiveTab] = useState("policies");
  const [files, setFiles]         = useState({});
  const [techStack, setTechStack] = useState({});
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress]   = useState({ done: 0, total: 0 });
  const [doneMsg, setDoneMsg]     = useState("");

  const selectedFiles = Object.values(files).filter(Boolean).length;
  const filledTools   = Object.values(techStack).filter(v => v?.trim()).length;
  const progressPct   = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  const markComplete = async () => {
    try { await apiFetch("/api/auth/complete-onboarding", { token, method: "POST" }); } catch { /* non-critical */ }
    onComplete();
  };

  const handleComplete = async () => {
    setUploading(true);
    setDoneMsg("");

    // 1. Save tech stack
    if (filledTools > 0) {
      try {
        await apiFetch("/api/settings/tech-stack", { token, method: "PUT", body: techStack });
      } catch (err) {
        console.warn("[onboarding] tech stack save failed:", err.message);
      }
    }

    // 2. Upload policy files
    const entries = Object.entries(files).filter(([, f]) => f);
    setProgress({ done: 0, total: entries.length });

    let failed = 0;
    for (const [policyId, file] of entries) {
      const policy = ALL_POLICIES.find(p => p.id === policyId);
      try {
        await apiUpload("/api/vault", file, { title: policy.name, description: policy.desc }, token);
        setProgress(prev => ({ ...prev, done: prev.done + 1 }));
      } catch {
        failed++;
      }
    }

    if (failed > 0) {
      setDoneMsg(`${entries.length - failed} document${entries.length - failed !== 1 ? "s" : ""} uploaded. ${failed} failed — re-upload from the Evidence Vault.`);
    }

    setUploading(false);
    await markComplete();
  };

  const completeLabel = () => {
    if (uploading) return "Saving…";
    const parts = [];
    if (selectedFiles > 0) parts.push(`Upload ${selectedFiles} doc${selectedFiles !== 1 ? "s" : ""}`);
    if (filledTools > 0)   parts.push(`Save ${filledTools} tool${filledTools !== 1 ? "s" : ""}`);
    return parts.length ? `${parts.join(" & ")} & Complete →` : "Complete Setup →";
  };

  const hasWork = selectedFiles > 0 || filledTools > 0;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9990,
      background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      overflowY: "auto", padding: "24px 16px",
    }}>
      <div style={{
        width: "100%", maxWidth: 820, margin: "auto",
        background: "var(--bg)", borderRadius: 24,
        boxShadow: "0 32px 80px rgba(0,0,0,0.4)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {/* Top accent bar */}
        <div style={{ height: 4, background: "linear-gradient(90deg, #3E5771, #4CA8A0, #4CAF7D)" }} />

        {/* Header */}
        <div style={{ padding: "28px 36px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <div style={{
              width: 42, height: 42, borderRadius: 12,
              background: "var(--accent-gradient)", display: "flex",
              alignItems: "center", justifyContent: "center",
              fontSize: 20, boxShadow: "var(--neu-raised-sm)", flexShrink: 0,
            }}>
              {activeTab === "policies" ? "📋" : "🖥️"}
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", color: "var(--text3)", textTransform: "uppercase", fontFamily: "var(--mono)" }}>
                PRISM Setup
              </div>
              <h1 style={{ fontSize: 21, fontWeight: 700, color: "var(--text)", lineHeight: 1.2 }}>
                {activeTab === "policies" ? "Upload your policy documents" : "Map your technology stack"}
              </h1>
            </div>
          </div>
          <p style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6, maxWidth: 580, marginBottom: 20 }}>
            {activeTab === "policies"
              ? "PRISM reads these to identify gaps, detect conflicts, and map controls to compliance frameworks. Upload what you have — you can add more later."
              : "PRISM uses your technology inventory to give accurate compliance context and control mapping. Fill in what you use — leave blanks for tools you don't have."}
          </p>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 4, borderBottom: "2px solid var(--bg3)" }}>
            {[
              { id: "policies", label: "Policy Documents", badge: selectedFiles > 0 ? `${selectedFiles}/${TOTAL_POLICIES}` : null },
              { id: "tech",     label: "Technology Stack",  badge: filledTools > 0 ? `${filledTools}/${TECH_CATEGORIES.length}` : null },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: "9px 20px", border: "none", cursor: "pointer",
                  background: "none", fontFamily: "var(--sans)", fontSize: 13, fontWeight: 600,
                  color: activeTab === tab.id ? "var(--accent)" : "var(--text3)",
                  borderBottom: activeTab === tab.id ? "2px solid var(--accent)" : "2px solid transparent",
                  marginBottom: -2, display: "flex", alignItems: "center", gap: 7,
                  transition: "color 0.15s",
                }}
              >
                {tab.label}
                {tab.badge && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, fontFamily: "var(--mono)",
                    background: "var(--accent)", color: "#fff",
                    borderRadius: 6, padding: "1px 6px",
                  }}>{tab.badge}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 36px 8px", overflowY: "auto", maxHeight: "55vh" }}>
          {uploading && (
            <div style={{
              marginBottom: 16, padding: "13px 18px", borderRadius: 12,
              background: "var(--bg3)", boxShadow: "var(--neu-inset-sm)",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Uploading documents…</span>
                <span style={{ fontSize: 12, fontFamily: "var(--mono)", color: "var(--text2)" }}>{progress.done}/{progress.total}</span>
              </div>
              <div style={{ height: 5, borderRadius: 999, background: "var(--bg4)" }}>
                <div style={{ height: "100%", borderRadius: 999, width: `${progressPct}%`, background: "var(--accent-gradient)", transition: "width 0.4s ease" }} />
              </div>
            </div>
          )}

          {doneMsg && (
            <div style={{ marginBottom: 14, padding: "11px 15px", borderRadius: 10, background: "rgba(212,154,78,0.12)", border: "1px solid var(--amber)", fontSize: 13, color: "var(--amber)" }}>
              {doneMsg}
            </div>
          )}

          {activeTab === "policies" ? (
            POLICY_GROUPS.map(group => (
              <PolicyGroup
                key={group.id}
                group={group}
                files={files}
                onFileSelect={(id, file) => setFiles(prev => ({ ...prev, [id]: file || undefined }))}
                uploading={uploading}
              />
            ))
          ) : (
            <TechStackTab
              techStack={techStack}
              onChange={(id, value) => setTechStack(prev => ({ ...prev, [id]: value }))}
            />
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "16px 36px 24px",
          borderTop: "1px solid var(--bg3)",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
        }}>
          <button
            onClick={markComplete}
            disabled={uploading}
            style={{
              background: "none", border: "none", cursor: uploading ? "not-allowed" : "pointer",
              color: "var(--text3)", fontSize: 13, padding: "8px 4px",
              textDecoration: "underline", opacity: uploading ? 0.5 : 1,
            }}
          >
            Skip for now
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* Tab switcher shortcut in footer */}
            {activeTab === "policies" && (
              <button
                onClick={() => setActiveTab("tech")}
                disabled={uploading}
                style={{
                  padding: "9px 18px", borderRadius: 9, border: "1px solid var(--bg3)",
                  background: "var(--bg3)", color: "var(--text2)",
                  fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--sans)",
                }}
              >
                Next: Technology →
              </button>
            )}
            {activeTab === "tech" && (
              <button
                onClick={() => setActiveTab("policies")}
                disabled={uploading}
                style={{
                  padding: "9px 18px", borderRadius: 9, border: "1px solid var(--bg3)",
                  background: "var(--bg3)", color: "var(--text2)",
                  fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--sans)",
                }}
              >
                ← Back: Policies
              </button>
            )}

            <button
              onClick={handleComplete}
              disabled={uploading}
              style={{
                padding: "10px 24px", borderRadius: 10, border: "none",
                background: hasWork ? "var(--accent-gradient)" : "var(--bg3)",
                color: hasWork ? "#fff" : "var(--text2)",
                fontWeight: 700, fontSize: 13, cursor: uploading ? "not-allowed" : "pointer",
                boxShadow: hasWork ? "var(--neu-raised-sm)" : "none",
                opacity: uploading ? 0.7 : 1, transition: "all 0.2s", fontFamily: "var(--sans)",
              }}
            >
              {completeLabel()}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Policy tab components ─────────────────────────────────────────────────────

function PolicyGroup({ group, files, onFileSelect, uploading }) {
  const uploadedCount = group.policies.filter(p => files[p.id]).length;
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{ width: 3, height: 18, borderRadius: 2, background: group.color }} />
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: group.color, fontFamily: "var(--mono)" }}>
          {group.label}
        </span>
        <span style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--mono)" }}>
          · {uploadedCount}/{group.policies.length} uploaded
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {group.policies.map(policy => (
          <PolicyRow
            key={policy.id}
            policy={policy}
            groupColor={group.color}
            file={files[policy.id]}
            onFileSelect={file => onFileSelect(policy.id, file)}
            uploading={uploading}
          />
        ))}
      </div>
    </div>
  );
}

function PolicyRow({ policy, groupColor, file, onFileSelect, uploading }) {
  const inputRef = useRef(null);
  const hasFile = Boolean(file);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "11px 14px", borderRadius: 10,
      background: hasFile ? `${groupColor}0D` : "var(--bg3)",
      boxShadow: hasFile ? `0 0 0 1px ${groupColor}30` : "var(--neu-inset-sm)",
      transition: "all 0.2s",
    }}>
      <div style={{
        width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
        background: hasFile ? "#4CAF7D" : "var(--text3)",
        boxShadow: hasFile ? "0 0 6px #4CAF7D80" : "none",
        transition: "all 0.2s",
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", lineHeight: 1.3 }}>{policy.name}</div>
        {hasFile
          ? <div style={{ fontSize: 11, color: "#4CAF7D", fontFamily: "var(--mono)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>✓ {file.name}</div>
          : <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>{policy.desc}</div>
        }
      </div>
      <div style={{ flexShrink: 0, display: "flex", gap: 5 }}>
        {hasFile && (
          <button onClick={() => onFileSelect(null)} disabled={uploading} style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: "var(--bg4)", color: "var(--text3)", fontSize: 11, cursor: "pointer", fontFamily: "var(--sans)" }}>
            Remove
          </button>
        )}
        <button
          onClick={() => inputRef.current?.click()} disabled={uploading}
          style={{ padding: "4px 13px", borderRadius: 6, border: "none", background: hasFile ? "var(--bg4)" : groupColor, color: hasFile ? "var(--text2)" : "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "var(--sans)", opacity: uploading ? 0.5 : 1 }}
        >
          {hasFile ? "Change" : "Upload"}
        </button>
      </div>
      <input ref={inputRef} type="file" style={{ display: "none" }}
        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.png,.jpg,.jpeg"
        onChange={e => { const f = e.target.files?.[0]; if (f) onFileSelect(f); e.target.value = ""; }} />
    </div>
  );
}

// ─── Tech stack tab ────────────────────────────────────────────────────────────

function TechStackTab({ techStack, onChange }) {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 8 }}>
        {TECH_CATEGORIES.map(cat => {
          const value = techStack[cat.id] || "";
          const filled = Boolean(value.trim());
          return (
            <div key={cat.id} style={{
              padding: "11px 14px", borderRadius: 10,
              background: filled ? "rgba(76,168,160,0.08)" : "var(--bg3)",
              boxShadow: filled ? "0 0 0 1px rgba(76,168,160,0.3)" : "var(--neu-inset-sm)",
              transition: "all 0.2s",
            }}>
              <label style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: filled ? "#4CAF7D" : "var(--text3)", boxShadow: filled ? "0 0 6px #4CAF7D80" : "none", transition: "all 0.2s" }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{cat.label}</span>
              </label>
              <input
                type="text"
                value={value}
                onChange={e => onChange(cat.id, e.target.value)}
                placeholder={cat.placeholder}
                style={{
                  width: "100%", padding: "7px 10px", borderRadius: 7, border: "none",
                  background: "var(--bg4)", color: "var(--text)",
                  fontSize: 12, fontFamily: "var(--sans)", outline: "none",
                  boxShadow: "var(--neu-inset-sm)",
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
