import { useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api/client.js";

const INDUSTRIES = [
  "Technology",
  "Finance",
  "Healthcare",
  "Education",
  "Retail",
  "Manufacturing",
  "Other"
];

const COMPANY_SIZES = [
  "1–10 employees",
  "11–50 employees",
  "51–200 employees",
  "201–1000 employees",
  "1000+ employees"
];

const EyeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);

const EyeOffIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
  </svg>
);

export default function Register() {
  const [form, setForm] = useState({
    companyName: "",
    industry: "",
    companySize: "",
    fullName: "",
    adminEmail: "",
    department: "",
    jobTitle: "",
    password: "",
    confirmPassword: ""
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const update = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }));

  // Blocked email domains
  const BLOCKED_DOMAINS = [
    "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "yahoo.co.in",
    "hotmail.com", "outlook.com", "live.com", "msn.com",
    "icloud.com", "me.com", "mac.com",
    "aol.com", "protonmail.com", "proton.me",
    "mail.com", "zoho.com", "yandex.com",
    "gmx.com", "gmx.net", "tutanota.com",
    "fastmail.com", "hushmail.com"
  ];

  const validatePassword = (pwd) => {
    const issues = [];
    if (pwd.length < 8) issues.push("at least 8 characters");
    if (!/[A-Z]/.test(pwd)) issues.push("one uppercase letter");
    if (!/[a-z]/.test(pwd)) issues.push("one lowercase letter");
    if (!/[0-9]/.test(pwd)) issues.push("one number");
    if (!/[^A-Za-z0-9]/.test(pwd)) issues.push("one special character");
    return issues;
  };

  const validateEmail = (email) => {
    const domain = email.split("@")[1]?.toLowerCase();
    if (domain && BLOCKED_DOMAINS.includes(domain)) {
      return "Please use a corporate email address";
    }
    return null;
  };

  const passwordIssues = form.password ? validatePassword(form.password) : [];
  const emailError = form.adminEmail ? validateEmail(form.adminEmail) : null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (emailError) {
      setError(emailError);
      return;
    }

    if (passwordIssues.length > 0) {
      setError("Password must contain: " + passwordIssues.join(", "));
      return;
    }

    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      // Generate domain from company name
      const domain = form.companyName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

      await apiFetch("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          companyName: form.companyName,
          domain,
          industry: form.industry,
          companySize: form.companySize,
          fullName: form.fullName,
          adminEmail: form.adminEmail,
          department: form.department,
          jobTitle: form.jobTitle,
          password: form.password
        })
      });

      setSubmitted(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="register-container">
        <div className="register-card">
          <div className="register-success">
            <span className="register-success-icon">&#10003;</span>
            <h1>Registration Submitted</h1>
            <p>Your company account is pending approval by a platform administrator. You will be able to sign in once your account has been approved.</p>
            <Link to="/login" className="btn btn-primary">Back to Sign In</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="register-container">
      <div className="register-card">
        <h1>Create Your Workspace</h1>
        <p className="register-subtitle">Set up your company's compliance tracking environment</p>

        <form onSubmit={handleSubmit}>
          {/* Company Information */}
          <div className="register-section">
            <h2>Company Information</h2>

            <div className="form-group">
              <label htmlFor="companyName">Company Name <span className="required">*</span></label>
              <input
                id="companyName"
                type="text"
                value={form.companyName}
                onChange={update("companyName")}
                required
                placeholder="Acme Corporation"
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="industry">Industry <span className="required">*</span></label>
                <select id="industry" value={form.industry} onChange={update("industry")} required>
                  <option value="">Select industry...</option>
                  {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="companySize">Company Size <span className="required">*</span></label>
                <select id="companySize" value={form.companySize} onChange={update("companySize")} required>
                  <option value="">Select size...</option>
                  {COMPANY_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Administrator Account */}
          <div className="register-section">
            <h2>Administrator Account</h2>

            <div className="form-group">
              <label htmlFor="fullName">Full Name <span className="required">*</span></label>
              <input
                id="fullName"
                type="text"
                value={form.fullName}
                onChange={update("fullName")}
                required
                placeholder="John Smith"
              />
            </div>

            <div className="form-group">
              <label htmlFor="adminEmail">Email Address <span className="required">*</span></label>
              <input
                id="adminEmail"
                type="email"
                value={form.adminEmail}
                onChange={update("adminEmail")}
                required
                placeholder="john@acme.com"
                className={emailError ? "input-error" : ""}
              />
              {emailError && <span className="field-error">{emailError}</span>}
              <span className="field-hint">Must be a corporate email (no Gmail, Yahoo, iCloud, etc.)</span>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="department">Department <span className="required">*</span></label>
                <input
                  id="department"
                  type="text"
                  value={form.department}
                  onChange={update("department")}
                  required
                  placeholder="IT / Security"
                />
              </div>

              <div className="form-group">
                <label htmlFor="jobTitle">Job Title <span className="required">*</span></label>
                <input
                  id="jobTitle"
                  type="text"
                  value={form.jobTitle}
                  onChange={update("jobTitle")}
                  required
                  placeholder="CISO"
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="password">Password <span className="required">*</span></label>
                <div className="password-input-wrap">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={update("password")}
                    required
                    minLength={8}
                    placeholder="Min 8 characters"
                    className={form.password && passwordIssues.length > 0 ? "input-error" : ""}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
                {form.password && passwordIssues.length > 0 && (
                  <span className="field-error">Needs: {passwordIssues.join(", ")}</span>
                )}
                {form.password && passwordIssues.length === 0 && (
                  <span className="field-success">Strong password</span>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="confirmPassword">Confirm Password <span className="required">*</span></label>
                <div className="password-input-wrap">
                  <input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    value={form.confirmPassword}
                    onChange={update("confirmPassword")}
                    required
                    minLength={8}
                    placeholder="Repeat password"
                    className={form.confirmPassword && form.confirmPassword !== form.password ? "input-error" : ""}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                  >
                    {showConfirmPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
                {form.confirmPassword && form.confirmPassword !== form.password && (
                  <span className="field-error">Passwords do not match</span>
                )}
              </div>
            </div>
          </div>

          {error && <p className="error-text">{error}</p>}

          <button type="submit" disabled={loading} className="btn-primary register-submit">
            {loading ? "Submitting..." : "Register Company"}
          </button>
        </form>

        <div className="auth-footer">
          <span>Already have an account?</span>
          <Link to="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
