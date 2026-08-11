import { Router } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { getClient, mapRow, query } from "../db/index.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { DEFAULT_LIST_ITEMS } from "../utils/defaultLists.js";
import { writeAuditLog } from "../utils/auditLog.js";
import { sendEmail } from "../utils/email.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again in 15 minutes." },
});

router.post("/register", asyncHandler(async (req, res) => {
  const { companyName, domain, industry, companySize, fullName, adminEmail, department, jobTitle, password } = req.body;
  const trimmedName = typeof companyName === "string" ? companyName.trim() : "";
  const normalizedDomain = typeof domain === "string" ? domain.trim().toLowerCase().replace(/\s+/g, "-") : "";
  const normalizedEmail = typeof adminEmail === "string" ? adminEmail.trim().toLowerCase() : "";
  const domainPattern = /^[a-z0-9-]+$/;
  
  if (!trimmedName || !normalizedDomain || !normalizedEmail || !password || !fullName) {
    return res.status(400).json({ error: "Company name, domain, full name, email, and password are required" });
  }

  if (!domainPattern.test(normalizedDomain)) {
    return res.status(400).json({ error: "Domain must use lowercase letters, numbers, and hyphens only" });
  }

  // Corporate email validation — block generic providers
  const blockedDomains = [
    "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "yahoo.co.in",
    "hotmail.com", "outlook.com", "live.com", "msn.com",
    "icloud.com", "me.com", "mac.com",
    "aol.com", "protonmail.com", "proton.me",
    "mail.com", "zoho.com", "yandex.com",
    "gmx.com", "gmx.net", "tutanota.com",
    "fastmail.com", "hushmail.com"
  ];
  const emailDomain = normalizedEmail.split("@")[1];
  if (!emailDomain || blockedDomains.includes(emailDomain)) {
    return res.status(400).json({ error: "Please use a corporate email address. Generic email providers (Gmail, Yahoo, iCloud, etc.) are not accepted." });
  }

  // Password strength validation
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters long" });
  }
  if (!/[A-Z]/.test(password)) {
    return res.status(400).json({ error: "Password must contain at least one uppercase letter" });
  }
  if (!/[a-z]/.test(password)) {
    return res.status(400).json({ error: "Password must contain at least one lowercase letter" });
  }
  if (!/[0-9]/.test(password)) {
    return res.status(400).json({ error: "Password must contain at least one number" });
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return res.status(400).json({ error: "Password must contain at least one special character" });
  }
  
  const existingCompany = await query("SELECT id FROM companies WHERE domain = $1", [normalizedDomain]);
  if (existingCompany.rows.length > 0) {
    return res.status(400).json({ error: "Company domain already exists" });
  }
  
  const existingUser = await query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
  if (existingUser.rows.length > 0) {
    return res.status(400).json({ error: "Email already registered" });
  }
  
  const passwordHash = await bcrypt.hash(password, 10);
  const client = await getClient();
  let company;
  let user;

  try {
    await client.query("BEGIN");

    const companyResult = await client.query(
      "INSERT INTO companies (name, domain, admin_email, industry, company_size, status) VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING id, name, domain, status",
      [trimmedName, normalizedDomain, normalizedEmail, industry || null, companySize || null]
    );
    company = mapRow(companyResult);

    const userResult = await client.query(
      "INSERT INTO users (email, password_hash, full_name, department, job_title, role, company_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, email, role, company_id",
      [normalizedEmail, passwordHash, fullName.trim(), department || null, jobTitle || null, "ADMIN", company.id]
    );
    user = mapRow(userResult);

    for (const item of DEFAULT_LIST_ITEMS) {
      await client.query(
        "INSERT INTO list_items (company_id, list_name, value, color) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
        [company.id, item.listName, item.value, item.color || null]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  // Do NOT issue a token — company must be approved first
  res.status(201).json({
    message: "Registration submitted. Your account is pending approval by a platform administrator.",
    company: { id: company.id, name: company.name, domain: company.domain, status: "pending" }
  });
}));

router.post("/login", loginLimiter, asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  
  if (!normalizedEmail || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }

  // Check super_admins table first
  const superResult = await query(
    "SELECT id, email, password_hash FROM super_admins WHERE email = $1",
    [normalizedEmail]
  );
  const superAdmin = mapRow(superResult);

  if (superAdmin) {
    const valid = await bcrypt.compare(password, superAdmin.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { userId: superAdmin.id, email: superAdmin.email, role: "SUPERADMIN", companyId: null },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({
      token,
      user: { id: superAdmin.id, email: superAdmin.email, role: "SUPERADMIN", companyId: null },
      company: null
    });
  }

  // Regular user login
  const result = await query(
    `SELECT u.id, u.email, u.role, u.password_hash, u.company_id, u.onboarding_completed,
            c.name AS company_name, c.domain AS company_domain, c.status AS company_status,
            c.plan AS company_plan, c.billing_status, c.trial_ends_at
     FROM users u JOIN companies c ON c.id = u.company_id WHERE u.email = $1`,
    [normalizedEmail]
  );
  const user = mapRow(result);
  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  // Check company approval status
  if (user.companyStatus === "pending") {
    return res.status(403).json({ error: "Your company registration is pending approval. Please wait for a platform administrator to approve your account." });
  }
  if (user.companyStatus === "rejected") {
    return res.status(403).json({ error: "Your company registration has been rejected. Please contact the platform administrator." });
  }

  // Auditor-specific access checks
  if (user.role === "AUDITOR") {
    const profileResult = await query(
      "SELECT active, start_date, expiry_date FROM auditor_profiles WHERE user_id = $1",
      [user.id]
    );
    const profile = mapRow(profileResult);
    if (!profile || !profile.active) {
      return res.status(403).json({ error: "Auditor account is inactive" });
    }
    const today = new Date(); today.setHours(0,0,0,0);
    const expiry = new Date(profile.expiryDate); expiry.setHours(0,0,0,0);
    if (expiry < today) {
      await query("UPDATE auditor_profiles SET active = FALSE, updated_at = NOW() WHERE user_id = $1", [user.id]);
      return res.status(403).json({ error: "Auditor access has expired" });
    }
  }

  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.role, companyId: user.companyId },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
  
  res.json({
    token,
    user: { id: user.id, email: user.email, role: user.role, companyId: user.companyId, onboardingCompleted: user.onboardingCompleted },
    company: {
      id:            user.companyId,
      name:          user.companyName,
      domain:        user.companyDomain,
      plan:          user.companyPlan,
      billingStatus: user.billingStatus,
      trialEndsAt:   user.trialEndsAt,
    }
  });
}));

router.post("/accept-invitation", asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  
  if (!token || !password) {
    return res.status(400).json({ error: "Token and password required" });
  }
  
  const invitationResult = await query("SELECT * FROM invitations WHERE token = $1", [token]);
  const invitation = mapRow(invitationResult);
  if (!invitation || invitation.acceptedAt || new Date(invitation.expiresAt) < new Date()) {
    return res.status(400).json({ error: "Invalid or expired invitation" });
  }
  
  const passwordHash = await bcrypt.hash(password, 10);
  const client = await getClient();
  let user;
  let company;

  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      "INSERT INTO users (email, password_hash, role, company_id) VALUES ($1, $2, $3, $4) RETURNING id, email, role, company_id",
      [invitation.email, passwordHash, invitation.role, invitation.companyId]
    );
    user = mapRow(userResult);

    await client.query("UPDATE invitations SET accepted_at = NOW() WHERE id = $1", [invitation.id]);

    const companyResult = await client.query(
      "SELECT id, name, domain FROM companies WHERE id = $1",
      [invitation.companyId]
    );
    company = mapRow(companyResult);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  
  const authToken = jwt.sign(
    { userId: user.id, email: user.email, role: user.role, companyId: user.companyId },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
  
  res.json({
    token: authToken,
    user: { id: user.id, email: user.email, role: user.role, companyId: user.companyId },
    company: { id: company.id, name: company.name, domain: company.domain }
  });
}));

// ═══════════════════════════════════════════════════════════════════
// FORGOT PASSWORD — OTP FLOW
// ═══════════════════════════════════════════════════════════════════

// Step 1: Request OTP — sends a 6-digit code to the user's email
router.post("/forgot-password", asyncHandler(async (req, res) => {
  const { email } = req.body;
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

  if (!normalizedEmail) {
    return res.status(400).json({ error: "Email is required" });
  }

  // Find user (regular users only, not super admins)
  const result = await query("SELECT id, email FROM users WHERE email = $1", [normalizedEmail]);
  const user = mapRow(result);

  // Always return success to prevent email enumeration
  if (!user) {
    return res.json({ message: "If an account with that email exists, an OTP has been sent." });
  }

  // Generate 6-digit OTP
  const otp = crypto.randomInt(100000, 999999).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  // Store OTP (hashed for security)
  const otpHash = await bcrypt.hash(otp, 6);
  await query(
    "UPDATE users SET reset_otp = $1, reset_otp_expires = $2, reset_otp_attempts = 0, updated_at = NOW() WHERE id = $3",
    [otpHash, expiresAt, user.id]
  );

  // Send OTP via email (fire and forget — don't block the response)
  sendEmail({
    to: user.email,
    subject: "PRISM — Password Reset Code",
    text: [
      `Your password reset code is: ${otp}`,
      "",
      "This code expires in 10 minutes.",
      "",
      "If you did not request this, please ignore this email.",
      "",
      "— PRISM Compliance Platform"
    ].join("\n")
  }).catch(err => {
    console.error("Failed to send OTP email:", err.message);
  });

  res.json({ message: "If an account with that email exists, an OTP has been sent." });
}));

// Step 2: Verify OTP — confirms the code is valid
router.post("/verify-otp", asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

  if (!normalizedEmail || !otp) {
    return res.status(400).json({ error: "Email and OTP are required" });
  }

  const result = await query(
    "SELECT id, reset_otp, reset_otp_expires, reset_otp_attempts FROM users WHERE email = $1",
    [normalizedEmail]
  );
  const user = mapRow(result);

  if (!user || !user.resetOtp) {
    return res.status(400).json({ error: "No password reset was requested for this email" });
  }

  // Check expiry first — an expired OTP should never consume an attempt slot
  if (new Date() > new Date(user.resetOtpExpires)) {
    await query("UPDATE users SET reset_otp = NULL, reset_otp_expires = NULL, reset_otp_attempts = 0, updated_at = NOW() WHERE id = $1", [user.id]);
    return res.status(400).json({ error: "OTP has expired. Please request a new code." });
  }

  // Check max attempts (5 attempts allowed)
  if (user.resetOtpAttempts >= 5) {
    await query("UPDATE users SET reset_otp = NULL, reset_otp_expires = NULL, reset_otp_attempts = 0, updated_at = NOW() WHERE id = $1", [user.id]);
    return res.status(429).json({ error: "Too many incorrect attempts. Please request a new code." });
  }

  // Verify OTP
  const valid = await bcrypt.compare(otp.trim(), user.resetOtp);
  if (!valid) {
    await query("UPDATE users SET reset_otp_attempts = reset_otp_attempts + 1, updated_at = NOW() WHERE id = $1", [user.id]);
    const remaining = 5 - (user.resetOtpAttempts + 1);
    return res.status(400).json({ error: `Invalid OTP. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.` });
  }

  // OTP is valid — generate a short-lived reset token (5 minutes)
  const resetToken = jwt.sign(
    { userId: user.id, email: normalizedEmail, purpose: "password-reset" },
    process.env.JWT_SECRET,
    { expiresIn: "5m" }
  );

  // Clear OTP from database
  await query("UPDATE users SET reset_otp = NULL, reset_otp_expires = NULL, reset_otp_attempts = 0, updated_at = NOW() WHERE id = $1", [user.id]);

  res.json({ resetToken, message: "OTP verified. You can now set a new password." });
}));

// Step 3: Reset password — uses the reset token from step 2
router.post("/reset-password", asyncHandler(async (req, res) => {
  const { resetToken, newPassword } = req.body;

  if (!resetToken || !newPassword) {
    return res.status(400).json({ error: "Reset token and new password are required" });
  }

  // Password strength validation
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters long" });
  }
  if (!/[A-Z]/.test(newPassword)) {
    return res.status(400).json({ error: "Password must contain at least one uppercase letter" });
  }
  if (!/[a-z]/.test(newPassword)) {
    return res.status(400).json({ error: "Password must contain at least one lowercase letter" });
  }
  if (!/[0-9]/.test(newPassword)) {
    return res.status(400).json({ error: "Password must contain at least one number" });
  }
  if (!/[^A-Za-z0-9]/.test(newPassword)) {
    return res.status(400).json({ error: "Password must contain at least one special character" });
  }

  // Verify reset token
  let payload;
  try {
    payload = jwt.verify(resetToken, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(400).json({ error: "Reset token is invalid or has expired. Please start over." });
  }

  if (payload.purpose !== "password-reset") {
    return res.status(400).json({ error: "Invalid token" });
  }

  // Hash new password and update
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await query(
    "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2",
    [passwordHash, payload.userId]
  );

  res.json({ message: "Password has been reset successfully. You can now log in." });
}));

// POST /api/auth/complete-onboarding — marks the user's onboarding as done
router.post("/complete-onboarding", authenticate, asyncHandler(async (req, res) => {
  await query(
    "UPDATE users SET onboarding_completed = TRUE, updated_at = NOW() WHERE id = $1",
    [req.user.userId]
  );
  res.json({ onboardingCompleted: true });
}));

export default router;
