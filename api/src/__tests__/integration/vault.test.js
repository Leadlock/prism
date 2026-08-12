import { describe, test, expect, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { createCompany, createUser } from "../setup/helpers.js";

vi.mock("../../utils/scanFile.js", () => ({
  scanFile: vi.fn().mockResolvedValue({ safe: true }),
}));

vi.mock("../../utils/notifyReviewers.js", () => ({
  notifyReviewers: vi.fn().mockResolvedValue(undefined),
}));

const TEXT_FILE = Buffer.from("test document content");

async function uploadFile(token, title = "Test Doc") {
  return request(app)
    .post("/api/vault")
    .set("Authorization", `Bearer ${token}`)
    .attach("file", TEXT_FILE, { filename: "test.txt", contentType: "text/plain" })
    .field("title", title);
}

describe("GET /api/vault", () => {
  test("returns empty array for new company", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app)
      .get("/api/vault")
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test("returns 401 without token", async () => {
    const res = await request(app).get("/api/vault");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/vault", () => {
  test("uploads a file and returns vault item", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");

    const res = await uploadFile(admin.token, "My Policy Doc");

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.title).toBe("My Policy Doc");
    expect(res.body.fileName).toBe("test.txt");
  });

  test("returns 400 when title is missing", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app)
      .post("/api/vault")
      .set("Authorization", `Bearer ${admin.token}`)
      .attach("file", TEXT_FILE, { filename: "test.txt", contentType: "text/plain" });

    expect(res.status).toBe(400);
  });

  test("VIEWER role is forbidden", async () => {
    const company = await createCompany();
    const viewer = await createUser(company.id, "VIEWER");

    const res = await uploadFile(viewer.token);
    expect(res.status).toBe(403);
  });

  test("uploaded item appears in GET list", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");

    await uploadFile(admin.token, "Listed Doc");

    const res = await request(app)
      .get("/api/vault")
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].title).toBe("Listed Doc");
  });
});

describe("GET /api/vault/:id", () => {
  test("returns vault item by id", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");

    const upload = await uploadFile(admin.token, "Single Doc");
    const id = upload.body.id;

    const res = await request(app)
      .get(`/api/vault/${id}`)
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
  });

  test("returns 404 for unknown id", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app)
      .get("/api/vault/99999")
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/vault/:id", () => {
  test("deletes vault item", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");

    const upload = await uploadFile(admin.token, "To Delete");
    const id = upload.body.id;

    const res = await request(app)
      .delete(`/api/vault/${id}`)
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(204);
  });

  test("CONTRIBUTOR cannot delete vault items", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    const contributor = await createUser(company.id, "CONTRIBUTOR");

    const upload = await uploadFile(admin.token, "Protected");
    const id = upload.body.id;

    const res = await request(app)
      .delete(`/api/vault/${id}`)
      .set("Authorization", `Bearer ${contributor.token}`);

    expect(res.status).toBe(403);
  });
});
