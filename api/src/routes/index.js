import { Router } from "express";
import authRoutes from "./auth.js";
import moduleRoutes from "./modules.js";
import questionRoutes from "./questions.js";
import assessmentRoutes from "./assessments.js";
import actionRoutes from "./actions.js";
import evidenceRoutes from "./evidence.js";
import listRoutes from "./lists.js";
import userRoutes from "./users.js";
import dashboardRoutes from "./dashboard.js";
import auditorRoutes from "./auditors.js";
import superadminRoutes from "./superadmin.js";
import settingsRoutes from "./settings.js";
import reminderRoutes from "./reminders.js";
import dpdpaRoutes from "./dpdpa.js";
import contactRoutes from "./contact.js";
import consentRoutes from "./consent.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/modules", moduleRoutes);
router.use("/questions", questionRoutes);
router.use("/assessments", assessmentRoutes);
router.use("/actions", actionRoutes);
router.use("/evidence", evidenceRoutes);
router.use("/lists", listRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/auditors", auditorRoutes);
router.use("/superadmin", superadminRoutes);
router.use("/settings", settingsRoutes);
router.use("/reminders", reminderRoutes);
router.use("/dpdpa", dpdpaRoutes);
router.use("/contact", contactRoutes);
router.use("/consent", consentRoutes);

export { router };
