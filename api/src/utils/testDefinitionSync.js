import { query } from "../db/index.js";
import { listConnectorKeys, listConnectorTests } from "../connectors/registry.js";

// Upserts `automated_tests` and `test_control_mappings` from the in-code
// connector check definitions (registry.js), so that `init.sql`'s
// hand-written seed INSERTs for these two tables no longer need to be kept
// in sync by hand for new connectors — the JS `tests` arrays (title,
// severityDefault, isoReferences) become the single source of truth at
// runtime. Existing init.sql seed rows are left alone (no migration needed);
// this just keeps both tables current on every startup.
//
// Matches api/src/utils/scheduler.js's error-handling convention (log via
// console.error, never throw — a sync failure shouldn't crash startup), but
// applies it at per-test granularity instead of a single top-level try/catch
// around the whole multi-connector loop: each test definition's writes are
// individually wrapped, so a bad definition anywhere (e.g. a future test
// whose severityDefault falls outside the automated_tests CHECK constraint
// enum, or a malformed isoReferences shape) only skips that one test — every
// other test, in that connector and in every other connector, still gets
// synced in the same run. An outer try/catch is kept around the whole loop
// as a last-resort guard (e.g. if listConnectorKeys/listConnectorTests
// themselves throw), so this function still can never throw.
export async function syncTestDefinitions() {
  try {
    for (const integrationKey of listConnectorKeys()) {
      const tests = listConnectorTests(integrationKey);
      for (const test of tests) {
        try {
          await query(
            `INSERT INTO automated_tests (integration_key, test_key, title, severity_default)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (test_key) DO UPDATE SET title = EXCLUDED.title, severity_default = EXCLUDED.severity_default`,
            [integrationKey, test.key, test.title, test.severityDefault]
          );

          for (const isoReference of test.isoReferences || []) {
            await query(
              `INSERT INTO test_control_mappings (test_key, framework, iso_reference)
               VALUES ($1, 'ISO27001', $2)
               ON CONFLICT (test_key, framework, iso_reference) DO NOTHING`,
              [test.key, isoReference]
            );
          }
        } catch (e) {
          console.error(`[testDefinitionSync] failed to sync test "${test.key}" for connector "${integrationKey}":`, e.message);
        }
      }
    }
    console.log("[testDefinitionSync] synced automated_tests/test_control_mappings from connector definitions");
  } catch (e) {
    console.error("[testDefinitionSync] syncTestDefinitions failed:", e.message);
  }
}
