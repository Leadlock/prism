import jwt from "jsonwebtoken";
import { query, mapRow } from "../db/index.js";

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
