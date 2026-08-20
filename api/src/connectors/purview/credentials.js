async function fetchToken({ tenantId, clientId, clientSecret, resource }) {
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      resource,
    }),
  });
  const body = await res.json();
  return body.access_token;
}

export async function resolvePurviewCredentials({ authType, config, secret }) {
  if (authType === "oauth2") {
    if (!config.tenantId) throw new Error("Purview connection is missing config.tenantId");
    if (!config.purviewAccountName) throw new Error("Purview connection is missing config.purviewAccountName");
    if (!secret.clientId) throw new Error("Purview connection is missing secret.clientId");
    if (!secret.clientSecret) throw new Error("Purview connection is missing secret.clientSecret");

    const { tenantId, purviewAccountName } = config;
    const { clientId, clientSecret } = secret;

    return {
      getDataMapToken: () =>
        fetchToken({ tenantId, clientId, clientSecret, resource: "https://purview.azure.net" }),
      getAuditToken: () =>
        fetchToken({ tenantId, clientId, clientSecret, resource: "https://manage.office.com" }),
      dataMapBaseUrl: `https://${purviewAccountName}.purview.azure.com`,
      auditBaseUrl: `https://manage.office.com/api/v1.0/${tenantId}/activity/feed`,
    };
  }

  throw new Error(`Unsupported Purview auth type: ${authType}`);
}
