import express from "express";
import helmet from "helmet";
import cors from "cors";
import path from "path";
import dotenv from "dotenv";
import { router as apiRouter } from "./routes/index.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requestTimeout } from "./middleware/timeout.js";
import { startScheduler } from "./utils/scheduler.js";
import { seedSuperAdmin } from "./utils/seedSuperAdmin.js";

dotenv.config();

const app = express();

const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((value) => value.trim())
  : "*";

app.use(helmet());
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Global request timeout (30 seconds) — fail fast
app.use(requestTimeout(30000));

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Public static route for company logos (no auth required)
const logosDir = path.resolve(process.env.UPLOAD_DIR || "./uploads", "logos");
app.use("/api/logos", express.static(logosDir));

app.use("/api", apiRouter);

app.use(errorHandler);

const port = Number(process.env.PORT) || 4000;
app.listen(port, async () => {
  console.log(`API listening on ${port}`);
  await seedSuperAdmin();
  startScheduler();
});
