const RISKY_PORTS = [22, 3389];
const OPEN_SOURCE_PREFIXES = ["*", "0.0.0.0/0", "internet", "any"];

function portRangeIncludesRiskyPort(portRange) {
  if (!portRange) return false;
  if (portRange === "*") return true;
  const single = Number(portRange);
  if (!Number.isNaN(single)) return RISKY_PORTS.includes(single);
  const rangeMatch = portRange.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const [, start, end] = rangeMatch;
    return RISKY_PORTS.some((port) => port >= Number(start) && port <= Number(end));
  }
  return false;
}

function isOpenIngressRule(rule) {
  if (rule.direction !== "Inbound" || rule.access !== "Allow") return false;
  const source = (rule.sourceAddressPrefix || "").toLowerCase();
  if (!OPEN_SOURCE_PREFIXES.includes(source)) return false;
  const ranges = [rule.destinationPortRange, ...(rule.destinationPortRanges || [])];
  return ranges.some(portRangeIncludesRiskyPort);
}

export async function checkStoragePublicAccessBlocked(storage) {
  const results = [];
  for await (const account of storage.storageAccounts.list()) {
    // Azure's own docs: "The default interpretation is false for this property" —
    // an unset/null field means public access is NOT allowed, only an explicit
    // `true` means it is.
    const blocked = account.allowBlobPublicAccess !== true;
    results.push({
      resourceId: account.id,
      status: blocked ? "pass" : "fail",
      message: blocked ? `${account.name} blocks public blob access` : `${account.name} allows public blob access`,
      evidencePayload: { accountName: account.name, allowBlobPublicAccess: account.allowBlobPublicAccess ?? null },
    });
  }
  if (results.length === 0) {
    results.push({ resourceId: "subscription", status: "not_applicable", message: "No storage accounts found", evidencePayload: {} });
  }
  return results;
}

export async function checkNsgNoOpenIngress(network) {
  const results = [];
  for await (const nsg of network.networkSecurityGroups.listAll()) {
    const openRules = (nsg.securityRules || []).filter(isOpenIngressRule);
    results.push({
      resourceId: nsg.id,
      status: openRules.length === 0 ? "pass" : "fail",
      message: openRules.length === 0
        ? `${nsg.name} does not expose ports 22/3389 to the internet`
        : `${nsg.name} allows inbound access to ports 22/3389 from ${openRules.map((r) => r.sourceAddressPrefix).join(", ")}`,
      evidencePayload: { nsgName: nsg.name, openRuleNames: openRules.map((r) => r.name) },
    });
  }
  if (results.length === 0) {
    results.push({ resourceId: "subscription", status: "not_applicable", message: "No network security groups found", evidencePayload: {} });
  }
  return results;
}

export const networkTests = [
  { key: "azure.storage.public_access_blocked", title: "Storage accounts block public blob access", severityDefault: "critical", isoReferences: ["A.8.2.3"], run: (clients) => checkStoragePublicAccessBlocked(clients.storage) },
  { key: "azure.network.nsg_no_open_ingress", title: "Network security groups do not expose management ports publicly", severityDefault: "critical", isoReferences: ["A.13.1.1"], run: (clients) => checkNsgNoOpenIngress(clients.network) },
];
