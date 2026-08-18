import { describe, test, expect } from "vitest";
import { ClientSecretCredential } from "@azure/identity";
import { StorageManagementClient } from "@azure/arm-storage";
import { NetworkManagementClient } from "@azure/arm-network";
import { SecurityCenter } from "@azure/arm-security";
import { MonitorClient } from "@azure/arm-monitor";
import { ResourceManagementClient } from "@azure/arm-resources";

// Never makes a network call — these clients are constructed with a fake
// credential purely to inspect what shape each operation group's `list`
// method returns, so a future SDK version bump that changes a pagination
// shape (plain Promise vs PagedAsyncIterableIterator) fails here instead
// of silently breaking a real Azure collection run in production. This is
// a regression test for exactly the bug class found in the final review of
// the Azure connector plan (checkActivityLogDiagnosticsEnabled assumed a
// paged iterator when the installed SDK version returns a plain object).
const fakeCredential = new ClientSecretCredential("tenant", "client", "secret");

function isPagedAsyncIterable(value) {
  return value != null && typeof value[Symbol.asyncIterator] === "function";
}

describe("Azure SDK list() operation shapes (guards against SDK version drift)", () => {
  test("storageAccounts.list() returns a paged async iterable", () => {
    const client = new StorageManagementClient(fakeCredential, "sub-1");
    const result = client.storageAccounts.list();
    expect(isPagedAsyncIterable(result)).toBe(true);
  });

  test("networkSecurityGroups.listAll() returns a paged async iterable", () => {
    const client = new NetworkManagementClient(fakeCredential, "sub-1");
    const result = client.networkSecurityGroups.listAll();
    expect(isPagedAsyncIterable(result)).toBe(true);
  });

  test("resourceGroups.list() returns a paged async iterable", () => {
    const client = new ResourceManagementClient(fakeCredential, "sub-1");
    const result = client.resourceGroups.list();
    expect(isPagedAsyncIterable(result)).toBe(true);
  });

  test("pricings.list() returns a plain Promise, not a paged iterable", () => {
    const client = new SecurityCenter(fakeCredential, "sub-1");
    const result = client.pricings.list();
    expect(result).toBeInstanceOf(Promise);
    expect(isPagedAsyncIterable(result)).toBe(false);
    // Prevent an unhandled rejection warning — this call has no real
    // network access, so it will reject; we only care about the object
    // shape returned synchronously, not the eventual resolution.
    result.catch(() => {});
  });

  test("diagnosticSettings.list() returns a plain Promise, not a paged iterable", () => {
    const client = new MonitorClient(fakeCredential, "sub-1");
    const result = client.diagnosticSettings.list("/subscriptions/sub-1");
    expect(result).toBeInstanceOf(Promise);
    expect(isPagedAsyncIterable(result)).toBe(false);
    result.catch(() => {});
  });
});
