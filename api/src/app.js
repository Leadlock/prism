import cors from "cors";
import express from "express";
import helmet from "helmet";
import path from "path";
import { errorHandler } from "./middleware/errorHandler.js";
import { requestTimeout } from "./middleware/timeout.js";
import { router as apiRouter } from "./routes/index.js";

export function createApp() {
  const app = express();

  const corsOrigin = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",").map(v => v.trim())
    : "*";

  app.use(helmet());
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(requestTimeout(30000));

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  const logosDir = path.resolve(process.env.UPLOAD_DIR || "./uploads", "logos");
  app.use("/api/logos", express.static(logosDir));

  app.use("/api", apiRouter);
  app.use(errorHandler);

  return app;
}

export default createApp();
