import { describe, test, expect, vi } from "vitest";

vi.mock("@aws-sdk/client-iam", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    IAMClient: vi.fn(() => ({
      send: vi.fn(async () => ({ Users: [], PasswordPolicy: {} })),
    })),
  };
});
vi.mock("@aws-sdk/client-cloudtrail", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, CloudTrailClient: vi.fn(() => ({ send: vi.fn(async () => ({})) })) };
});
vi.mock("@aws-sdk/client-config-service", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, ConfigServiceClient: vi.fn(() => ({ send: vi.fn(async () => ({})) })) };
});
vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, S3Client: vi.fn(() => ({ send: vi.fn(async () => ({})) })) };
});
vi.mock("@aws-sdk/client-ec2", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, EC2Client: vi.fn(() => ({ send: vi.fn(async () => ({})) })) };
});

const { runTests, tests } = await import("../connectors/aws/index.js");

describe("runTests", () => {
  test("propagates each test's human-readable title alongside its key", async () => {
    const results = await runTests({
      authType: "access_key",
      config: {},
      secret: { accessKeyId: "AKIA123", secretAccessKey: "shh" },
    });

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      const definition = tests.find((t) => t.key === result.testKey);
      expect(result.title).toBe(definition.title);
      expect(result.title).not.toBe(result.testKey);
    }

    const s3Result = results.find((r) => r.testKey === "aws.network.s3_public_access_blocked");
    expect(s3Result.title).toBe("S3 buckets block public access");
  });
});
