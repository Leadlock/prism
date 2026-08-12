import { describe, test, expect } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { createCompany, createUser } from "../setup/helpers.js";

describe("GET /api/settings", () => {
  test("returns default settings for a company", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app)
      .get("/api/settings")
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("aiEnabled");
    expect(res.body).toHaveProperty("logoUrl");
  });

  test("returns 401 without token", async () => {
    const res = await request(app).get("/api/settings");
    expect(res.status).toBe(401);
  });
});

describe("GET /api/settings/tech-stack", () => {
  test("returns empty tech stack by default", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app)
      .get("/api/settings/tech-stack")
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
  });
});

describe("PUT /api/settings/tech-stack", () => {
  test("ADMIN can save tech stack", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");

    const stack = { cloud: ["AWS", "GCP"], databases: ["PostgreSQL"] };

    const res = await request(app)
      .put("/api/settings/tech-stack")
      .set("Authorization", `Bearer ${admin.token}`)
      .send(stack);

    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(true);
  });

  test("VIEWER is forbidden from updating tech stack", async () => {
    const company = await createCompany();
    const viewer = await createUser(company.id, "VIEWER");

    const res = await request(app)
      .put("/api/settings/tech-stack")
      .set("Authorization", `Bearer ${viewer.token}`)
      .send({ cloud: ["AWS"] });

    expect(res.status).toBe(403);
  });
});
