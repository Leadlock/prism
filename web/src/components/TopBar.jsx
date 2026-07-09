import { useNavigate } from "react-router-dom";

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
  onThemeToggle
}) {
  const navigate = useNavigate();
  const progress = total > 0 ? ((currentIndex + 1) / total) * 100 : 0;
  const showAdmin = user?.role === "ADMIN";
  const showReview = user?.role === "ADMIN" || user?.role === "LEAD";
  const isViewer = user?.role === "VIEWER";

  return (
    <div className="topbar">
      <div className="progress-area">
        {branding?.logoUrl && (
          <img src={branding.logoUrl} alt={company?.name || "Company"} className="topbar-logo" />
        )}
        <button
          className="nav-btn"
          onClick={() => onNavigate(-1)}
          disabled={currentIndex === 0}
        >
          &#x2039;
        </button>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progress}%` }}></div>
        </div>
        <button
          className="nav-btn"
          onClick={() => onNavigate(1)}
          disabled={currentIndex === total - 1}
        >
          &#x203A;
        </button>
        <span className="quest-counter">
          {currentIndex + 1} of {total}
        </span>
      </div>
      <div className="topbar-actions">
        <div className="user-chip">
          <span className="user-email">{user?.email || "Unknown user"}</span>
          {company?.domain && <span className="user-company">{company.domain}</span>}
          {user?.role && <span className="user-role">{user.role}</span>}
        </div>
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
    </div>
  );
}
