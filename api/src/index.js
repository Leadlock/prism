import dotenv from "dotenv";
dotenv.config();

import app from "./app.js";
import { startScheduler } from "./utils/scheduler.js";
import { seedSuperAdmin } from "./utils/seedSuperAdmin.js";

const port = Number(process.env.PORT) || 4000;
app.listen(port, async () => {
  console.log(`API listening on ${port}`);
  await seedSuperAdmin();
  startScheduler();
});
