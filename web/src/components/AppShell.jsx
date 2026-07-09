import { Outlet, useLocation } from "react-router-dom";
import TopBar from "./TopBar.jsx";
import AppSidebar from "./AppSidebar.jsx";

function TrialBanner({ company }) {
  if (!company?.billingStatus || !company?.trialEndsAt) return null;
  if (company.billingStatus !== "trial") return null;

  const daysLeft = Math.ceil((new Date(company.trialEndsAt) - new Date()) / (1000 * 60 * 60 * 24));
  if (daysLeft > 7) return null; // only show banner in last 7 days

  const urgent = daysLeft <= 2;
  return (
    <div style={{
      background: urgent ? "rgba(239,68,68,0.12)" : "rgba(245,158,11,0.12)",
      borderBottom: `1px solid ${urgent ? "rgba(239,68,68,0.3)" : "rgba(245,158,11,0.3)"}`,
      padding: "8px 24px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      fontSize: 13,
      color: urgent ? "var(--red)" : "var(--amber)",
      fontWeight: 500,
    }}>
      <span>
        {daysLeft <= 0
          ? "Your free trial has ended."
          : `Your free trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`}
        {" "}Contact us to upgrade your plan.
      </span>
      <a href="mailto:ab@neozaar.com" style={{ color: "inherit", fontWeight: 700, textDecoration: "underline" }}>
        Contact us →
      </a>
    </div>
  );
}

export default function AppShell({
  token,
  user,
  company,
  branding,
  onLogout,
  theme,
  onThemeToggle
}) {
  const location = useLocation();

  return (
    <div className="app-shell">
      <AppSidebar
        user={user}
        currentPath={location.pathname}
        branding={branding}
      />
      <div className="app-shell-main">
        <TopBar
          user={user}
          company={company}
          branding={branding}
          onLogout={onLogout}
          theme={theme}
          onThemeToggle={onThemeToggle}
        />
        <TrialBanner company={company} />
        <div className="app-shell-content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
