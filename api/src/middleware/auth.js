import jwt from "jsonwebtoken";
import { query, mapRow } from "../db/index.js";

// Endpoints a company can still reach while unverified — just enough to complete
// the self-assessment, invite help with it, and keep the app shell (branding, profile) working.
const UNVERIFIED_ALLOWLIST = [
  { method: "GET",  path: "/api/auth/me" },
  { method: "GET",  path: "/api/self-assessment" },
  { method: "POST", path: "/api/self-assessment" },
  { method: "POST", path: "/api/users/invite" },
  { method: "PUT",  path: "/api/users/me" },
  { method: "GET",  path: "/api/settings" },
];

export const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Super Admin: no company, separate table
    if (decoded.role === "SUPERADMIN") {
      const saResult = await query(
        "SELECT id, email FROM super_admins WHERE id = $1",
        [decoded.userId]
      );
      const sa = mapRow(saResult);
      if (!sa) return res.status(401).json({ error: "User not found" });

      req.user = {
        userId: sa.id,
        email: sa.email,
        role: "SUPERADMIN",
        companyId: null,
        company: null
      };
      return next();
    }

    // Regular user lookup
    const result = await query(
      `SELECT u.id, u.email, u.role, u.company_id,
              c.name AS company_name, c.domain AS company_domain, c.status AS company_status,
              c.is_verified AS company_is_verified,
              c.plan AS company_plan, c.billing_status AS billing_status,
              c.trial_ends_at AS trial_ends_at
       FROM users u
       JOIN companies c ON c.id = u.company_id
       WHERE u.id = $1`,
      [decoded.userId]
    );
    const user = mapRow(result);
    if (!user) return res.status(401).json({ error: "User not found" });

    if (user.companyStatus === "rejected") {
      return res.status(403).json({ error: "Your company registration has been rejected. Please contact the platform administrator.", code: "COMPANY_REJECTED" });
    }
    if (user.companyStatus === "suspended") {
      return res.status(403).json({ error: "Your company account has been suspended. Please contact the platform administrator.", code: "COMPANY_SUSPENDED" });
    }
    if (user.companyStatus === "approved" && !user.companyIsVerified) {
      return res.status(403).json({ error: "Your company verification has been revoked. Please contact the platform administrator.", code: "COMPANY_NOT_VERIFIED" });
    }

    // Unverified companies (awaiting completion of the mandatory self-assessment) are
    // restricted to the self-assessment flow — enforced here, not just in the frontend
    // router, since the frontend guard can be bypassed by navigating directly.
    if (!user.companyIsVerified && user.role !== "AUDITOR") {
      const currentPath = req.originalUrl.split("?")[0];
      const allowed = UNVERIFIED_ALLOWLIST.some(
        (r) => r.method === req.method && currentPath === r.path
      );
      if (!allowed) {
        return res.status(403).json({
          error: "Please complete your company's self-assessment before accessing this feature.",
          code: "COMPANY_UNVERIFIED",
        });
      }
    }

    if (user.billingStatus === "trial" && user.trialEndsAt && new Date(user.trialEndsAt) < new Date()) {
      return res.status(403).json({ error: "Your free trial has ended. Please contact us to continue using PRISM.", code: "TRIAL_EXPIRED", trialEndsAt: user.trialEndsAt });
    }
    if (user.billingStatus === "expired") {
      return res.status(403).json({ error: "Your subscription has expired. Please contact us to renew access.", code: "SUBSCRIPTION_EXPIRED" });
    }

    req.user = {
      ...decoded,
      role:      user.role,
      companyId: user.companyId,
      company: {
        id:            user.companyId,
        name:          user.companyName,
        domain:        user.companyDomain,
        plan:          user.companyPlan,
        billingStatus: user.billingStatus,
        trialEndsAt:   user.trialEndsAt,
      }
    };

    // For AUDITOR role: enforce active flag and expiry date
    if (user.role === "AUDITOR") {
      const profileResult = await query(
        `SELECT active, start_date, expiry_date
         FROM auditor_profiles
         WHERE user_id = $1`,
        [user.id]
      );
      const profile = mapRow(profileResult);

      if (!profile || !profile.active) {
        return res.status(403).json({ error: "Auditor account is inactive" });
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const expiry = new Date(profile.expiryDate);
      expiry.setHours(0, 0, 0, 0);

      if (expiry < today) {
        // Auto-deactivate on access attempt
        await query(
          "UPDATE auditor_profiles SET active = FALSE, updated_at = NOW() WHERE user_id = $1",
          [user.id]
        );
        return res.status(403).json({ error: "Auditor access has expired" });
      }

      req.user.auditorProfile = profile;
    }

    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid token" });
  }
};
