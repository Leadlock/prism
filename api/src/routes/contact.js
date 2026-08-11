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

router.post("/support", rateLimit, async (req, res) => {
  const { name, email, message } = req.body || {};
  if (!name?.trim() || !email?.trim() || !message?.trim()) {
    return res.status(400).json({ error: "Name, email, and message are required." });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: "Invalid email address." });
  }

  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  const trimmedMessage = message.trim();

  // Email to support team
  const subject = "[PRISM] Support Request";
  const text = [
    `Name: ${trimmedName}`,
    `Email: ${trimmedEmail}`,
    "",
    trimmedMessage,
  ].join("\n");

  const escapedMessage = trimmedMessage.replace(/</g, '&lt;').replace(/>/g, '&gt;'); // nosemgrep: raw-html-format
  // Confirmation email to the user
  const confirmationHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#0f1923;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f1923;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <!-- Header -->
          <tr>
            <td align="center" style="padding:0 0 32px;">
              <h1 style="margin:0;font-size:24px;font-weight:700;color:#60b8ff;">PRISM</h1>
            </td>
          </tr>
          <!-- Main Card -->
          <tr>
            <td style="background:#1a2736;border-radius:12px;padding:40px 36px;border:1px solid #2a3a4a;">
              <!-- Check icon -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:0 0 24px;">
                    <div style="width:56px;height:56px;border-radius:50%;background:rgba(76,168,160,0.15);line-height:56px;text-align:center;font-size:24px;color:#4ca8a0;">✓</div>
                  </td>
                </tr>
              </table>
              <h2 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#f0f8ff;text-align:center;">We've Received Your Request</h2>
              <p style="margin:0 0 24px;font-size:14px;color:#8fa3b8;text-align:center;line-height:1.6;">
                Hi ${trimmedName}, thank you for reaching out. Our support team will review your message and get back to you within 24 hours.
              </p>
              <!-- Divider -->
              <hr style="border:none;border-top:1px solid #2a3a4a;margin:24px 0;" />
              <!-- Message summary -->
              <p style="margin:0 0 8px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#8fa3b8;">Your Message</p>
              <div style="background:#0f1923;border-radius:8px;padding:16px;margin:0 0 24px;">
                <p style="margin:0;font-size:14px;color:#c8d8e8;line-height:1.6;white-space:pre-wrap;">${escapedMessage}</p>  // nosemgrep
              </div>
              <!-- What to expect -->
              <p style="margin:0 0 8px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#8fa3b8;">What Happens Next</p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:8px 0;font-size:14px;color:#c8d8e8;">
                    <span style="color:#4ca8a0;font-weight:600;">1.</span> Our team reviews your request
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;font-size:14px;color:#c8d8e8;">
                    <span style="color:#4ca8a0;font-weight:600;">2.</span> We'll respond via email within 24 hours
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;font-size:14px;color:#c8d8e8;">
                    <span style="color:#4ca8a0;font-weight:600;">3.</span> For urgent issues, email us directly at support@askthechamp.com
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td align="center" style="padding:32px 0 0;">
              <p style="margin:0;font-size:12px;color:#5a6f82;line-height:1.6;">
                This is an automated confirmation from PRISM.<br />
                Please do not reply to this email.
              </p>
              <p style="margin:12px 0 0;font-size:12px;color:#5a6f82;">
                &copy; ${new Date().getFullYear()} PRISM &mdash; prism.askthechamp.com
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const confirmationText = `Hi ${trimmedName},\n\nThank you for reaching out to PRISM Support. We've received your request and our team will get back to you within 24 hours.\n\nYour message:\n${trimmedMessage}\n\nFor urgent issues, email us directly at support@askthechamp.com\n\n— PRISM Support Team`;

  try {
    // Send to support team
    await sendEmail({ to: CONTACT_TO, subject, text, replyTo: trimmedEmail });

    // Send confirmation to user
    await sendEmail({
      to: trimmedEmail,
      subject: "[PRISM] We've received your support request",
      text: confirmationText,
      html: confirmationHtml,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("[contact/support] sendEmail error:", err.message);
    res.status(500).json({ error: "Failed to send message. Please email us directly at support@askthechamp.com" });
  }
});

// Rate limit for report emails: 2 per IP per hour (heavier payload)
const reportHits = new Map();
function reportRateLimit(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  const entry = reportHits.get(ip);
  if (!entry || now > entry.resetAt) {
    reportHits.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 });
  } else if (entry.count >= 2) {
    return res.status(429).json({ error: "Too many report requests. Please try again later." });
  } else {
    entry.count += 1;
  }
  next();
}

router.post("/report", reportRateLimit, async (req, res) => {
  const { name, email, company, score, reportHtml, reportText } = req.body || {};
  if (!name?.trim() || !email?.trim()) {
    return res.status(400).json({ error: "Name and email are required." });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: "Invalid email address." });
  }
  if (!reportHtml || !reportText) {
    return res.status(400).json({ error: "Report data is required." });
  }

  const subject = `[PRISM] Your Compliance Assessment Report — Score: ${score ?? "??"}/100`;

  try {
    await sendEmail({
      to: email.trim(),
      subject,
      text: reportText,
      html: reportHtml,
    });

    // Notify admins that someone completed an assessment
    await sendEmail({
      to: CONTACT_TO,
      subject: `[PRISM] Assessment completed — ${name.trim()} (${company?.trim() || "no company"}) scored ${score ?? "??"}`,
      text: `Name: ${name.trim()}\nEmail: ${email.trim()}\nCompany: ${company?.trim() || "-"}\nScore: ${score ?? "??"}/100`,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("[contact/report] sendEmail error:", err.message);
    res.status(500).json({ error: "Failed to send report. Please try again." });
  }
});

export default router;
