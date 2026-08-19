import * as aws from "./aws/index.js";
import * as azure from "./azure/index.js";
import * as github from "./github/index.js";

const connectors = { [aws.key]: aws, [azure.key]: azure, [github.key]: github };

export function getConnector(integrationKey) {
  const connector = connectors[integrationKey];
  if (!connector) throw new Error(`Unknown integration: ${integrationKey}`);
  return connector;
}

export function listConnectorTests(integrationKey) {
  return getConnector(integrationKey).tests;
}
