import { describe, test, expect, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { createCompany, createUser } from "../setup/helpers.js";

vi.mock("../../utils/email.js", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  sendInvitationEmail: vi.fn().mockResolvedValue(undefined),
}));

describe("POST /api/auth/register", () => {
  const validBody = {
    companyName: "Acme Corp",
    domain: "acme-corp",
    adminEmail: "admin@acmecorp.io",
    fullName: "John Admin",
    password: "Test@1234",
    industry: "Technology",
    companySize: "50-200",
  };

  test("creates company + ADMIN user and returns token", async () => {
    const res = await request(app).post("/api/auth/register").send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.role).toBe("ADMIN");
    expect(res.body.company.name).toBe("Acme Corp");
    expect(res.body.company.isVerified).toBe(false);
  });

  test("rejects gmail address", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ ...validBody, adminEmail: "user@gmail.com" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/corporate/i);
  });

  test("rejects weak password (no uppercase)", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ ...validBody, password: "test@1234", domain: "another-corp" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/uppercase/i);
  });

  test("rejects duplicate domain", async () => {
    await request(app).post("/api/auth/register").send(validBody);
    const res = await request(app).post("/api/auth/register").send(validBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/domain/i);
  });

  test("rejects missing required fields", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ companyName: "X" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/login", () => {
  test("returns token for valid credentials", async () => {
    const company = await createCompany();
    const user = await createUser(company.id, "ADMIN", { email: "login@testcorp.com" });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "login@testcorp.com", password: "Test@1234" });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe("login@testcorp.com");
  });

  test("returns 401 for wrong password", async () => {
    const company = await createCompany();
    await createUser(company.id, "ADMIN", { email: "badpw@testcorp.com" });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "badpw@testcorp.com", password: "Wrong@9999" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  test("returns 400 for missing email", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ password: "Test@1234" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/auth/me", () => {
  test("returns user and company for valid token", async () => {
    const company = await createCompany({ name: "Me Corp" });
    const user = await createUser(company.id, "ADMIN");

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${user.token}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(user.email);
    expect(res.body.company.name).toBe("Me Corp");
  });

  test("returns 401 without token", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  test("returns 401 for invalid token", async () => {
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", "Bearer garbage-token");
    expect(res.status).toBe(401);
  });
});
