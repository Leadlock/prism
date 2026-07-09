import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { scanWebsite } from "../scanner/scanner.js";
import { scanMobileApp } from "../scanner/mobile.js";
import { evaluateCompliance } from "../scanner/scorer.js";
import { renderHtml } from "../scanner/report.js";

const router = Router();

// Simple in-memory rate limiter for unauthenticated scan endpoints
const publicScanHits = new Map(); // ip → { count, resetAt }
const PUBLIC_SCAN_LIMIT = 5;      // requests per window
const PUBLIC_SCAN_WINDOW_MS = 60 * 1000; // 1 minute
let activeScanCount = 0;
const MAX_CONCURRENT_SCANS = 3;

function publicScanRateLimit(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  const entry = publicScanHits.get(ip);

  if (!entry || now > entry.resetAt) {
    publicScanHits.set(ip, { count: 1, resetAt: now + PUBLIC_SCAN_WINDOW_MS });
  } else if (entry.count >= PUBLIC_SCAN_LIMIT) {
    return res.status(429).json({ error: "Too many scan requests. Please wait a minute and try again." });
  } else {
    entry.count += 1;
  }

  if (activeScanCount >= MAX_CONCURRENT_SCANS) {
    return res.status(503).json({ error: "Scanner is busy. Please try again shortly." });
  }

  next();
}

async function runScan(url, { type = "website", headless = false, policy = null } = {}) {
  const signals =
    type === "mobile"
      ? await scanMobileApp(url, { privacyPolicyUrl: policy })
      : await scanWebsite(url, { headless: !!headless });

  if (signals.reachable === false)
    throw Object.assign(new Error(`Could not reach target. ${(signals.errors || []).join(" ")}`), { status: 422 });

  const evaluation = evaluateCompliance(signals);
  return { target: url, signals, evaluation };
}

// Public scan (no auth) — website only, no headless
router.post("/public-scan", publicScanRateLimit, async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== "string" || !url.trim())
    return res.status(400).json({ error: "URL is required." });

  activeScanCount++;
  try {
    const result = await runScan(url.trim());
    return res.json(result);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  } finally {
    activeScanCount--;
  }
});

// Public HTML report (opens in new tab for print-to-PDF)
router.post("/public-report", publicScanRateLimit, async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== "string" || !url.trim())
    return res.status(400).json({ error: "URL is required." });

  activeScanCount++;
  try {
    const { target, signals, evaluation } = await runScan(url.trim());
    const html = renderHtml(target, signals, evaluation);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  } finally {
    activeScanCount--;
  }
});

// Authenticated scan — full features (headless, mobile, policy URL)
router.post("/scan", authenticate, async (req, res) => {
  const { url, type = "website", headless = false, policy = null } = req.body;
  if (!url || typeof url !== "string" || !url.trim())
    return res.status(400).json({ error: "URL is required." });

  try {
    const result = await runScan(url.trim(), { type, headless, policy });
    return res.json(result);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
