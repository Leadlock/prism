import { describe, test, expect, vi, beforeEach } from "vitest";

const { resolvePurviewCredentials } = await import("../connectors/purview/credentials.js");

describe("resolvePurviewCredentials", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({ token_type: "Bearer", expires_in: 3600, access_token: "fake-token" }),
      }))
    );
  });

  test("throws for an unsupported auth type", async () => {
    await expect(
      resolvePurviewCredentials({ authType: "access_key", config: {}, secret: {} })
    ).rejects.toThrow("Unsupported Purview auth type: access_key");
  });

  test("throws a clear error when config.tenantId is missing", async () => {
    await expect(
      resolvePurviewCredentials({
        authType: "oauth2",
        config: { purviewAccountName: "acct-1" },
        secret: { clientId: "client-1", clientSecret: "shh" },
      })
    ).rejects.toThrow("Purview connection is missing config.tenantId");
  });

  test("throws a clear error when config.purviewAccountName is missing", async () => {
    await expect(
      resolvePurviewCredentials({
        authType: "oauth2",
        config: { tenantId: "tenant-1" },
        secret: { clientId: "client-1", clientSecret: "shh" },
      })
    ).rejects.toThrow("Purview connection is missing config.purviewAccountName");
  });

  test("throws a clear error when secret.clientId is missing", async () => {
    await expect(
      resolvePurviewCredentials({
        authType: "oauth2",
        config: { tenantId: "tenant-1", purviewAccountName: "acct-1" },
        secret: { clientSecret: "shh" },
      })
    ).rejects.toThrow("Purview connection is missing secret.clientId");
  });

  test("throws a clear error when secret.clientSecret is missing", async () => {
    await expect(
      resolvePurviewCredentials({
        authType: "oauth2",
        config: { tenantId: "tenant-1", purviewAccountName: "acct-1" },
        secret: { clientId: "client-1" },
      })
    ).rejects.toThrow("Purview connection is missing secret.clientSecret");
  });

  test("derives dataMapBaseUrl and auditBaseUrl from config", async () => {
    const credentials = await resolvePurviewCredentials({
      authType: "oauth2",
      config: { tenantId: "tenant-1", purviewAccountName: "acct-1" },
      secret: { clientId: "client-1", clientSecret: "shh" },
    });

    expect(credentials.dataMapBaseUrl).toBe("https://acct-1.purview.azure.com");
    expect(credentials.auditBaseUrl).toBe(
      "https://manage.office.com/api/v1.0/tenant-1/activity/feed"
    );
  });

  test("does not fetch a token until a getter is invoked", async () => {
    await resolvePurviewCredentials({
      authType: "oauth2",
      config: { tenantId: "tenant-1", purviewAccountName: "acct-1" },
      secret: { clientId: "client-1", clientSecret: "shh" },
    });

    expect(fetch).not.toHaveBeenCalled();
  });

  test("getDataMapToken() requests the purview.azure.net resource and returns the access token", async () => {
    const credentials = await resolvePurviewCredentials({
      authType: "oauth2",
      config: { tenantId: "tenant-1", purviewAccountName: "acct-1" },
      secret: { clientId: "client-1", clientSecret: "shh" },
    });

    const token = await credentials.getDataMapToken();

    expect(token).toBe("fake-token");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("https://login.microsoftonline.com/tenant-1/oauth2/token");
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(options.body);
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("client_id")).toBe("client-1");
    expect(body.get("client_secret")).toBe("shh");
    expect(body.get("resource")).toBe("https://purview.azure.net");
  });

  test("getAuditToken() requests the manage.office.com resource and returns the access token", async () => {
    const credentials = await resolvePurviewCredentials({
      authType: "oauth2",
      config: { tenantId: "tenant-1", purviewAccountName: "acct-1" },
      secret: { clientId: "client-1", clientSecret: "shh" },
    });

    const token = await credentials.getAuditToken();

    expect(token).toBe("fake-token");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("https://login.microsoftonline.com/tenant-1/oauth2/token");
    const body = new URLSearchParams(options.body);
    expect(body.get("resource")).toBe("https://manage.office.com");
  });
});
