import { StorageManagementClient } from "@azure/arm-storage";
import { NetworkManagementClient } from "@azure/arm-network";
import { SecurityCenter } from "@azure/arm-security";
import { MonitorClient } from "@azure/arm-monitor";
import { ResourceManagementClient } from "@azure/arm-resources";
import { resolveAzureCredentials } from "./credentials.js";
import { networkTests } from "./tests/network.js";
import { loggingTests } from "./tests/logging.js";

export const key = "azure";

export const tests = [...loggingTests, ...networkTests];

function buildClients(credential, subscriptionId) {
  return {
    storage: new StorageManagementClient(credential, subscriptionId),
    network: new NetworkManagementClient(credential, subscriptionId),
    security: new SecurityCenter(credential, subscriptionId),
    monitor: new MonitorClient(credential, subscriptionId),
    subscriptionId,
  };
}

// @azure/arm-resources' generated pagingHelpers.js throws a hardcoded
// "Pagination failed with unexpected statusCode N" string on any unexpected
// status (see checkPagingRequest in its static-helpers/pagingHelpers.js) —
// verified against the shipped source, ARM's detailed error text (which
// names the specific missing action/scope) is discarded entirely for this
// call path. Only the short machine-readable `error.code` (e.g.
// "AuthorizationFailed") survives onto the thrown RestError, via `.code`.
// `.details`/`.response.bodyAsText` are checked first in case a future SDK
// version (or a different call path) does preserve the full message.
function describeAzureError(err) {
  const fromDetails = err?.details?.error?.message;
  if (fromDetails) return fromDetails;
  try {
    const parsed = JSON.parse(err?.response?.bodyAsText || "");
    if (parsed?.error?.message) return parsed.error.message;
  } catch {}
  if (err?.code) {
    return `Azure rejected this request: ${err.code} (HTTP ${err.statusCode ?? "?"}). ` +
      `The Azure SDK doesn't expose more detail than this code for this call — ` +
      `if this is AuthorizationFailed, double-check the Service Principal's role ` +
      `assignment scope and that it's propagated (can take up to 30 minutes).`;
  }
  return err.message;
}

export async function testConnection({ authType, config, secret }) {
  const credential = await resolveAzureCredentials({ authType, config, secret });
  const resources = new ResourceManagementClient(credential, config.subscriptionId);
  // Forces the first page fetch — throws if the Service Principal can't
  // authenticate or lacks access to the subscription. This is Azure's
  // analog of AWS's STS GetCallerIdentity connectivity probe.
  try {
    await resources.resourceGroups.list().next();
  } catch (err) {
    throw new Error(describeAzureError(err));
  }
  return { ok: true, externalAccountId: config.subscriptionId };
}

export async function runTests({ authType, config, secret }) {
  const credential = await resolveAzureCredentials({ authType, config, secret });
  const clients = buildClients(credential, config.subscriptionId);
  const runResults = [];
  try {
    for (const test of tests) {
      const results = await test.run(clients);
      for (const result of results) {
        runResults.push({ testKey: test.key, title: test.title, severity: test.severityDefault, ...result });
      }
    }
  } catch (err) {
    throw new Error(describeAzureError(err));
  }
  return runResults;
}
