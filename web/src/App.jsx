import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "./api/client.js";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import AcceptInvite from "./pages/AcceptInvite.jsx";
import AdminPanel from "./pages/AdminPanel.jsx";
import AuditorPanel from "./pages/AuditorPanel.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Review from "./pages/Review.jsx";
import Tracker from "./pages/Tracker.jsx";
import SuperAdminDashboard from "./pages/SuperAdminDashboard.jsx";
import Homepage from "./pages/Homepage.jsx";
import PrismTest from "./pages/PrismTest.jsx";
import DPDPAssess from "./pages/DPDPAssess.jsx";
import ISO27001Assess from "./pages/ISO27001Assess.jsx";
import GDPRAssess from "./pages/GDPRAssess.jsx";

const API_URL = import.meta.env.VITE_API_URL || "";

const getStoredAuth = () => {
  const token   = localStorage.getItem("token");
  const user    = localStorage.getItem("user");
  const company = localStorage.getItem("company");
  return {
    token,
    user:    user    ? JSON.parse(user)    : null,
    company: company ? JSON.parse(company) : null
  };
};

const getStoredBranding = () => {
  const branding = localStorage.getItem("branding");
  return branding ? JSON.parse(branding) : null;
};

function BlockedScreen({ message, onDismiss }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <div style={{
        background: "var(--bg2, #fff)", borderRadius: 12, padding: "40px 36px",
        maxWidth: 440, width: "100%", textAlign: "center", boxShadow: "0 24px 64px rgba(0,0,0,0.3)",
      }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>🔒</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12, color: "var(--text, #111)" }}>
          Access Restricted
        </h2>
        <p style={{ fontSize: 14, color: "var(--text2, #555)", lineHeight: 1.6, marginBottom: 28 }}>
          {message}
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <a href="mailto:ab@neozaar.com" style={{
            display: "inline-block", padding: "10px 22px", borderRadius: 8,
            background: "var(--accent, #2563eb)", color: "#fff", fontWeight: 600,
            fontSize: 14, textDecoration: "none",
          }}>Contact us</a>
          <button onClick={onDismiss} style={{
            padding: "10px 22px", borderRadius: 8, border: "1px solid var(--border, #ddd)",
            background: "transparent", color: "var(--text2, #555)", fontWeight: 600,
            fontSize: 14, cursor: "pointer",
          }}>Sign out</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [auth,  setAuth]  = useState(() => getStoredAuth());
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "light");
  const [branding, setBranding] = useState(() => getStoredBranding());
  const [blockedMessage, setBlockedMessage] = useState("");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  // Apply branding color as CSS custom property
  useEffect(() => {
    if (branding?.primaryColor) {
      document.documentElement.style.setProperty("--brand-color", branding.primaryColor);
      document.documentElement.style.setProperty("--accent", branding.primaryColor);
    } else {
      document.documentElement.style.removeProperty("--brand-color");
      document.documentElement.style.removeProperty("--accent");
    }
  }, [branding]);

  // Fetch company settings when authenticated (non-SUPERADMIN)
  useEffect(() => {
    if (auth.token && auth.user?.role !== "SUPERADMIN") {
      fetchBranding(auth.token);
    } else if (!auth.token) {
      setBranding(null);
      localStorage.removeItem("branding");
    }
  }, [auth.token]);

  const fetchBranding = async (token) => {
    try {
      const settings = await apiFetch("/api/settings", { token });
      const brandingData = {
        logoUrl: settings.logoUrl ? `${API_URL}${settings.logoUrl}` : null,
        primaryColor: settings.primaryColor || null,
        aiEnabled: settings.aiEnabled
      };
      setBranding(brandingData);
      localStorage.setItem("branding", JSON.stringify(brandingData));
    } catch {
      // Non-critical - use defaults
    }
  };

  const handleLogin = (session) => {
    localStorage.setItem("token",   session.token);
    localStorage.setItem("user",    JSON.stringify(session.user));
    localStorage.setItem("company", JSON.stringify(session.company));
    setAuth({ token: session.token, user: session.user, company: session.company });
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("company");
    localStorage.removeItem("branding");
    setAuth({ token: null, user: null, company: null });
    setBranding(null);
    setBlockedMessage("");
  };

  useEffect(() => {
    const onBlocked = (e) => {
      const msg = e.detail?.message || "Your account access has been revoked. Please contact the administrator.";
      setBlockedMessage(msg);
    };
    const onBillingBlocked = (e) => {
      const msg = e.detail?.message || "Your subscription has ended. Please contact us to continue.";
      setBlockedMessage(msg);
    };
    window.addEventListener("auth:company-blocked", onBlocked);
    window.addEventListener("auth:billing-blocked", onBillingBlocked);
    return () => {
      window.removeEventListener("auth:company-blocked", onBlocked);
      window.removeEventListener("auth:billing-blocked", onBillingBlocked);
    };
  }, []);

  const handleThemeToggle = () => setTheme(t => t === "dark" ? "light" : "dark");

  const authProps = useMemo(() => ({
    token:          auth.token,
    user:           auth.user,
    company:        auth.company,
    branding,
    onLogout:       handleLogout,
    theme,
    onThemeToggle:  handleThemeToggle
  }), [auth, theme, branding]);

  const isAuthenticated  = Boolean(auth.token);
  const role             = auth.user?.role;
  const isSuperAdmin     = role === "SUPERADMIN";
  const isAdmin          = role === "ADMIN";
  const isLeadOrAdmin    = role === "ADMIN" || role === "LEAD";
  const isViewer         = role === "VIEWER";
  const isAuditor        = role === "AUDITOR";

  // Where to send an authenticated user who hits "/"
  const defaultRoute = () => {
    if (isSuperAdmin) return "/superadmin";
    if (isAuditor) return "/dashboard";
    if (isViewer)  return "/review";
    return "/tracker";
  };

  return (
    <BrowserRouter>
      {blockedMessage && <BlockedScreen message={blockedMessage} onDismiss={handleLogout} />}
      <Routes>
        {/* Public homepage — redirects authenticated users to their home */}
        <Route
          path="/"
          element={isAuthenticated ? <Navigate to={defaultRoute()} replace /> : <Homepage />}
        />
        <Route
          path="/home"
          element={isAuthenticated ? <Navigate to={defaultRoute()} replace /> : <Homepage />}
        />

        {/* PRISM DPDP module — public */}
        <Route path="/test" element={<PrismTest />} />

        {/* Public assessment pages */}
        <Route path="/assess/dpdp" element={<DPDPAssess />} />
        <Route path="/assess/iso27001" element={<ISO27001Assess />} />
        <Route path="/assess/gdpr" element={<GDPRAssess />} />

        <Route
          path="/login"
          element={isAuthenticated ? <Navigate to={defaultRoute()} replace /> : <Login onLogin={handleLogin} />}
        />
        <Route
          path="/register"
          element={isAuthenticated ? <Navigate to={defaultRoute()} replace /> : <Register />}
        />
        <Route
          path="/accept-invite/:token"
          element={isAuthenticated ? <Navigate to={defaultRoute()} replace /> : <AcceptInvite onLogin={handleLogin} />}
        />

        {/* Admin-only routes */}
        <Route
          path="/admin"
          element={isAuthenticated && isAdmin ? <AdminPanel {...authProps} /> : <Navigate to={isAuthenticated ? defaultRoute() : "/login"} replace />}
        />
        <Route
          path="/auditors"
          element={isAuthenticated && isAdmin ? <AuditorPanel {...authProps} /> : <Navigate to={isAuthenticated ? defaultRoute() : "/login"} replace />}
        />

        {/* Super Admin route */}
        <Route
          path="/superadmin"
          element={isAuthenticated && isSuperAdmin ? <SuperAdminDashboard {...authProps} /> : <Navigate to={isAuthenticated ? defaultRoute() : "/login"} replace />}
        />

        {/* Dashboard — all roles */}
        <Route
          path="/dashboard"
          element={isAuthenticated ? <Dashboard {...authProps} /> : <Navigate to="/login" replace />}
        />

        {/* Review — ADMIN, LEAD, VIEWER */}
        <Route
          path="/review"
          element={
            isAuthenticated && (isLeadOrAdmin || isViewer)
              ? <Review {...authProps} />
              : <Navigate to={isAuthenticated ? defaultRoute() : "/login"} replace />
          }
        />

        {/* Tracker — not for VIEWER, AUDITOR, or SUPERADMIN */}
        <Route
          path="/tracker"
          element={
            isAuthenticated
              ? (isViewer || isAuditor || isSuperAdmin ? <Navigate to={defaultRoute()} replace /> : <Tracker {...authProps} />)
              : <Navigate to="/" replace />
          }
        />

        <Route path="*" element={<Navigate to={isAuthenticated ? defaultRoute() : "/"} replace />} />
      </Routes>
    </BrowserRouter>
  );
}
