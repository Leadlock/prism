import crypto from "crypto";
import { query, mapRow } from "../db/index.js";
import { getActiveCredential } from "../db/integrationCredentials.js";
import { getConnector } from "../connectors/registry.js";
import { writeAuditLog } from "./auditLog.js";
import { renderFindingEvidencePdf } from "./findingEvidencePdf.js";
import { saveObject } from "./evidenceStorage.js";

function stableStringify(value) {
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  if (value !== null && typeof value === "object") {
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + stableStringify(value[k]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value);
}

function hashPayload(payload) {
  return crypto.createHash("sha256").update(stableStringify(payload || {})).digest("hex");
}

// Shared helper: links a vault item to every question the given testKey maps to. A
// test_control_mappings row is (test_key, framework, iso_reference) where iso_reference
// holds whatever reference that framework uses — an ISO Annex A clause, a DPDPA
// control_area, a GDPR article, a SOC 2 criterion, etc. (testDefinitionSync.js derives
// the non-ISO/DPDPA rows from data/crosswalk/iso27001-annexa-crosswalk.json). A question
// is matched two ways, unioned:
//   1. legacy columns — questions.iso_reference / questions.control_area equal the ref
//      (covers ISO27001 clause rows and DPDPA control_area rows).
//   2. canonical crosswalk — question_framework_controls(framework_key, control_reference)
//      equals the mapping's (framework, iso_reference), so evidence reaches a canonical
//      question that carries a GDPR/SOC 2/… ref from a company's framework import even
//      when its own legacy columns don't match the connector's ISO clause.
async function linkVaultToQuestions({ companyId, testKey, vaultId }) {
  const questIds = await query(
    `SELECT DISTINCT q.quest_id
       FROM test_control_mappings tcm
       JOIN questions q
         ON q.company_id = $1
        AND (q.iso_reference = tcm.iso_reference OR q.control_area = tcm.iso_reference)
      WHERE tcm.test_key = $2
     UNION
     SELECT DISTINCT qfc.quest_id
       FROM test_control_mappings tcm
       JOIN question_framework_controls qfc
         ON qfc.company_id = $1
        AND qfc.framework_key = tcm.framework
        AND qfc.control_reference = tcm.iso_reference
      WHERE tcm.test_key = $2`,
    [companyId, testKey]
  );
  for (const row of questIds.rows) {
    await query(
      `INSERT INTO question_evidence (company_id, quest_id, vault_id, linked_by)
       VALUES ($1, $2, $3, 'automated')
       ON CONFLICT (company_id, quest_id, vault_id) DO NOTHING`,
      [companyId, row.quest_id, vaultId]
    );
  }
}

// Appends an evidence_versions row (auto-incrementing version_number) recording this
// collection's snapshot. Every re-collection that changed the payload becomes a version
// of the SAME vault item rather than a brand-new evidence document.
async function appendEvidenceVersion({ vaultId, result, file = null }) {
  const maxResult = await query(
    `SELECT COALESCE(MAX(version_number), 0) AS max_ver FROM evidence_versions WHERE evidence_id = $1`,
    [vaultId]
  );
  const nextVer = parseInt(maxResult.rows[0].max_ver, 10) + 1;
  await query(
    `INSERT INTO evidence_versions (evidence_id, version_number, file_name, file_type, file_size, storage_path, uploaded_by, version_notes)
     VALUES ($1, $2, $3, $4, $5, $6, 'automated', $7)
     ON CONFLICT (evidence_id, version_number) DO NOTHING`,
    [vaultId, nextVer, file?.fileName ?? null, file?.fileType ?? null, file?.fileSize ?? null, file?.storageRef ?? null, result.message]
  );
  return nextVer;
}

async function upsertEvidenceForPass({ companyId, result, existingVaultId = null }) {
  // Re-collection of a resource we already have evidence for: keep the one vault item
  // and record the new snapshot in its version history.
  if (existingVaultId) {
    const updated = await query(
      `UPDATE evidence_vault SET description = $1, updated_at = NOW()
       WHERE id = $2 AND company_id = $3 RETURNING id`,
      [result.message, existingVaultId, companyId]
    );
    if (updated.rows.length > 0) {
      await appendEvidenceVersion({ vaultId: existingVaultId, result });
      await linkVaultToQuestions({ companyId, testKey: result.testKey, vaultId: existingVaultId });
      return existingVaultId;
    }
    // Pointer was dangling (vault row deleted) — fall through and create a fresh item.
  }

  const vaultResult = await query(
    `INSERT INTO evidence_vault (company_id, title, description, uploaded_by)
     VALUES ($1, $2, $3, 'automated') RETURNING *`,
    [companyId, `${result.testKey} — ${result.resourceId}`, result.message]
  );
  const vault = mapRow(vaultResult);
  await appendEvidenceVersion({ vaultId: vault.id, result });
  await linkVaultToQuestions({ companyId, testKey: result.testKey, vaultId: vault.id });
  return vault.id;
}

// Generates a real pdfkit PDF, writes it to storage, and either appends it as a new
// version of the finding's existing evidence item or (first time) creates the vault row.
// Auto-links it to all matching questions.
async function generateFindingEvidenceVaultItem({ companyId, connectionId, result, existingFinding }) {
  const [mappingRows, connRow, testRow] = await Promise.all([
    query(`SELECT framework, iso_reference FROM test_control_mappings WHERE test_key = $1`, [result.testKey]),
    query(`SELECT name, integration_key FROM integration_connections WHERE id = $1`, [connectionId]),
    query(`SELECT description, remediation_guidance FROM automated_tests WHERE test_key = $1`, [result.testKey]),
  ]);
  const conn = mapRow(connRow);
  const testMeta = mapRow(testRow);

  const pdfBuffer = await renderFindingEvidencePdf({
    title: result.failTitle || result.title || result.testKey,
    testKey: result.testKey,
    resourceId: result.resourceId,
    severity: result.severity,
    message: result.message,
    evidencePayload: result.evidencePayload,
    isoReferences: mappingRows.rows.map(r => r.iso_reference),
    controlMappings: mappingRows.rows.map(r => ({ framework: r.framework, isoReference: r.iso_reference })),
    testDescription: testMeta?.description ?? null,
    remediationGuidance: testMeta?.remediationGuidance ?? null,
    connectionName: conn?.name,
    integrationKey: conn?.integrationKey,
    companyId,
    connectionId,
    // A re-detected finding keeps its original detection date and lifecycle
    // state; a brand-new one is Open as of now.
    status: existingFinding?.status || "open",
    firstDetectedAt: existingFinding?.firstDetectedAt ?? null,
    linkedActionId: existingFinding?.linkedActionId ?? null,
  });

  const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}.pdf`;
  const storageRef = await saveObject(companyId, {
    buffer: pdfBuffer,
    originalName: fileName,
    scope: "vault",
    contentType: "application/pdf",
  });
  const file = { fileName, fileType: "application/pdf", fileSize: pdfBuffer.length, storageRef };

  const existingVaultId = existingFinding?.evidenceVaultId || null;
  if (existingVaultId) {
    const updated = await query(
      `UPDATE evidence_vault
         SET description = $1, file_name = $2, file_type = 'application/pdf', file_size = $3, storage_path = $4, updated_at = NOW()
       WHERE id = $5 AND company_id = $6 RETURNING id`,
      [result.message, fileName, pdfBuffer.length, storageRef, existingVaultId, companyId]
    );
    if (updated.rows.length > 0) {
      await appendEvidenceVersion({ vaultId: existingVaultId, result, file });
      await linkVaultToQuestions({ companyId, testKey: result.testKey, vaultId: existingVaultId });
      return existingVaultId;
    }
    // Pointer was dangling — fall through and create a fresh item.
  }

  const vaultResult = await query(
    `INSERT INTO evidence_vault (company_id, title, description, file_name, file_type, file_size, storage_path, uploaded_by)
     VALUES ($1, $2, $3, $4, 'application/pdf', $5, $6, 'automated') RETURNING *`,
    [companyId, `${result.testKey} — ${result.resourceId}`, result.message, fileName, pdfBuffer.length, storageRef]
  );
  const vault = mapRow(vaultResult);
  await appendEvidenceVersion({ vaultId: vault.id, result, file });
  await linkVaultToQuestions({ companyId, testKey: result.testKey, vaultId: vault.id });
  return vault.id;
}

async function upsertFinding({ companyId, connectionId, result, sourceResultId }) {
  const payloadHash = hashPayload(result.evidencePayload);
  const existing = await query(
    `SELECT evidence_vault_id, payload_hash, status, first_detected_at, linked_action_id
       FROM findings WHERE company_id = $1 AND connection_id = $2 AND test_key = $3 AND resource_id = $4`,
    [companyId, connectionId, result.testKey, result.resourceId]
  );
  const existingFinding = mapRow(existing);

  // Only generate a new PDF if evidence is new or has changed (dedup by payload hash)
  let vaultId = existingFinding?.evidenceVaultId || null;
  if (!existingFinding || !existingFinding.evidenceVaultId || existingFinding.payloadHash !== payloadHash) {
    vaultId = await generateFindingEvidenceVaultItem({ companyId, connectionId, result, existingFinding });
  }

  await query(
    `INSERT INTO findings (company_id, connection_id, test_key, resource_id, severity, title, description, source_result_id, evidence_vault_id, payload_hash, last_detected_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
     ON CONFLICT (company_id, connection_id, test_key, resource_id)
     DO UPDATE SET
       status = CASE WHEN findings.status = 'resolved' THEN 'open' ELSE findings.status END,
       last_detected_at = NOW(),
       source_result_id = EXCLUDED.source_result_id,
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       evidence_vault_id = EXCLUDED.evidence_vault_id,
       payload_hash = EXCLUDED.payload_hash`,
    [companyId, connectionId, result.testKey, result.resourceId, result.severity, result.failTitle || result.title || result.testKey, result.message, sourceResultId, vaultId, payloadHash]
  );
}


export async function runCollection({ connectionId, companyId, triggeredBy, triggerType = "manual" }) {
  const connectionResult = await query(
    `SELECT * FROM integration_connections WHERE id = $1 AND company_id = $2`,
    [connectionId, companyId]
  );
  const connection = mapRow(connectionResult);
  if (!connection) throw new Error("Connection not found");

  const credential = await getActiveCredential(connectionId, companyId);
  if (!credential) throw new Error("No active credential for this connection");

  let runResult;
  try {
    runResult = await query(
      `INSERT INTO evidence_collection_runs (company_id, connection_id, trigger_type, status, triggered_by)
       VALUES ($1, $2, $3, 'running', $4) RETURNING *`,
      [companyId, connectionId, triggerType, triggeredBy || null]
    );
  } catch (err) {
    if (err.code === "23505") {
      throw Object.assign(new Error("A collection run is already in progress for this connection"), { status: 409 });
    }
    throw err;
  }
  const run = mapRow(runResult);

  let results = [];
  let runFailed = false;
  let errorMessage = null;
  let passed = 0;
  let failed = 0;
  let processedResults = 0;

  // Everything from connector resolution through per-result persistence is one
  // error boundary: any failure here (unknown integration, connector throwing,
  // or a DB write failing mid-loop) must still finalize the run as 'failed'
  // with a captured error_message rather than leaving it stuck in 'running'.
  try {
    const connector = getConnector(connection.integrationKey);
    results = await connector.runTests({ authType: credential.authType, config: connection.config, secret: credential.secret });

    for (const result of results) {
      const resultRow = await query(
        `INSERT INTO evidence_test_results (run_id, company_id, test_key, resource_id, status, severity, message, evidence_payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [run.id, companyId, result.testKey, result.resourceId, result.status, result.severity, result.message, JSON.stringify(result.evidencePayload || {})]
      );
      const savedResult = mapRow(resultRow);

      if (result.status === "pass") {
        passed++;
        const payloadHash = hashPayload(result.evidencePayload);
        const existing = await query(
          `SELECT * FROM automated_evidence_items WHERE company_id = $1 AND connection_id = $2 AND test_key = $3 AND resource_id = $4`,
          [companyId, connectionId, result.testKey, result.resourceId]
        );
        const existingItem = mapRow(existing);
        let vaultId = existingItem?.evidenceVaultId;
        if (!existingItem || existingItem.payloadHash !== payloadHash) {
          vaultId = await upsertEvidenceForPass({ companyId, result, existingVaultId: existingItem?.evidenceVaultId });
        }
        await query(
          `INSERT INTO automated_evidence_items (company_id, connection_id, evidence_vault_id, test_key, resource_id, latest_result_id, payload_hash, status, last_collected_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'fresh', NOW())
           ON CONFLICT (company_id, connection_id, test_key, resource_id)
           DO UPDATE SET evidence_vault_id = EXCLUDED.evidence_vault_id, latest_result_id = EXCLUDED.latest_result_id,
             payload_hash = EXCLUDED.payload_hash, status = 'fresh', last_collected_at = NOW()`,
          [companyId, connectionId, vaultId, result.testKey, result.resourceId, savedResult.id, payloadHash]
        );
        await query(
          `UPDATE findings SET status = 'resolved', resolved_at = NOW()
           WHERE company_id = $1 AND connection_id = $2 AND test_key = $3 AND resource_id = $4 AND status = 'open'`,
          [companyId, connectionId, result.testKey, result.resourceId]
        );
      } else if (result.status === "fail") {
        failed++;
        await upsertFinding({ companyId, connectionId, result, sourceResultId: savedResult.id });
      }

      processedResults++;
    }
  } catch (err) {
    runFailed = true;
    errorMessage = err.message;
  }

  const testsRun = processedResults;
  const finalStatus = runFailed ? "failed" : (failed > 0 ? "partial_failure" : "success");

  const finalRunResult = await query(
    `UPDATE evidence_collection_runs
     SET status = $1, tests_run = $2, tests_passed = $3, tests_failed = $4, error_message = $5, finished_at = NOW()
     WHERE id = $6 AND company_id = $7
     RETURNING *`,
    [finalStatus, testsRun, passed, failed, errorMessage, run.id, companyId]
  );
  const finalRun = mapRow(finalRunResult);

  await query(
    `UPDATE integration_connections SET last_run_at = NOW(), last_run_status = $1, status = $2, updated_at = NOW() WHERE id = $3 AND company_id = $4`,
    [finalStatus, finalStatus === "failed" ? "error" : "connected", connectionId, companyId]
  );

  await writeAuditLog({
    userId: triggeredBy,
    companyId,
    action: "COLLECTION_RUN_COMPLETED",
    resource: "evidence_collection_runs",
    detail: { runId: run.id, connectionId, status: finalStatus, testsRun, testsPassed: passed, testsFailed: failed },
  });

  return { ...finalRun, testsRun, testsPassed: passed, testsFailed: failed };
}
