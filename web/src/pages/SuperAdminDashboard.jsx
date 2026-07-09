import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch, apiUpload } from "../api/client.js";

const TAB_STORAGE_KEY = "superadmin_active_tab";

function useToast() {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);

  const showToast = useCallback((message, type = "success") => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ message, type });
    timerRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  return { toast, showToast };
}

export default function SuperAdminDashboard({ token, user, onLogout, theme, onThemeToggle }) {
  // --- Tab State (persisted via sessionStorage) ---
  const [activeTab, setActiveTab] = useState(() => {
    try {
      return sessionStorage.getItem(TAB_STORAGE_KEY) || "companies";
    } catch { return "companies"; }
  });

  // --- Data State ---
  const [companies, setCompanies] = useState([]);
  const [templates, setTemplates] = useState([]);

  // --- Loading/Error per tab ---
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [errorCompanies, setErrorCompanies] = useState(null);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [errorTemplates, setErrorTemplates] = useState(null);

  // --- Toast ---
  const { toast, showToast } = useToast();

  // --- Import state ---
  const [importFile, setImportFile] = useState(null);
  const [importCompanyId, setImportCompanyId] = useState("");
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  // --- Modules tab state ---
  const [assignCompanyId, setAssignCompanyId] = useState({});
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  // --- Company detail state ---
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [companyModules, setCompanyModules] = useState([]);
  const [loadingModules, setLoadingModules] = useState(false);
  const [companyImportFile, setCompanyImportFile] = useState(null);
  const [companyImporting, setCompanyImporting] = useState(false);
  const [companyImportResult, setCompanyImportResult] = useState(null);
  const [companyDragOver, setCompanyDragOver] = useState(false);
  const [deleteModulesConfirm, setDeleteModulesConfirm] = useState(false);

  // --- Add Module form state ---
  const [newModuleId, setNewModuleId] = useState("");
  const [newModuleName, setNewModuleName] = useState("");
  const [newModuleOwner, setNewModuleOwner] = useState("");
  const [newModuleFrequency, setNewModuleFrequency] = useState("");
  const [addingModule, setAddingModule] = useState(false);

  // --- Delete single module state ---
  const [deleteModuleConfirm, setDeleteModuleConfirm] = useState(null);

  // --- Add Question form state ---
  const [newQuestId, setNewQuestId] = useState("");
  const [newQuestModuleId, setNewQuestModuleId] = useState("");
  const [newQuestControlArea, setNewQuestControlArea] = useState("");
  const [newQuestText, setNewQuestText] = useState("");
  const [addingQuestion, setAddingQuestion] = useState(false);
  const [questionError, setQuestionError] = useState(null);

  // --- Delete single question state ---
  const [deleteQuestionConfirm, setDeleteQuestionConfirm] = useState(null);
  const [companyQuestions, setCompanyQuestions] = useState([]);

  // --- Persist tab ---
  useEffect(() => {
    try { sessionStorage.setItem(TAB_STORAGE_KEY, activeTab); } catch {}
  }, [activeTab]);

  // --- Fetch companies ---
  const fetchCompanies = useCallback(async () => {
    setLoadingCompanies(true);
    setErrorCompanies(null);
    try {
      const data = await apiFetch("/api/superadmin/companies", { token });
      setCompanies(data || []);
    } catch (err) {
      setErrorCompanies(err.message || "Failed to load companies");
    } finally {
      setLoadingCompanies(false);
    }
  }, [token]);

  // --- Fetch templates ---
  const fetchTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    setErrorTemplates(null);
    try {
      const data = await apiFetch("/api/superadmin/templates", { token });
      setTemplates(data || []);
    } catch (err) {
      setErrorTemplates(err.message || "Failed to load templates");
    } finally {
      setLoadingTemplates(false);
    }
  }, [token]);

  // --- Load data on mount and tab change ---
  useEffect(() => {
    if (activeTab === "companies") fetchCompanies();
    if (activeTab === "modules") { fetchTemplates(); fetchCompanies(); }
    if (activeTab === "import") fetchCompanies();
  }, [activeTab, fetchCompanies, fetchTemplates]);

  // --- Company status change (optimistic) ---
  const handleStatusChange = async (companyId, newStatus) => {
    const prev = [...companies];
    setCompanies(cs => cs.map(c => c.id === companyId ? { ...c, status: newStatus } : c));
    try {
      await apiFetch(`/api/superadmin/companies/${companyId}/status`, {
        token,
        method: "PATCH",
        body: JSON.stringify({ status: newStatus }),
      });
      showToast(`Company ${newStatus} successfully`, "success");
    } catch (err) {
      setCompanies(prev);
      showToast(err.message || "Status update failed", "error");
    }
  };

  // --- Delete company ---
  const handleDeleteCompany = async (companyId, companyName) => {
    if (!window.confirm(`Permanently delete "${companyName}" and all its data? This cannot be undone.`)) return;
    try {
      await apiFetch(`/api/superadmin/companies/${companyId}`, {
        token,
        method: "DELETE",
      });
      setCompanies(cs => cs.filter(c => c.id !== companyId));
      if (selectedCompany?.id === companyId) setSelectedCompany(null);
      showToast(`Company "${companyName}" deleted`, "success");
    } catch (err) {
      showToast(err.message || "Delete failed", "error");
    }
  };

  // --- Billing update ---
  const handleBillingUpdate = async (companyId, patch) => {
    try {
      const updated = await apiFetch(`/api/superadmin/companies/${companyId}/billing`, {
        token,
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setCompanies(cs => cs.map(c => c.id === companyId ? { ...c, ...updated } : c));
      if (selectedCompany?.id === companyId) setSelectedCompany(prev => ({ ...prev, ...updated }));
      showToast("Billing updated", "success");
    } catch (err) {
      showToast(err.message || "Billing update failed", "error");
    }
  };

  // --- AI toggle (optimistic) ---
  const handleAIToggle = async (companyId, currentVal) => {
    const newVal = !currentVal;
    const prev = [...companies];
    setCompanies(cs => cs.map(c => c.id === companyId ? { ...c, ai_enabled: newVal } : c));
    try {
      await apiFetch(`/api/superadmin/companies/${companyId}/ai-toggle`, {
        token,
        method: "PATCH",
        body: JSON.stringify({ aiEnabled: newVal }),
      });
      showToast(`AI ${newVal ? "enabled" : "disabled"} successfully`, "success");
    } catch (err) {
      setCompanies(prev);
      showToast(err.message || "AI toggle failed", "error");
    }
  };

  // --- Import handler ---
  const handleImport = async () => {
    if (!importFile) return;
    setImporting(true);
    setImportResult(null);
    setImportError(null);
    try {
      const body = {};
      if (importCompanyId) body.companyId = importCompanyId;
      if (saveAsTemplate) {
        body.saveAsTemplate = "true";
        body.templateName = templateName || importFile.name;
      }
      const result = await apiUpload("/api/superadmin/import-modules", importFile, body, token);
      setImportResult(result);
      showToast("Import completed successfully", "success");
      setImportFile(null);
      setSaveAsTemplate(false);
      setTemplateName("");
      setImportCompanyId("");
    } catch (err) {
      setImportError(err.message || "Import failed");
      showToast(err.message || "Import failed", "error");
    } finally {
      setImporting(false);
    }
  };

  // --- File validation ---
  const validateFile = (file) => {
    if (!file) return null;
    const validExts = [".xlsx", ".xls"];
    const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
    if (!validExts.includes(ext)) return "Only .xlsx and .xls files are allowed";
    if (file.size > 10 * 1024 * 1024) return "File size must be under 10MB";
    return null;
  };

  const handleFileSelect = (file) => {
    const err = validateFile(file);
    if (err) {
      showToast(err, "error");
      return;
    }
    setImportFile(file);
    setImportResult(null);
    setImportError(null);
  };

  // --- Template assign ---
  const handleAssignTemplate = async (templateId) => {
    const companyId = assignCompanyId[templateId];
    if (!companyId) {
      showToast("Please select a company", "error");
      return;
    }
    try {
      const result = await apiFetch(`/api/superadmin/templates/${templateId}/assign`, {
        token,
        method: "POST",
        body: JSON.stringify({ companyId }),
      });
      showToast(`Assigned ${result.moduleCount} modules, ${result.questionCount} questions`, "success");
      setAssignCompanyId(prev => ({ ...prev, [templateId]: "" }));
    } catch (err) {
      showToast(err.message || "Assignment failed", "error");
    }
  };

  // --- Template delete ---
  const handleDeleteTemplate = async (templateId) => {
    try {
      await apiFetch(`/api/superadmin/templates/${templateId}`, {
        token,
        method: "DELETE",
      });
      setTemplates(ts => ts.filter(t => t.id !== templateId));
      showToast("Template deleted", "success");
      setDeleteConfirm(null);
    } catch (err) {
      showToast(err.message || "Delete failed", "error");
    }
  };

  // --- Company detail: fetch modules ---
  const openCompanyDetail = async (company) => {
    setSelectedCompany(company);
    setCompanyModules([]);
    setCompanyQuestions([]);
    setCompanyImportFile(null);
    setCompanyImportResult(null);
    setDeleteModulesConfirm(false);
    setDeleteModuleConfirm(null);
    setDeleteQuestionConfirm(null);
    setQuestionError(null);
    setLoadingModules(true);
    try {
      const data = await apiFetch(`/api/superadmin/companies/${company.id}/modules`, { token });
      setCompanyModules(data || []);
    } catch {
      setCompanyModules([]);
    }
    try {
      const data = await apiFetch(`/api/superadmin/companies/${company.id}/questions`, { token });
      setCompanyQuestions(data || []);
    } catch {
      setCompanyQuestions([]);
    }
    setLoadingModules(false);
  };

  // --- Company detail: import for this company ---
  const handleCompanyImport = async () => {
    if (!companyImportFile || !selectedCompany) return;
    setCompanyImporting(true);
    setCompanyImportResult(null);
    try {
      const result = await apiUpload("/api/superadmin/import-modules", companyImportFile, { companyId: String(selectedCompany.id) }, token);
      setCompanyImportResult(result);
      showToast(`Imported ${result.modulesImported} modules, ${result.questionsImported} questions`, "success");
      setCompanyImportFile(null);
      // Refresh modules list
      const data = await apiFetch(`/api/superadmin/companies/${selectedCompany.id}/modules`, { token });
      setCompanyModules(data || []);
    } catch (err) {
      showToast(err.message || "Import failed", "error");
    } finally {
      setCompanyImporting(false);
    }
  };

  // --- Company detail: delete all modules ---
  const handleDeleteCompanyModules = async () => {
    if (!selectedCompany) return;
    try {
      await apiFetch(`/api/superadmin/companies/${selectedCompany.id}/modules`, {
        token,
        method: "DELETE",
      });
      setCompanyModules([]);
      setDeleteModulesConfirm(false);
      showToast("All modules and questions deleted for this company", "success");
    } catch (err) {
      showToast(err.message || "Delete failed", "error");
    }
  };

  // --- Add single module ---
  const handleAddModule = async () => {
    if (!newModuleId.trim() || !newModuleName.trim()) {
      showToast("Module ID and Name are required", "error");
      return;
    }
    setAddingModule(true);
    try {
      await apiFetch(`/api/superadmin/companies/${selectedCompany.id}/modules`, {
        token,
        method: "POST",
        body: JSON.stringify({
          moduleId: newModuleId.trim(),
          name: newModuleName.trim(),
          primaryOwner: newModuleOwner.trim() || undefined,
          frequency: newModuleFrequency.trim() || undefined,
        }),
      });
      showToast("Module added successfully", "success");
      setNewModuleId("");
      setNewModuleName("");
      setNewModuleOwner("");
      setNewModuleFrequency("");
      // Refresh modules
      const data = await apiFetch(`/api/superadmin/companies/${selectedCompany.id}/modules`, { token });
      setCompanyModules(data || []);
    } catch (err) {
      showToast(err.message || "Failed to add module", "error");
    } finally {
      setAddingModule(false);
    }
  };

  // --- Delete single module ---
  const handleDeleteSingleModule = async (moduleId) => {
    try {
      await apiFetch(`/api/superadmin/companies/${selectedCompany.id}/modules/${encodeURIComponent(moduleId)}`, {
        token,
        method: "DELETE",
      });
      showToast("Module deleted", "success");
      setDeleteModuleConfirm(null);
      const data = await apiFetch(`/api/superadmin/companies/${selectedCompany.id}/modules`, { token });
      setCompanyModules(data || []);
    } catch (err) {
      showToast(err.message || "Delete failed", "error");
    }
  };

  // --- Add single question ---
  const handleAddQuestion = async () => {
    if (!newQuestId.trim() || !newQuestModuleId.trim()) {
      showToast("Quest ID and Module ID are required", "error");
      return;
    }
    setAddingQuestion(true);
    setQuestionError(null);
    try {
      await apiFetch(`/api/superadmin/companies/${selectedCompany.id}/questions`, {
        token,
        method: "POST",
        body: JSON.stringify({
          questId: newQuestId.trim(),
          moduleId: newQuestModuleId.trim(),
          controlArea: newQuestControlArea.trim() || undefined,
          baselineQuestion: newQuestText.trim() || undefined,
        }),
      });
      showToast("Question added successfully", "success");
      setNewQuestId("");
      setNewQuestModuleId("");
      setNewQuestControlArea("");
      setNewQuestText("");
      // Refresh questions
      try {
        const data = await apiFetch(`/api/superadmin/companies/${selectedCompany.id}/questions`, { token });
        setCompanyQuestions(data || []);
      } catch { /* ignore if endpoint not available */ }
    } catch (err) {
      setQuestionError(err.message || "Failed to add question");
      showToast(err.message || "Failed to add question", "error");
    } finally {
      setAddingQuestion(false);
    }
  };

  // --- Delete single question ---
  const handleDeleteSingleQuestion = async (questId) => {
    try {
      await apiFetch(`/api/superadmin/companies/${selectedCompany.id}/questions/${encodeURIComponent(questId)}`, {
        token,
        method: "DELETE",
      });
      showToast("Question deleted", "success");
      setDeleteQuestionConfirm(null);
      try {
        const data = await apiFetch(`/api/superadmin/companies/${selectedCompany.id}/questions`, { token });
        setCompanyQuestions(data || []);
      } catch { /* ignore */ }
    } catch (err) {
      showToast(err.message || "Delete failed", "error");
    }
  };

  // --- Styles ---
  const styles = {
    tabs: {
      display: "flex",
      gap: "0",
      borderBottom: "1px solid var(--border)",
      marginBottom: "24px",
    },
    tab: {
      padding: "12px 24px",
      background: "none",
      border: "none",
      borderBottom: "2px solid transparent",
      color: "var(--text2)",
      fontSize: "13px",
      fontWeight: 500,
      cursor: "pointer",
      transition: "all 0.15s",
      fontFamily: "var(--sans)",
    },
    tabActive: {
      color: "var(--accent2)",
      borderBottomColor: "var(--accent)",
    },
    toggle: {
      position: "relative",
      width: "36px",
      height: "20px",
      borderRadius: "10px",
      border: "none",
      cursor: "pointer",
      transition: "background 0.2s",
      padding: 0,
    },
    toggleDot: {
      position: "absolute",
      top: "3px",
      width: "14px",
      height: "14px",
      borderRadius: "50%",
      background: "#fff",
      transition: "left 0.2s",
    },
    statusBadge: {
      display: "inline-block",
      padding: "3px 8px",
      borderRadius: "12px",
      fontSize: "11px",
      fontWeight: 600,
      textTransform: "capitalize",
    },
    dropZone: {
      border: "2px dashed var(--border2)",
      borderRadius: "8px",
      padding: "40px 20px",
      textAlign: "center",
      cursor: "pointer",
      transition: "all 0.15s",
      background: "var(--bg3)",
    },
    dropZoneActive: {
      borderColor: "var(--accent)",
      background: "rgba(99,102,241,0.05)",
    },
    resultBox: {
      background: "var(--bg3)",
      border: "1px solid var(--border)",
      borderRadius: "8px",
      padding: "16px",
      marginTop: "16px",
    },
  };

  const getStatusColor = (status) => {
    switch (status) {
      case "approved": return { bg: "rgba(34,197,94,0.1)", color: "var(--green)", border: "rgba(34,197,94,0.3)" };
      case "rejected": return { bg: "rgba(239,68,68,0.1)", color: "var(--red)", border: "rgba(239,68,68,0.3)" };
      case "suspended": return { bg: "rgba(245,158,11,0.1)", color: "var(--amber)", border: "rgba(245,158,11,0.3)" };
      default: return { bg: "rgba(99,102,241,0.1)", color: "var(--accent2)", border: "rgba(99,102,241,0.3)" };
    }
  };

  // --- Render Companies Tab ---
  const renderCompaniesTab = () => {
    if (loadingCompanies) return <div style={{ textAlign: "center", padding: "40px", color: "var(--text2)" }}><div className="loading-spinner" style={{ margin: "0 auto 12px" }} /><p>Loading companies...</p></div>;
    if (errorCompanies) return <div style={{ textAlign: "center", padding: "40px", color: "var(--red)" }}>Error: {errorCompanies}<br /><button className="btn btn-ghost" style={{ marginTop: "12px" }} onClick={fetchCompanies}>Retry</button></div>;
    if (companies.length === 0) return <p style={{ color: "var(--text3)", textAlign: "center", padding: "40px" }}>No companies registered yet.</p>;

    // If a company is selected, show detail panel
    if (selectedCompany) {
      return renderCompanyDetail();
    }

    return (
      <div style={{ overflowX: "auto" }}>
        <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Domain</th>
              <th style={thStyle}>Admin Email</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>AI</th>
              <th style={thStyle}>Actions</th>
              <th style={thStyle}>Created</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => {
              const sc = getStatusColor(c.status);
              return (
                <tr key={c.id} style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }} onClick={() => openCompanyDetail(c)}>
                  <td style={tdStyle}><strong style={{ color: "var(--accent2)" }}>{c.name}</strong></td>
                  <td style={tdStyle}><span style={{ fontFamily: "var(--mono)", fontSize: "11px" }}>{c.domain}</span></td>
                  <td style={tdStyle}><span style={{ fontSize: "12px" }}>{c.admin_email}</span></td>
                  <td style={tdStyle}>
                    <span style={{ ...styles.statusBadge, background: sc.bg, color: sc.color, border: `1px solid ${sc.border}` }}>
                      {c.status}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleAIToggle(c.id, c.ai_enabled); }}
                      style={{
                        ...styles.toggle,
                        background: c.ai_enabled ? "var(--green)" : "var(--bg4)",
                      }}
                      title={c.ai_enabled ? "AI Enabled - Click to disable" : "AI Disabled - Click to enable"}
                    >
                      <span style={{ ...styles.toggleDot, left: c.ai_enabled ? "19px" : "3px" }} />
                    </button>
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                      {c.status !== "approved" && (
                        <button className="btn" style={{ padding: "4px 8px", fontSize: "11px", background: "rgba(34,197,94,0.15)", color: "var(--green)", border: "1px solid rgba(34,197,94,0.3)" }} onClick={(e) => { e.stopPropagation(); handleStatusChange(c.id, "approved"); }}>Approve</button>
                      )}
                      {c.status !== "suspended" && (
                        <button className="btn" style={{ padding: "4px 8px", fontSize: "11px", background: "rgba(245,158,11,0.15)", color: "var(--amber)", border: "1px solid rgba(245,158,11,0.3)" }} onClick={(e) => { e.stopPropagation(); handleStatusChange(c.id, "suspended"); }}>Suspend</button>
                      )}
                      {c.status !== "rejected" && (
                        <button className="btn" style={{ padding: "4px 8px", fontSize: "11px", background: "rgba(239,68,68,0.15)", color: "var(--red)", border: "1px solid rgba(239,68,68,0.3)" }} onClick={(e) => { e.stopPropagation(); handleStatusChange(c.id, "rejected"); }}>Reject</button>
                      )}
                      <button className="btn" style={{ padding: "4px 8px", fontSize: "11px", background: "rgba(127,29,29,0.2)", color: "#fca5a5", border: "1px solid rgba(127,29,29,0.4)" }} onClick={(e) => { e.stopPropagation(); handleDeleteCompany(c.id, c.name); }}>Delete</button>
                    </div>
                  </td>
                  <td style={tdStyle}><span style={{ fontSize: "11px", color: "var(--text3)" }}>{new Date(c.created_at).toLocaleDateString()}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  // --- Render Company Detail Panel ---
  const renderCompanyDetail = () => {
    const c = selectedCompany;
    const sc = getStatusColor(c.status);

    return (
      <div>
        {/* Back button */}
        <button className="btn btn-ghost" style={{ marginBottom: "16px", fontSize: "13px" }} onClick={() => setSelectedCompany(null)}>
          ← Back to Companies
        </button>

        {/* Company header */}
        <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px", marginBottom: "20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
            <div>
              <h3 style={{ fontSize: "18px", fontWeight: 600, color: "var(--text)", margin: "0 0 4px" }}>{c.name}</h3>
              <p style={{ fontSize: "12px", color: "var(--text3)", margin: 0 }}>{c.domain} • {c.admin_email}</p>
            </div>
            <span style={{ ...styles.statusBadge, background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`, fontSize: "12px", padding: "4px 12px" }}>
              {c.status}
            </span>
          </div>
        </div>

        {/* Billing */}
        <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px", marginBottom: "20px" }}>
          <h4 style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", margin: "0 0 14px" }}>Billing & Plan</h4>
          <div style={{ display: "flex", gap: "24px", flexWrap: "wrap", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>PLAN</div>
              <div style={{ display: "flex", gap: 6 }}>
                {["lite","pro","enterprise"].map(p => (
                  <button key={p} className="btn" onClick={() => handleBillingUpdate(c.id, { plan: p })} style={{
                    padding: "4px 12px", fontSize: "11px", textTransform: "capitalize",
                    background: c.plan === p ? "var(--accent)" : "var(--bg4)",
                    color: c.plan === p ? "#fff" : "var(--text2)",
                    border: `1px solid ${c.plan === p ? "var(--accent)" : "var(--border)"}`,
                    fontWeight: c.plan === p ? 700 : 400,
                  }}>{p}</button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>BILLING STATUS</div>
              <div style={{ display: "flex", gap: 6 }}>
                {["trial","active","expired"].map(s => (
                  <button key={s} className="btn" onClick={() => handleBillingUpdate(c.id, { billingStatus: s })} style={{
                    padding: "4px 12px", fontSize: "11px", textTransform: "capitalize",
                    background: c.billing_status === s ? (s === "active" ? "rgba(34,197,94,0.2)" : s === "expired" ? "rgba(239,68,68,0.15)" : "rgba(245,158,11,0.15)") : "var(--bg4)",
                    color: c.billing_status === s ? (s === "active" ? "var(--green)" : s === "expired" ? "var(--red)" : "var(--amber)") : "var(--text2)",
                    border: `1px solid ${c.billing_status === s ? "currentColor" : "var(--border)"}`,
                    fontWeight: c.billing_status === s ? 700 : 400,
                  }}>{s}</button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>EXTEND TRIAL</div>
              <div style={{ display: "flex", gap: 6 }}>
                {[7, 14, 30].map(days => (
                  <button key={days} className="btn" onClick={() => handleBillingUpdate(c.id, { trialDays: days, billingStatus: "trial" })} style={{ padding: "4px 10px", fontSize: "11px", background: "var(--bg4)", color: "var(--text2)", border: "1px solid var(--border)" }}>
                    +{days}d
                  </button>
                ))}
              </div>
            </div>
            <div style={{ fontSize: 12, color: "var(--text3)", alignSelf: "flex-end", paddingBottom: 2 }}>
              Trial ends: {c.trial_ends_at ? new Date(c.trial_ends_at).toLocaleDateString() : "—"}
            </div>
          </div>
        </div>

        {/* Modules list */}
        <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px", marginBottom: "20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <h4 style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", margin: 0 }}>
              Modules ({companyModules.length})
            </h4>
            {companyModules.length > 0 && !deleteModulesConfirm && (
              <button className="btn" style={{ padding: "5px 12px", fontSize: "11px", background: "rgba(239,68,68,0.12)", color: "var(--red)", border: "1px solid rgba(239,68,68,0.3)" }} onClick={() => setDeleteModulesConfirm(true)}>
                Delete All Modules
              </button>
            )}
          </div>

          {deleteModulesConfirm && (
            <div style={{ padding: "12px", background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "6px", marginBottom: "12px" }}>
              <p style={{ fontSize: "12px", color: "var(--text2)", margin: "0 0 8px" }}>This will delete ALL modules and questions for "{c.name}". This cannot be undone.</p>
              <div style={{ display: "flex", gap: "8px" }}>
                <button className="btn" style={{ padding: "5px 12px", fontSize: "11px", background: "var(--red)", color: "#fff", border: "none" }} onClick={handleDeleteCompanyModules}>Confirm Delete All</button>
                <button className="btn btn-ghost" style={{ padding: "5px 12px", fontSize: "11px" }} onClick={() => setDeleteModulesConfirm(false)}>Cancel</button>
              </div>
            </div>
          )}

          {loadingModules ? (
            <p style={{ color: "var(--text3)", fontSize: "13px" }}>Loading modules...</p>
          ) : companyModules.length === 0 ? (
            <p style={{ color: "var(--text3)", fontSize: "13px" }}>No modules assigned yet. Upload an Excel file below.</p>
          ) : (
            <div style={{ maxHeight: "200px", overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Module ID</th>
                    <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Name</th>
                    <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Questions</th>
                    <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Owner</th>
                    <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {companyModules.map((m) => (
                    <tr key={m.id || m.module_id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "6px 8px", fontFamily: "var(--mono)", fontSize: "11px" }}>{m.module_id}</td>
                      <td style={{ padding: "6px 8px" }}>{m.name}</td>
                      <td style={{ padding: "6px 8px" }}>{m.total_quests || 0}</td>
                      <td style={{ padding: "6px 8px", color: "var(--text3)" }}>{m.primary_owner}</td>
                      <td style={{ padding: "6px 8px" }}>
                        {deleteModuleConfirm === m.module_id ? (
                          <span style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                            <button
                              style={{ padding: "2px 6px", fontSize: "10px", background: "var(--red)", color: "#fff", border: "none", borderRadius: "3px", cursor: "pointer" }}
                              onClick={() => handleDeleteSingleModule(m.module_id)}
                            >Yes</button>
                            <button
                              style={{ padding: "2px 6px", fontSize: "10px", background: "var(--bg4)", color: "var(--text2)", border: "1px solid var(--border)", borderRadius: "3px", cursor: "pointer" }}
                              onClick={() => setDeleteModuleConfirm(null)}
                            >No</button>
                          </span>
                        ) : (
                          <button
                            title="Delete module"
                            style={{ padding: "2px 6px", fontSize: "12px", background: "none", border: "none", cursor: "pointer" }}
                            onClick={() => setDeleteModuleConfirm(m.module_id)}
                          >🗑</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Add Module Form */}
        <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px", marginBottom: "20px" }}>
          <h4 style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", margin: "0 0 12px" }}>Add Module</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <div>
              <label style={{ fontSize: "11px", color: "var(--text3)", display: "block", marginBottom: "4px" }}>Module ID *</label>
              <input
                type="text"
                value={newModuleId}
                onChange={(e) => setNewModuleId(e.target.value)}
                placeholder="e.g. P - Policies & Governance"
                style={{ width: "100%", padding: "7px 10px", background: "var(--bg4)", border: "1px solid var(--border2)", borderRadius: "5px", color: "var(--text)", fontSize: "12px" }}
              />
            </div>
            <div>
              <label style={{ fontSize: "11px", color: "var(--text3)", display: "block", marginBottom: "4px" }}>Name *</label>
              <input
                type="text"
                value={newModuleName}
                onChange={(e) => setNewModuleName(e.target.value)}
                placeholder="e.g. Policies & Governance"
                style={{ width: "100%", padding: "7px 10px", background: "var(--bg4)", border: "1px solid var(--border2)", borderRadius: "5px", color: "var(--text)", fontSize: "12px" }}
              />
            </div>
            <div>
              <label style={{ fontSize: "11px", color: "var(--text3)", display: "block", marginBottom: "4px" }}>Owner (optional)</label>
              <input
                type="text"
                value={newModuleOwner}
                onChange={(e) => setNewModuleOwner(e.target.value)}
                placeholder="e.g. CISO"
                style={{ width: "100%", padding: "7px 10px", background: "var(--bg4)", border: "1px solid var(--border2)", borderRadius: "5px", color: "var(--text)", fontSize: "12px" }}
              />
            </div>
            <div>
              <label style={{ fontSize: "11px", color: "var(--text3)", display: "block", marginBottom: "4px" }}>Frequency (optional)</label>
              <input
                type="text"
                value={newModuleFrequency}
                onChange={(e) => setNewModuleFrequency(e.target.value)}
                placeholder="e.g. Monthly"
                style={{ width: "100%", padding: "7px 10px", background: "var(--bg4)", border: "1px solid var(--border2)", borderRadius: "5px", color: "var(--text)", fontSize: "12px" }}
              />
            </div>
          </div>
          <button
            className="btn btn-primary"
            style={{ marginTop: "12px", fontSize: "12px", padding: "7px 16px", opacity: addingModule ? 0.5 : 1 }}
            disabled={addingModule}
            onClick={handleAddModule}
          >
            {addingModule ? "Adding..." : "Add Module"}
          </button>
        </div>

        {/* Add Question Form */}
        <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px", marginBottom: "20px" }}>
          <h4 style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", margin: "0 0 12px" }}>Add Question</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <div>
              <label style={{ fontSize: "11px", color: "var(--text3)", display: "block", marginBottom: "4px" }}>Quest ID *</label>
              <input
                type="text"
                value={newQuestId}
                onChange={(e) => setNewQuestId(e.target.value)}
                placeholder="e.g. P-1.1"
                style={{ width: "100%", padding: "7px 10px", background: "var(--bg4)", border: "1px solid var(--border2)", borderRadius: "5px", color: "var(--text)", fontSize: "12px" }}
              />
            </div>
            <div>
              <label style={{ fontSize: "11px", color: "var(--text3)", display: "block", marginBottom: "4px" }}>Module ID *</label>
              <select
                value={newQuestModuleId}
                onChange={(e) => setNewQuestModuleId(e.target.value)}
                style={{ width: "100%", padding: "7px 10px", background: "var(--bg4)", border: "1px solid var(--border2)", borderRadius: "5px", color: "var(--text)", fontSize: "12px" }}
              >
                <option value="">Select module...</option>
                {companyModules.map((m) => (
                  <option key={m.module_id} value={m.module_id}>{m.module_id} - {m.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: "11px", color: "var(--text3)", display: "block", marginBottom: "4px" }}>Control Area</label>
              <input
                type="text"
                value={newQuestControlArea}
                onChange={(e) => setNewQuestControlArea(e.target.value)}
                placeholder="e.g. Policy Documentation"
                style={{ width: "100%", padding: "7px 10px", background: "var(--bg4)", border: "1px solid var(--border2)", borderRadius: "5px", color: "var(--text)", fontSize: "12px" }}
              />
            </div>
            <div>
              <label style={{ fontSize: "11px", color: "var(--text3)", display: "block", marginBottom: "4px" }}>Question Text</label>
              <input
                type="text"
                value={newQuestText}
                onChange={(e) => setNewQuestText(e.target.value)}
                placeholder="e.g. Is there a documented policy..."
                style={{ width: "100%", padding: "7px 10px", background: "var(--bg4)", border: "1px solid var(--border2)", borderRadius: "5px", color: "var(--text)", fontSize: "12px" }}
              />
            </div>
          </div>
          {questionError && (
            <p style={{ fontSize: "12px", color: "var(--red)", margin: "8px 0 0" }}>✗ {questionError}</p>
          )}
          <button
            className="btn btn-primary"
            style={{ marginTop: "12px", fontSize: "12px", padding: "7px 16px", opacity: addingQuestion ? 0.5 : 1 }}
            disabled={addingQuestion}
            onClick={handleAddQuestion}
          >
            {addingQuestion ? "Adding..." : "Add Question"}
          </button>
        </div>

        {/* Questions list with delete */}
        {companyQuestions.length > 0 && (
          <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px", marginBottom: "20px" }}>
            <h4 style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", margin: "0 0 12px" }}>
              Questions ({companyQuestions.length})
            </h4>
            <div style={{ maxHeight: "200px", overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Quest ID</th>
                    <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Module</th>
                    <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Control Area</th>
                    <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {companyQuestions.map((q) => (
                    <tr key={q.quest_id || q.questId} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "6px 8px", fontFamily: "var(--mono)", fontSize: "11px" }}>{q.quest_id || q.questId}</td>
                      <td style={{ padding: "6px 8px", fontSize: "11px" }}>{q.module_id || q.moduleId}</td>
                      <td style={{ padding: "6px 8px", fontSize: "11px", color: "var(--text3)" }}>{q.control_area || q.controlArea}</td>
                      <td style={{ padding: "6px 8px" }}>
                        {deleteQuestionConfirm === (q.quest_id || q.questId) ? (
                          <span style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                            <button
                              style={{ padding: "2px 6px", fontSize: "10px", background: "var(--red)", color: "#fff", border: "none", borderRadius: "3px", cursor: "pointer" }}
                              onClick={() => handleDeleteSingleQuestion(q.quest_id || q.questId)}
                            >Yes</button>
                            <button
                              style={{ padding: "2px 6px", fontSize: "10px", background: "var(--bg4)", color: "var(--text2)", border: "1px solid var(--border)", borderRadius: "3px", cursor: "pointer" }}
                              onClick={() => setDeleteQuestionConfirm(null)}
                            >No</button>
                          </span>
                        ) : (
                          <button
                            title="Delete question"
                            style={{ padding: "2px 6px", fontSize: "12px", background: "none", border: "none", cursor: "pointer" }}
                            onClick={() => setDeleteQuestionConfirm(q.quest_id || q.questId)}
                          >🗑</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Import for this company */}
        <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px" }}>
          <h4 style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", margin: "0 0 12px" }}>Import Modules for {c.name}</h4>

          <div
            style={{ ...styles.dropZone, padding: "24px 16px", ...(companyDragOver ? styles.dropZoneActive : {}) }}
            onDragOver={(e) => { e.preventDefault(); setCompanyDragOver(true); }}
            onDragLeave={() => setCompanyDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setCompanyDragOver(false); const f = e.dataTransfer.files[0]; if (f) { const err = validateFile(f); if (err) { showToast(err, "error"); } else { setCompanyImportFile(f); setCompanyImportResult(null); } } }}
            onClick={() => document.getElementById("company-file-input").click()}
          >
            <p style={{ color: "var(--text2)", fontSize: "13px", margin: 0 }}>
              <strong style={{ color: "var(--text)" }}>
                {companyImportFile ? companyImportFile.name : "Drop Excel file here or click to browse"}
              </strong>
            </p>
          </div>
          <input
            id="company-file-input"
            type="file"
            accept=".xlsx,.xls"
            style={{ display: "none" }}
            onChange={(e) => { if (e.target.files[0]) { const f = e.target.files[0]; const err = validateFile(f); if (err) { showToast(err, "error"); } else { setCompanyImportFile(f); setCompanyImportResult(null); } } e.target.value = ""; }}
          />

          <button
            className="btn btn-primary"
            style={{ marginTop: "12px", opacity: (!companyImportFile || companyImporting) ? 0.5 : 1 }}
            disabled={!companyImportFile || companyImporting}
            onClick={handleCompanyImport}
          >
            {companyImporting ? "Importing..." : `Import to ${c.name}`}
          </button>

          {companyImportResult && (
            <div style={{ ...styles.resultBox, marginTop: "12px" }}>
              <p style={{ fontSize: "13px", color: "var(--green)", margin: "0 0 4px", fontWeight: 600 }}>✓ Import Complete</p>
              <p style={{ fontSize: "12px", color: "var(--text2)", margin: "2px 0" }}>Modules: {companyImportResult.modulesImported} • Questions: {companyImportResult.questionsImported}</p>
              {companyImportResult.errors?.length > 0 && (
                <p style={{ fontSize: "11px", color: "var(--amber)", margin: "4px 0 0" }}>{companyImportResult.errors.length} warning(s)</p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  // --- Render Import Tab ---
  const renderImportTab = () => {
    if (loadingCompanies) return <div style={{ textAlign: "center", padding: "40px", color: "var(--text2)" }}><div className="loading-spinner" style={{ margin: "0 auto 12px" }} /><p>Loading...</p></div>;

    return (
      <div style={{ maxWidth: "640px" }}>
        <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "16px", color: "var(--text)" }}>Import Modules from Excel</h3>

        {/* File Drop Zone */}
        <div
          style={{ ...styles.dropZone, ...(dragOver ? styles.dropZoneActive : {}) }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFileSelect(f); }}
          onClick={() => document.getElementById("file-input").click()}
        >
          <div style={{ fontSize: "28px", marginBottom: "8px" }}>📄</div>
          <p style={{ color: "var(--text2)", fontSize: "13px", margin: 0 }}>
            <strong style={{ color: "var(--text)", display: "block", marginBottom: "4px" }}>
              {importFile ? importFile.name : "Drop Excel file here or click to browse"}
            </strong>
            {importFile
              ? `${(importFile.size / 1024).toFixed(1)} KB`
              : "Accepts .xlsx and .xls (max 10MB)"}
          </p>
        </div>
        <input
          id="file-input"
          type="file"
          accept=".xlsx,.xls"
          style={{ display: "none" }}
          onChange={(e) => { if (e.target.files[0]) handleFileSelect(e.target.files[0]); e.target.value = ""; }}
        />

        {/* Company Selector */}
        <div className="form-group" style={{ marginTop: "16px" }}>
          <label>Assign to Company (optional)</label>
          <select
            value={importCompanyId}
            onChange={(e) => setImportCompanyId(e.target.value)}
          >
            <option value="">— No direct assignment —</option>
            {companies.map(c => (
              <option key={c.id} value={c.id}>{c.name} ({c.domain})</option>
            ))}
          </select>
        </div>

        {/* Save as Template */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", margin: "12px 0" }}>
          <input
            type="checkbox"
            id="save-template"
            checked={saveAsTemplate}
            onChange={(e) => setSaveAsTemplate(e.target.checked)}
            style={{ width: "16px", height: "16px", accentColor: "var(--accent)" }}
          />
          <label htmlFor="save-template" style={{ fontSize: "13px", color: "var(--text2)", cursor: "pointer" }}>Save as Template</label>
        </div>

        {saveAsTemplate && (
          <div className="form-group">
            <label>Template Name</label>
            <input
              type="text"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="e.g. ISO 27001 Module Set"
            />
          </div>
        )}

        {/* Upload Button */}
        <button
          className="btn btn-primary"
          style={{ marginTop: "16px", opacity: (!importFile || importing) ? 0.5 : 1 }}
          disabled={!importFile || importing}
          onClick={handleImport}
        >
          {importing ? "Importing..." : "Upload & Import"}
        </button>

        {/* Import Result */}
        {importResult && (
          <div style={styles.resultBox}>
            <h4 style={{ fontSize: "14px", fontWeight: 600, color: "var(--green)", marginBottom: "8px" }}>✓ Import Complete</h4>
            <p style={{ fontSize: "13px", color: "var(--text2)", margin: "4px 0" }}>Modules imported: <strong style={{ color: "var(--text)" }}>{importResult.modulesImported}</strong></p>
            <p style={{ fontSize: "13px", color: "var(--text2)", margin: "4px 0" }}>Questions imported: <strong style={{ color: "var(--text)" }}>{importResult.questionsImported}</strong></p>
            {importResult.templateId && <p style={{ fontSize: "13px", color: "var(--accent2)", margin: "4px 0" }}>Template saved (ID: {importResult.templateId})</p>}
            {importResult.errors && importResult.errors.length > 0 && (
              <div style={{ marginTop: "8px" }}>
                <p style={{ fontSize: "12px", color: "var(--amber)", marginBottom: "4px" }}>Warnings ({importResult.errors.length}):</p>
                <ul style={{ paddingLeft: "16px", fontSize: "11px", color: "var(--text3)" }}>
                  {importResult.errors.slice(0, 10).map((err, i) => <li key={i}>{err}</li>)}
                  {importResult.errors.length > 10 && <li>...and {importResult.errors.length - 10} more</li>}
                </ul>
              </div>
            )}
          </div>
        )}

        {importError && (
          <div style={{ ...styles.resultBox, borderColor: "rgba(239,68,68,0.3)" }}>
            <p style={{ fontSize: "13px", color: "var(--red)" }}>✗ {importError}</p>
          </div>
        )}
      </div>
    );
  };

  // --- Render Modules Tab ---
  const renderModulesTab = () => {
    if (loadingTemplates) return <div style={{ textAlign: "center", padding: "40px", color: "var(--text2)" }}><div className="loading-spinner" style={{ margin: "0 auto 12px" }} /><p>Loading templates...</p></div>;
    if (errorTemplates) return <div style={{ textAlign: "center", padding: "40px", color: "var(--red)" }}>Error: {errorTemplates}<br /><button className="btn btn-ghost" style={{ marginTop: "12px" }} onClick={fetchTemplates}>Retry</button></div>;
    if (templates.length === 0) return <p style={{ color: "var(--text3)", textAlign: "center", padding: "40px" }}>No templates available. Import an Excel file and save as template first.</p>;

    return (
      <div>
        <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "16px", color: "var(--text)" }}>Module Templates</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {templates.map((tpl) => (
            <div key={tpl.id} style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: "8px", padding: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap" }}>
                <div style={{ flex: 1 }}>
                  <h4 style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", margin: "0 0 4px" }}>{tpl.name}</h4>
                  <p style={{ fontSize: "11px", color: "var(--text3)", fontFamily: "var(--mono)", margin: 0 }}>
                    {tpl.file_name} • {tpl.module_count} modules • {tpl.question_count} questions
                  </p>
                  <p style={{ fontSize: "11px", color: "var(--text3)", margin: "4px 0 0" }}>
                    Created: {new Date(tpl.created_at).toLocaleDateString()}
                  </p>
                </div>
                <button
                  className="btn"
                  style={{ padding: "4px 10px", fontSize: "11px", background: "rgba(239,68,68,0.12)", color: "var(--red)", border: "1px solid rgba(239,68,68,0.3)" }}
                  onClick={() => setDeleteConfirm(tpl.id)}
                >
                  Delete
                </button>
              </div>

              {/* Assign to company */}
              <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "12px", flexWrap: "wrap" }}>
                <select
                  value={assignCompanyId[tpl.id] || ""}
                  onChange={(e) => setAssignCompanyId(prev => ({ ...prev, [tpl.id]: e.target.value }))}
                  style={{ flex: 1, minWidth: "180px", padding: "7px 10px", background: "var(--bg4)", border: "1px solid var(--border2)", borderRadius: "5px", color: "var(--text)", fontSize: "12px" }}
                >
                  <option value="">Select company to assign...</option>
                  {companies.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.domain})</option>
                  ))}
                </select>
                <button
                  className="btn btn-primary"
                  style={{ padding: "7px 14px", fontSize: "12px" }}
                  onClick={() => handleAssignTemplate(tpl.id)}
                  disabled={!assignCompanyId[tpl.id]}
                >
                  Assign
                </button>
              </div>

              {/* Delete Confirmation */}
              {deleteConfirm === tpl.id && (
                <div style={{ marginTop: "12px", padding: "12px", background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "6px" }}>
                  <p style={{ fontSize: "12px", color: "var(--text2)", margin: "0 0 8px" }}>Are you sure you want to delete "{tpl.name}"?</p>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button className="btn" style={{ padding: "5px 12px", fontSize: "11px", background: "var(--red)", color: "#fff", border: "none" }} onClick={() => handleDeleteTemplate(tpl.id)}>Confirm Delete</button>
                    <button className="btn btn-ghost" style={{ padding: "5px 12px", fontSize: "11px" }} onClick={() => setDeleteConfirm(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  // --- Main Render ---
  return (
    <div className="page-container" style={{ minHeight: "100vh", background: "var(--bg)" }}>
      {/* Header */}
      <header style={{ padding: "20px 32px", borderBottom: "1px solid var(--border)", background: "var(--bg2)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
        <div>
          <div style={{ fontFamily: "var(--mono)", fontSize: "11px", color: "var(--accent2)", letterSpacing: "0.1em", textTransform: "uppercase" }}>PLATFORM ADMIN</div>
          <h1 style={{ fontSize: "20px", fontWeight: 600, marginTop: "4px", color: "var(--text)" }}>Super Admin Dashboard</h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "12px", color: "var(--text3)" }}>{user?.email}</span>
          <button onClick={onThemeToggle} className="btn btn-ghost" style={{ padding: "6px 10px" }}>
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          <button onClick={onLogout} className="btn" style={{ padding: "6px 14px", fontSize: "12px", background: "rgba(239,68,68,0.12)", color: "var(--red)", border: "1px solid rgba(239,68,68,0.3)" }}>
            Logout
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div style={styles.tabs}>
        {["companies", "modules", "import"].map((tab) => (
          <button
            key={tab}
            style={{ ...styles.tab, ...(activeTab === tab ? styles.tabActive : {}) }}
            onClick={() => setActiveTab(tab)}
          >
            {tab === "companies" ? "Companies" : tab === "modules" ? "Modules" : "Import"}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <main style={{ padding: "0 32px 32px" }}>
        {activeTab === "companies" && renderCompaniesTab()}
        {activeTab === "modules" && renderModulesTab()}
        {activeTab === "import" && renderImportTab()}
      </main>

      {/* Toast */}
      {toast && (
        <div className={`toast show ${toast.type === "success" ? "success" : ""}`} style={toast.type === "error" ? { borderColor: "rgba(239,68,68,0.3)" } : {}}>
          <span className="t-dot" style={toast.type === "error" ? { background: "var(--red)" } : {}} />
          {toast.message}
        </div>
      )}
    </div>
  );
}

// --- Helper styles ---
const thStyle = {
  textAlign: "left",
  padding: "10px 12px",
  fontSize: "11px",
  fontWeight: 600,
  color: "var(--text3)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  borderBottom: "1px solid var(--border)",
  whiteSpace: "nowrap",
};

const tdStyle = {
  padding: "10px 12px",
  fontSize: "13px",
  color: "var(--text)",
  verticalAlign: "middle",
};
