import { Link } from "react-router-dom";

const NAV_ITEMS = [
  { path: "/app", label: "Tracker", icon: "◎", roles: null },
  { path: "/app/dashboard", label: "Dashboard", icon: "◈", roles: null },
  { path: "/app/dpdp-compliance", label: "DPDP Compliance", icon: "◆", roles: null },
  { path: "/app/review", label: "Review", icon: "▣", roles: null },
  { path: "/app/admin", label: "Admin", icon: "⬡", roles: ["ADMIN"] },
  { path: "/app/auditors", label: "Auditors", icon: "◇", roles: ["ADMIN"] },
];

function isActive(currentPath, itemPath) {
  if (itemPath === "/app") {
    return currentPath === "/app" || currentPath === "/app/";
  }
  return currentPath.startsWith(itemPath);
}

export default function AppSidebar({ user, currentPath, branding }) {
  const userRole = user?.role;

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.roles || item.roles.includes(userRole)
  );

  return (
    <aside className="sidebar" style={{ justifyContent: "flex-start" }}>
      <div className="sidebar-header">
        {branding?.logoUrl ? (
          <img
            src={branding.logoUrl}
            alt={branding?.companyName || "Company logo"}
            style={{ maxHeight: 28, maxWidth: 140, marginBottom: 6 }}
          />
        ) : (
          <div className="logo">PRISM</div>
        )}
        <div className="sidebar-title">Compliance Platform</div>
      </div>

      <nav className="module-nav">
        {visibleItems.map((item) => {
          const active = isActive(currentPath, item.path);
          return (
            <div key={item.path} className="module-group">
              <Link
                to={item.path}
                className={`module-btn ${active ? "active" : ""}`}
                style={{ textDecoration: "none" }}
              >
                <span style={{ fontSize: 16, flexShrink: 0 }}>{item.icon}</span>
                <div className="module-btn-text">
                  <div className="module-name">{item.label}</div>
                </div>
              </Link>
            </div>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        {user && (
          <div style={{ fontSize: 11, color: "var(--text3)" }}>
            <span style={{ color: "var(--text2)", fontWeight: 500 }}>{user.email}</span>
            {user.role && (
              <span style={{ marginLeft: 8, textTransform: "uppercase", letterSpacing: "0.06em", fontSize: 9 }}>
                {user.role}
              </span>
            )}
          </div>
        )}
        <button
          onClick={() => window.dispatchEvent(new Event("open-cookie-banner"))}
          style={{
            marginTop: 10,
            background: "none",
            border: "none",
            color: "var(--text3)",
            fontSize: 11,
            cursor: "pointer",
            padding: 0,
            textDecoration: "underline",
          }}
        >
          Cookie Settings
        </button>
      </div>
    </aside>
  );
}
