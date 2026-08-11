import { useState, lazy, Suspense } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../api/client.js";
import Logo from "../components/Logo";

const LoginHero = lazy(() => import("../components/LoginHero"));

export default function AcceptInvite({ onLogin }) {
  const navigate = useNavigate();
  const { token } = useParams();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!token) {
      setError("Invitation token missing");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      const data = await apiFetch("/api/auth/accept-invitation", {
        method: "POST",
        body: JSON.stringify({ token, password })
      });
      onLogin(data);
      navigate("/tracker");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-split">
      {/* Left Panel - Form */}
      <div className="login-split-left">
        <div className="login-form-inner">
          <div className="login-logo-wrap">
            <Logo className="login-logo" />
          </div>
          <h1 className="login-heading">Accept Invitation</h1>
          <p className="login-subtitle">Set your password to join the workspace</p>

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="password">Password</label>
              <div className="password-input-wrap">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm Password</label>
              <div className="password-input-wrap">
                <input
                  id="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            {error && <p className="error-text">{error}</p>}

            <button type="submit" disabled={loading} className="login-btn">
              {loading ? "Joining..." : "Join Workspace"} <span className="btn-arrow">→</span>
            </button>
          </form>

          <div className="auth-footer">
            <span>Have access already?</span>
            <Link to="/login">Sign in</Link>
          </div>
        </div>
      </div>

      {/* Right Panel - Animated Hero */}
      <div className="login-split-right">
        <Suspense fallback={<div className="lh-root"><div className="lh-bg" /></div>}>
          <LoginHero />
        </Suspense>
      </div>
    </div>
  );
}
