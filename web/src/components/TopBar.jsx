import { useNavigate } from "react-router-dom";
import { useState } from "react";
import NotificationBell from "./NotificationBell.jsx";
import { apiFetch } from "../api/client.js";

export default function TopBar({
  currentIndex,
  total,
  onNavigate,
  onSaveDraft,
  onSubmitReview,
  onLogout,
  user,
  company,
  branding,
  theme,
  onThemeToggle,
  onMenuToggle,
  token,
}) {
  const navigate = useNavigate();
  const [actionsOpen, setActionsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileName, setProfileName] = useState(user?.fullName || "");
  const [profileDept, setProfileDept] = useState(user?.department || "");
  const [profileTitle, setProfileTitle] = useState(user?.jobTitle || "");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState("");
  const progress = total > 0 ? ((currentIndex + 1) / total) * 100 : 0;
  const showAdmin = user?.role === "ADMIN";
  const showReview = user?.role === "ADMIN" || user?.role === "LEAD";
  const isViewer = user?.role === "VIEWER";

  return (
    <div className="topbar">
      <div className="progress-area">
        {onMenuToggle && (
          <button
            className="nav-btn mobile-menu-btn"
            onClick={onMenuToggle}
            aria-label="Toggle navigation menu"
          >
            ☰
          </button>
        )}
        {branding?.logoUrl && (
          <img src={branding.logoUrl} alt={company?.name || "Company"} className="topbar-logo" />
        )}
        <button
          className="nav-btn nav-btn-progress"
          onClick={() => onNavigate(-1)}
          disabled={currentIndex === 0}
        >
          &#x2039;
        </button>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progress}%` }}></div>
        </div>
        <button
          className="nav-btn nav-btn-progress"
          onClick={() => onNavigate(1)}
          disabled={currentIndex === total - 1}
        >
          &#x203A;
        </button>
        <span className="quest-counter">
          {currentIndex + 1} of {total}
        </span>
      </div>
      <div className={`topbar-actions ${actionsOpen ? "actions-open" : ""}`}>
        <div className="user-chip" style={{ cursor: "pointer" }} onClick={() => { setProfileOpen(true); setProfileMsg(""); }} title="Edit profile">
          <span className="user-email">{user?.fullName || user?.email || "Unknown user"}</span>
          {company?.domain && <span className="user-company">{company.domain}</span>}
          {user?.role && <span className="user-role">{user.role}</span>}
        </div>
        {token && <NotificationBell token={token} />}
        {onThemeToggle && (
          <button className="btn btn-ghost theme-toggle" onClick={onThemeToggle} title="Toggle theme">
            {theme === "dark" ? "\u2600" : "\u263E"}
          </button>
        )}
        {showAdmin && (
          <button className="btn btn-ghost" onClick={() => navigate("/admin")}>Admin</button>
        )}
        {showReview && (
          <button className="btn btn-ghost" onClick={() => navigate("/review")}>Review</button>
        )}
        <button className="btn btn-ghost" onClick={() => navigate("/dashboard")}>Dashboard</button>
        {!isViewer && (
          <button className="btn btn-ghost" onClick={() => navigate("/vault")}>Vault</button>
        )}
        {!isViewer && (
          <>
            <button className="btn btn-ghost" onClick={onSaveDraft}>
              Save draft
            </button>
            <button className="btn btn-primary" onClick={onSubmitReview}>
              Submit for review
            </button>
          </>
        )}
        <button className="btn btn-ghost" onClick={onLogout}>
          Logout
        </button>
      </div>
      {/* Mobile actions toggle */}
      <button
        className="mobile-actions-toggle"
        onClick={() => setActionsOpen((v) => !v)}
        aria-label="Toggle actions menu"
      >
        ⋮
      </button>

      {/* Profile modal */}
      {profileOpen && (
        <div className="modal-overlay" onClick={() => setProfileOpen(false)}>
          <div className="module-modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="module-modal-header">
              <div className="module-modal-title">My Profile</div>
              <button className="modal-close" onClick={() => setProfileOpen(false)}>×</button>
            </div>
            <div className="module-modal-content" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--text3)", display: "block", marginBottom: 4 }}>Full Name</label>
                <input type="text" value={profileName} onChange={e => setProfileName(e.target.value)} placeholder="Your name" style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--text3)", display: "block", marginBottom: 4 }}>Department</label>
                <input type="text" value={profileDept} onChange={e => setProfileDept(e.target.value)} placeholder="e.g. Engineering" style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--text3)", display: "block", marginBottom: 4 }}>Job Title</label>
                <input type="text" value={profileTitle} onChange={e => setProfileTitle(e.target.value)} placeholder="e.g. Security Lead" style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontSize: 13, boxSizing: "border-box" }} />
              </div>
              {profileMsg && <p style={{ fontSize: 13, color: profileMsg.startsWith("✗") ? "var(--red)" : "var(--green)", margin: 0 }}>{profileMsg}</p>}
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary" style={{ flex: 1 }} disabled={profileSaving} onClick={async () => {
                  setProfileSaving(true); setProfileMsg("");
                  try {
                    await apiFetch("/api/users/me", { token, method: "PUT", body: JSON.stringify({ fullName: profileName, department: profileDept, jobTitle: profileTitle }) });
                    setProfileMsg("✓ Saved");
                  } catch (e) { setProfileMsg("✗ " + e.message); }
                  finally { setProfileSaving(false); }
                }}>
                  {profileSaving ? "Saving…" : "Save"}
                </button>
                <button className="btn btn-ghost" onClick={() => setProfileOpen(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
