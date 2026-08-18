import { ClientSecretCredential } from "@azure/identity";

export async function resolveAzureCredentials({ authType, config, secret }) {
  if (authType === "oauth2") {
    return new ClientSecretCredential(config.tenantId, secret.clientId, secret.clientSecret);
  }

  throw new Error(`Unsupported Azure auth type: ${authType}`);
}
