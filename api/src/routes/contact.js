import { Router } from "express";
import { sendEmail } from "../utils/email.js";

const router = Router();
const CONTACT_TO = process.env.CONTACT_EMAIL || "ab@neozaar.com";

// Simple in-memory rate limit: max 3 submissions per IP per hour
const contactHits = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  const entry = contactHits.get(ip);
  if (!entry || now > entry.resetAt) {
    contactHits.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 });
  } else if (entry.count >= 3) {
    return res.status(429).json({ error: "Too many submissions. Please try again later." });
  } else {
    entry.count += 1;
  }
  next();
}

router.post("/", rateLimit, async (req, res) => {
  const { name, email, company, message, _subject } = req.body || {};
  if (!name?.trim() || !email?.trim()) {
    return res.status(400).json({ error: "Name and email are required." });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: "Invalid email address." });
  }

  const subject = _subject ? `[PRISM] ${_subject}` : "[PRISM] New contact form submission";
  const text = [
    `Name: ${name.trim()}`,
    `Email: ${email.trim()}`,
    company?.trim() ? `Company: ${company.trim()}` : null,
    "",
    message?.trim() || "(no message)",
  ].filter(l => l !== null).join("\n");

  try {
    await sendEmail({ to: CONTACT_TO, subject, text });
    res.json({ ok: true });
  } catch (err) {
    console.error("[contact] sendEmail error:", err.message);
    res.status(500).json({ error: "Failed to send message. Please email us directly." });
  }
});

export default router;
