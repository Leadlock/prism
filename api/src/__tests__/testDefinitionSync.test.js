import { describe, test, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn(async () => ({ rows: [], rowCount: 0 }));
const listConnectorKeysMock = vi.fn();
const listConnectorTestsMock = vi.fn();

vi.mock("../db/index.js", () => ({
  query: (...args) => queryMock(...args),
}));

vi.mock("../connectors/registry.js", () => ({
  listConnectorKeys: (...args) => listConnectorKeysMock(...args),
  listConnectorTests: (...args) => listConnectorTestsMock(...args),
}));

const { syncTestDefinitions } = await import("../utils/testDefinitionSync.js");

const FAKE_TESTS = [
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

beforeEach(() => {
  queryMock.mockClear();
  queryMock.mockImplementation(async () => ({ rows: [], rowCount: 0 }));

  listConnectorKeysMock.mockReset();
  listConnectorTestsMock.mockReset();
  listConnectorKeysMock.mockReturnValue(["fake"]);
  listConnectorTestsMock.mockImplementation((integrationKey) => (integrationKey === "fake" ? FAKE_TESTS : []));
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

  test("does not throw when every query fails, matching scheduler.js's fail-soft convention", async () => {
    queryMock.mockImplementation(async () => {
      throw new Error("connection refused");
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(syncTestDefinitions()).resolves.toBeUndefined();

    // Per-test isolation means the failure is logged once per test key, not
    // once for the whole sync run.
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[testDefinitionSync] failed to sync test "fake.check_one" for connector "fake":',
      "connection refused"
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[testDefinitionSync] failed to sync test "fake.check_two" for connector "fake":',
      "connection refused"
    );

    consoleErrorSpy.mockRestore();
  });

  test("one connector's failing test does not block other connectors from syncing (fault isolation)", async () => {
    const goodTest = {
      key: "other.check_one",
      title: "Other connector check",
      severityDefault: "low",
      isoReferences: ["A.9.9.9"],
    };
    const badTest = {
      key: "fake.check_one",
      title: "Fake check one",
      severityDefault: "high",
      isoReferences: ["A.1.1.1"],
    };

    listConnectorKeysMock.mockReturnValue(["fake", "other"]);
    listConnectorTestsMock.mockImplementation((integrationKey) => {
      if (integrationKey === "fake") return [badTest];
      if (integrationKey === "other") return [goodTest];
      return [];
    });

    // "fake"'s automated_tests upsert throws; "other"'s must still succeed.
    queryMock.mockImplementation(async (sql, params) => {
      if (sql.includes("INSERT INTO automated_tests") && params[0] === "fake") {
        throw new Error("severity_default check constraint violated");
      }
      return { rows: [], rowCount: 0 };
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(syncTestDefinitions()).resolves.toBeUndefined();

    const otherAutomatedTestsCalls = queryMock.mock.calls.filter(
      ([sql, params]) => sql.includes("INSERT INTO automated_tests") && params[0] === "other"
    );
    const otherMappingCalls = queryMock.mock.calls.filter(
      ([sql, params]) => sql.includes("INSERT INTO test_control_mappings") && params[0] === "other.check_one"
    );
    expect(otherAutomatedTestsCalls).toHaveLength(1);
    expect(otherMappingCalls).toHaveLength(1);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[testDefinitionSync] failed to sync test "fake.check_one" for connector "fake":',
      "severity_default check constraint violated"
    );

    consoleErrorSpy.mockRestore();
  });

  test("does not throw when listConnectorKeys itself throws (outer last-resort guard)", async () => {
    listConnectorKeysMock.mockImplementation(() => {
      throw new Error("registry blew up");
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(syncTestDefinitions()).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith("[testDefinitionSync] syncTestDefinitions failed:", "registry blew up");

    consoleErrorSpy.mockRestore();
  });
});
