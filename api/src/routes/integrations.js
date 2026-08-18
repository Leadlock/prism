import { Router } from "express";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { query, mapRow, mapRows } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole, requireReadOnly } from "../middleware/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { writeAuditLog } from "../utils/auditLog.js";
import { sanitiseFields } from "../utils/sanitise.js";
import { storeCredential, revokeCredentials } from "../db/integrationCredentials.js";
import { getConnector } from "../connectors/registry.js";
import { runCollection } from "../utils/collectionRunner.js";

const router = Router();

// The exact read-only permissions the AWS connector's Tier-1 checks call —
// kept in lockstep with connectors/aws/tests/{iam,logging,network}.js so the
// policy handed to customers never grants more (or less) than the code uses.
const AWS_READ_ONLY_POLICY = {
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "PrismReadOnlyEvidenceCollection",
      Effect: "Allow",
      Action: [
        "iam:ListUsers",
        "iam:ListMFADevices",
        "iam:ListAccessKeys",
        "iam:GetAccountPasswordPolicy",
        "cloudtrail:DescribeTrails",
        "cloudtrail:GetTrailStatus",
        "config:DescribeConfigurationRecorders",
        "config:DescribeConfigurationRecorderStatus",
        "s3:ListAllMyBuckets",
        "s3:GetBucketPublicAccessBlock",
        "ec2:DescribeSecurityGroups",
      ],
      Resource: "*",
    },
  ],
};

const AZURE_READ_ONLY_ROLE_DEFINITION = {
  Name: "Prism Read-Only Evidence Collection",
  IsCustom: true,
  Description: "Least-privilege read access for Prism's automated ISO 27001 evidence collection.",
  Actions: [
    "Microsoft.Storage/storageAccounts/read",
    "Microsoft.Network/networkSecurityGroups/read",
    "Microsoft.Insights/diagnosticSettings/read",
    "Microsoft.Security/pricings/read",
    "Microsoft.Resources/subscriptions/resourceGroups/read",
  ],
  NotActions: [],
  AssignableScopes: ["/subscriptions/<subscription-id>"],
};

router.get("/", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT * FROM integration_connections WHERE company_id = $1 ORDER BY created_at DESC`,
    [req.user.companyId]
  );
  res.json(mapRows(result));
}));

router.get("/catalog", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const result = await query(`SELECT * FROM integrations WHERE status != 'coming_soon' ORDER BY name`);
  res.json(mapRows(result));
}));

// GET /api/integrations/aws/setup-info — the exact trust-policy principal Prism's
// own backend runs as (via STS), plus the least-privilege permissions policy the
// connector needs, so a customer's IAM role works on the first try.
router.get("/aws/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  let principalArn = null;
  let principalError = null;
  try {
    const sts = new STSClient({ region: process.env.AWS_REGION || "us-east-1" });
    const identity = await sts.send(new GetCallerIdentityCommand({}));
    principalArn = identity.Arn;
  } catch (err) {
    console.error("aws/setup-info: failed to resolve Prism's AWS principal ARN:", err.message);
    principalError = "This Prism deployment has no AWS credentials configured, so the trust policy's principal can't be resolved automatically. Ask your Prism administrator for the AWS principal ARN Prism runs as, or connect using static access keys instead.";
  }
  res.json({ principalArn, principalError, permissionsPolicy: AWS_READ_ONLY_POLICY });
}));

router.get("/azure/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json({ roleDefinition: AZURE_READ_ONLY_ROLE_DEFINITION });
}));

router.get("/:id", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT * FROM integration_connections WHERE id = $1 AND company_id = $2`,
    [parseInt(req.params.id), req.user.companyId]
  );
  const connection = mapRow(result);
  if (!connection) return res.status(404).json({ error: "Connection not found" });
  res.json(connection);
}));

router.get("/:id/runs", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const connectionId = parseInt(req.params.id);
  const connResult = await query(
    `SELECT id FROM integration_connections WHERE id = $1 AND company_id = $2`,
    [connectionId, req.user.companyId]
  );
  if (connResult.rows.length === 0) return res.status(404).json({ error: "Connection not found" });

  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const result = await query(
    `SELECT * FROM evidence_collection_runs WHERE connection_id = $1 AND company_id = $2 ORDER BY started_at DESC LIMIT $3`,
    [connectionId, req.user.companyId, limit]
  );
  res.json(mapRows(result));
}));

router.post("/", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const { integrationKey, name, config } = sanitiseFields(req.body, { name: "text" });
  if (!integrationKey || !name) {
    return res.status(400).json({ error: "integrationKey and name are required" });
  }
  const result = await query(
    `INSERT INTO integration_connections (company_id, integration_key, name, config, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.user.companyId, integrationKey, name, JSON.stringify(config || {}), req.user.userId]
  );
  const connection = mapRow(result);
  await writeAuditLog({ userId: req.user.userId, companyId: req.user.companyId, action: "CONNECTION_CREATED", resource: "integration_connections", detail: { connectionId: connection.id, integrationKey } });
  res.status(201).json(connection);
}));

router.post("/:id/credentials", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const connectionId = parseInt(req.params.id);
  const result = await query(
    `SELECT * FROM integration_connections WHERE id = $1 AND company_id = $2`,
    [connectionId, req.user.companyId]
  );
  const connection = mapRow(result);
  if (!connection) return res.status(404).json({ error: "Connection not found" });

  const { authType, secret } = req.body;
  if (!authType || !secret) {
    return res.status(400).json({ error: "authType and secret are required" });
  }

  await revokeCredentials(connectionId, req.user.companyId);
  await storeCredential({ connectionId, companyId: req.user.companyId, authType, secret });

  const connector = getConnector(connection.integrationKey);
  try {
    const testResult = await connector.testConnection({ authType, config: connection.config, secret });
    await query(
      `UPDATE integration_connections SET status = 'connected', external_account_id = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3`,
      [testResult.externalAccountId || null, connectionId, req.user.companyId]
    );
  } catch (err) {
    await query(`UPDATE integration_connections SET status = 'error', updated_at = NOW() WHERE id = $1 AND company_id = $2`, [connectionId, req.user.companyId]);
    await writeAuditLog({ userId: req.user.userId, companyId: req.user.companyId, action: "CONNECTION_TEST_FAILED", resource: "integration_connections", detail: { connectionId, error: err.message } });
    return res.status(400).json({ error: `Connection test failed: ${err.message}` });
  }

  await writeAuditLog({ userId: req.user.userId, companyId: req.user.companyId, action: "CREDENTIAL_STORED", resource: "integration_credentials", detail: { connectionId, authType } });

  const updated = await query(`SELECT * FROM integration_connections WHERE id = $1 AND company_id = $2`, [connectionId, req.user.companyId]);
  res.json(mapRow(updated));
}));

router.post("/:id/run", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const connectionId = parseInt(req.params.id);
  try {
    const run = await runCollection({ connectionId, companyId: req.user.companyId, triggeredBy: req.user.userId, triggerType: "manual" });
    res.json(run);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

router.delete("/:id", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const connectionId = parseInt(req.params.id);
  const result = await query(
    `UPDATE integration_connections SET status = 'revoked', revoked_at = NOW(), updated_at = NOW() WHERE id = $1 AND company_id = $2 RETURNING *`,
    [connectionId, req.user.companyId]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: "Connection not found" });

  await revokeCredentials(connectionId, req.user.companyId);
  await writeAuditLog({ userId: req.user.userId, companyId: req.user.companyId, action: "CONNECTION_REVOKED", resource: "integration_connections", detail: { connectionId } });

  res.status(204).send();
}));

export default router;
