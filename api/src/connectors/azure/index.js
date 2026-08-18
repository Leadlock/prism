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

export async function testConnection({ authType, config, secret }) {
  const credential = await resolveAzureCredentials({ authType, config, secret });
  const resources = new ResourceManagementClient(credential, config.subscriptionId);
  // Forces the first page fetch — throws if the Service Principal can't
  // authenticate or lacks access to the subscription. This is Azure's
  // analog of AWS's STS GetCallerIdentity connectivity probe.
  await resources.resourceGroups.list().next();
  return { ok: true, externalAccountId: config.subscriptionId };
}

export async function runTests({ authType, config, secret }) {
  const credential = await resolveAzureCredentials({ authType, config, secret });
  const clients = buildClients(credential, config.subscriptionId);
  const runResults = [];
  for (const test of tests) {
    const results = await test.run(clients);
    for (const result of results) {
      runResults.push({ testKey: test.key, title: test.title, severity: test.severityDefault, ...result });
    }
  }
  return runResults;
}
