import { describe, test, expect, vi } from "vitest";

vi.mock("@azure/identity", () => ({
  ClientSecretCredential: vi.fn(function () {}),
}));
vi.mock("@azure/arm-storage", () => ({
  StorageManagementClient: vi.fn(() => ({
    storageAccounts: { list: () => ({ [Symbol.asyncIterator]: async function* () {} }) },
  })),
}));
vi.mock("@azure/arm-network", () => ({
  NetworkManagementClient: vi.fn(() => ({
    networkSecurityGroups: { listAll: () => ({ [Symbol.asyncIterator]: async function* () {} }) },
  })),
}));
vi.mock("@azure/arm-security", () => ({
  SecurityCenter: vi.fn(() => ({
    pricings: { list: async () => ({ value: [] }) },
  })),
}));
vi.mock("@azure/arm-monitor", () => ({
  MonitorClient: vi.fn(() => ({
    diagnosticSettings: { list: () => ({ [Symbol.asyncIterator]: async function* () {} }) },
  })),
}));

const { runTests, tests } = await import("../connectors/azure/index.js");

describe("runTests", () => {
  test("propagates each test's human-readable title alongside its key", async () => {
    const results = await runTests({
      authType: "oauth2",
      config: { tenantId: "tenant-1", subscriptionId: "sub-1" },
      secret: { clientId: "client-1", clientSecret: "shh" },
    });

    expect(results.length).toBe(4);
    for (const result of results) {
      const definition = tests.find((t) => t.key === result.testKey);
      expect(result.title).toBe(definition.title);
      expect(result.title).not.toBe(result.testKey);
    }

    const nsgResult = results.find((r) => r.testKey === "azure.network.nsg_no_open_ingress");
    expect(nsgResult.title).toBe("Network security groups do not expose management ports publicly");
    expect(nsgResult.status).toBe("not_applicable");
  });
});
