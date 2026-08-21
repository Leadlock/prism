import { describe, test, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn(async () => ({ rows: [], rowCount: 0 }));

vi.mock("../db/index.js", () => ({
  query: (...args) => queryMock(...args),
}));

vi.mock("../connectors/registry.js", () => ({
  listConnectorKeys: () => ["fake"],
  listConnectorTests: (integrationKey) => {
    if (integrationKey !== "fake") return [];
    return [
      {
        key: "fake.check_one",
        title: "Fake check one",
        severityDefault: "high",
        isoReferences: ["A.1.1.1", "A.2.2.2"],
      },
      {
        key: "fake.check_two",
        title: "Fake check two",
        severityDefault: "medium",
        isoReferences: ["A.3.3.3"],
      },
    ];
  },
}));

const { syncTestDefinitions } = await import("../utils/testDefinitionSync.js");

beforeEach(() => {
  queryMock.mockClear();
  queryMock.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
});

describe("syncTestDefinitions", () => {
  test("upserts automated_tests and test_control_mappings for every connector test", async () => {
    await syncTestDefinitions();

    const automatedTestsCalls = queryMock.mock.calls.filter(([sql]) => sql.includes("INSERT INTO automated_tests"));
    const mappingCalls = queryMock.mock.calls.filter(([sql]) => sql.includes("INSERT INTO test_control_mappings"));

    expect(automatedTestsCalls).toHaveLength(2);
    expect(automatedTestsCalls[0][0]).toContain("ON CONFLICT (test_key) DO UPDATE SET title = EXCLUDED.title, severity_default = EXCLUDED.severity_default");
    expect(automatedTestsCalls[0][1]).toEqual(["fake", "fake.check_one", "Fake check one", "high"]);
    expect(automatedTestsCalls[1][1]).toEqual(["fake", "fake.check_two", "Fake check two", "medium"]);

    // 2 ISO references for check_one + 1 for check_two = 3 mapping upserts
    expect(mappingCalls).toHaveLength(3);
    expect(mappingCalls[0][0]).toContain("ON CONFLICT (test_key, framework, iso_reference) DO NOTHING");
    expect(mappingCalls[0][1]).toEqual(["fake.check_one", "A.1.1.1"]);
    expect(mappingCalls[1][1]).toEqual(["fake.check_one", "A.2.2.2"]);
    expect(mappingCalls[2][1]).toEqual(["fake.check_two", "A.3.3.3"]);
  });

  test("does not throw when a query fails, matching scheduler.js's fail-soft convention", async () => {
    queryMock.mockImplementation(async () => {
      throw new Error("connection refused");
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(syncTestDefinitions()).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[testDefinitionSync] syncTestDefinitions failed:",
      "connection refused"
    );

    consoleErrorSpy.mockRestore();
  });
});
