import * as aws from "./aws/index.js";

const connectors = { [aws.key]: aws };

export function getConnector(integrationKey) {
  const connector = connectors[integrationKey];
  if (!connector) throw new Error(`Unknown integration: ${integrationKey}`);
  return connector;
}

export function listConnectorTests(integrationKey) {
  return getConnector(integrationKey).tests;
}
