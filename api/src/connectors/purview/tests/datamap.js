const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// Container/grouping kinds (multi-source registrations) rather than actual
// scannable data assets — skip them when iterating sources. Per
// task-3a-research-supplement.md's capability matrix.
const CONTAINER_KINDS = new Set(["azuresubscription", "azureresourcegroup", "amazonaccount", "none"]);

function isContainerKind(kind) {
  return CONTAINER_KINDS.has((kind || "").toLowerCase());
}

// Scope limit: first page only, no pagination via the response's `nextLink`
// — matches this codebase's existing Azure connectors, which also don't
// paginate.
async function fetchScannableSources(dataMap) {
  const response = await dataMap.get("/datasources");
  const sources = response.value || [];
  return sources.filter((source) => !isContainerKind(source.kind));
}

function allScanResults(source) {
  const scans = source.scans || [];
  return scans.flatMap((scan) => scan.scanResults || []);
}

export async function checkSourcesScanned(dataMap) {
  const sources = await fetchScannableSources(dataMap);
  if (sources.length === 0) {
    return [{ resourceId: "account", status: "not_applicable", message: "No registered data sources found", evidencePayload: {} }];
  }

  const now = Date.now();

  return sources.map((source) => {
    const resourceId = source.id || source.name;
    const successResults = allScanResults(source).filter((r) => (r.status || "").toLowerCase() === "completed");

    if (successResults.length === 0) {
      return {
        resourceId,
        status: "fail",
        message: `${source.name || resourceId} has no successful scan runs`,
        evidencePayload: {},
      };
    }

    const mostRecent = successResults.reduce((latest, r) => {
      const rTime = new Date(r.endTime || r.startTime).getTime();
      const latestTime = new Date(latest.endTime || latest.startTime).getTime();
      return rTime > latestTime ? r : latest;
    });
    const mostRecentTime = new Date(mostRecent.endTime || mostRecent.startTime).getTime();
    const withinWindow = now - mostRecentTime <= THIRTY_DAYS_MS;

    return {
      resourceId,
      status: withinWindow ? "pass" : "fail",
      message: withinWindow
        ? `${source.name || resourceId} completed a successful scan within the last 30 days`
        : `${source.name || resourceId}'s most recent successful scan is older than 30 days`,
      evidencePayload: { mostRecentScanTime: mostRecent.endTime || mostRecent.startTime || null },
    };
  });
}

export async function checkScanScheduleConfigured(dataMap) {
  // Each check function fetches /datasources independently rather than
  // sharing a cache with checkSourcesScanned — kept simple/standalone per
  // task-3a-research-supplement.md guidance not to over-engineer this.
  const sources = await fetchScannableSources(dataMap);
  if (sources.length === 0) {
    return [{ resourceId: "account", status: "not_applicable", message: "No registered data sources found", evidencePayload: {} }];
  }

  return sources.map((source) => {
    const resourceId = source.id || source.name;
    // Inferred from scan-run history (`runType`) rather than a direct
    // trigger-configuration read, since the triggers endpoint's response
    // shape wasn't confirmed by research (see task-3a-research-supplement.md).
    const isRecurring = allScanResults(source).some((r) => (r.runType || "").toLowerCase() === "scheduled");
    return {
      resourceId,
      status: isRecurring ? "pass" : "fail",
      message: isRecurring
        ? `${source.name || resourceId} has a recurring scan schedule configured`
        : `${source.name || resourceId} does not have a recurring scan schedule configured`,
      evidencePayload: {},
    };
  });
}

// Approximate Atlas type-name family -> capability mapping, per
// task-3a-research-supplement.md's capability matrix (best-effort — Purview's
// full Atlas type-name taxonomy isn't documented). Matched by case-insensitive
// prefix against entity.typeName / entity.entityType.
const CLASSIFICATION_PREFIXES = ["azure_sql", "azure_storage", "azure_datalake", "adls", "azure_cosmos", "azure_synapse", "amazon_s3", "oracle", "teradata"];
const LABEL_PREFIXES = ["azure_sql", "azure_storage", "azure_datalake", "adls", "azure_cosmos", "azure_synapse"];

function getEntityTypeName(entity) {
  return entity.typeName || entity.entityType || "";
}

function matchesPrefix(typeName, prefixes) {
  const lower = (typeName || "").toLowerCase();
  return prefixes.some((prefix) => lower.startsWith(prefix));
}

// Unrecognized/unrecognized-family types (including sap*, power_bi/powerbi,
// and anything else not in the lists above) default to "not supported" —
// safer than guessing at a false compliance signal.
function sourceTypeSupportsClassification(typeName) {
  return matchesPrefix(typeName, CLASSIFICATION_PREFIXES);
}

function sourceTypeSupportsSensitivityLabeling(typeName) {
  return matchesPrefix(typeName, LABEL_PREFIXES);
}

function entityResourceId(entity) {
  return entity.guid || entity.id || entity.qualifiedName || entity.name;
}

async function searchEntities(dataMap) {
  // Scope limit: first page only, no pagination — same limit as
  // fetchScannableSources above.
  const response = await dataMap.post("/datamap/api/search/query?api-version=2023-09-01", { keywords: null, limit: 100 });
  return response.value || response.entities || [];
}

export async function checkClassificationApplied(dataMap) {
  const entities = await searchEntities(dataMap);
  if (entities.length === 0) {
    return [{ resourceId: "account", status: "not_applicable", message: "No scanned assets were found", evidencePayload: {} }];
  }

  return entities.map((entity) => {
    const resourceId = entityResourceId(entity);
    const typeName = getEntityTypeName(entity);

    if (!sourceTypeSupportsClassification(typeName)) {
      return {
        resourceId,
        status: "not_applicable",
        message: `Asset type "${typeName}" does not support classification`,
        evidencePayload: { typeName },
      };
    }

    const classifications = Array.isArray(entity.classification)
      ? entity.classification
      : Array.isArray(entity.classifications)
        ? entity.classifications
        : [];
    const hasClassifications = classifications.length > 0;

    return {
      resourceId,
      status: hasClassifications ? "pass" : "fail",
      message: hasClassifications ? "Asset has classifications applied" : "Asset has no classifications applied",
      evidencePayload: { typeName, classificationCount: classifications.length },
    };
  });
}

// Looks for any key (on entity.attributes, falling back to the entity itself)
// whose name case-insensitively contains "label" — no confirmed REST field
// name exists for sensitivity labels on Data Map entities (see
// task-3a-research-supplement.md), so this is a defensive best guess.
function findLabelValue(entity) {
  const source = entity.attributes && typeof entity.attributes === "object" ? entity.attributes : entity;
  if (!source || typeof source !== "object") return undefined;
  const key = Object.keys(source).find((k) => k.toLowerCase().includes("label"));
  return key ? source[key] : undefined;
}

export async function checkSensitivityLabelsApplied(dataMap) {
  const entities = await searchEntities(dataMap);
  if (entities.length === 0) {
    return [{ resourceId: "account", status: "not_applicable", message: "No scanned assets were found", evidencePayload: {} }];
  }

  const labelSupport = entities.map((entity) => sourceTypeSupportsSensitivityLabeling(getEntityTypeName(entity)));
  const anyLabelFieldFound = entities.some((entity, i) => labelSupport[i] && findLabelValue(entity) !== undefined);

  // If at least one entity's type supports labeling but not a single one of
  // them exposes a recognizable label field anywhere in the result set, this
  // is an unconfirmed-API-shape gap, not a per-asset compliance failure —
  // collapse to a single not_applicable rather than asserting a false
  // negative on every labelable asset (see task-3a-research-supplement.md).
  if (labelSupport.some(Boolean) && !anyLabelFieldFound) {
    return [
      {
        resourceId: "account",
        status: "not_applicable",
        message:
          "Sensitivity label data was not found in the API response; this may require Microsoft 365 licensing in the tenant, or the field name differs from what this check expects — verify manually in the Purview portal.",
        evidencePayload: {},
      },
    ];
  }

  return entities.map((entity, i) => {
    const resourceId = entityResourceId(entity);
    const typeName = getEntityTypeName(entity);

    if (!labelSupport[i]) {
      return {
        resourceId,
        status: "not_applicable",
        message: `Asset type "${typeName}" does not support sensitivity labeling`,
        evidencePayload: { typeName },
      };
    }

    const hasLabel = Boolean(findLabelValue(entity));
    return {
      resourceId,
      status: hasLabel ? "pass" : "fail",
      message: hasLabel ? "Asset has a sensitivity label applied" : "Asset has no sensitivity label applied",
      evidencePayload: { typeName },
    };
  });
}

export const datamapTests = [
  { key: "purview.datamap.sources_scanned", title: "Registered data sources have a recent successful scan", severityDefault: "high", isoReferences: ["A.8.1.1"], run: (clients) => checkSourcesScanned(clients.dataMap) },
  { key: "purview.datamap.scan_schedule_configured", title: "Registered data sources have a recurring scan schedule", severityDefault: "medium", isoReferences: ["A.8.1.1"], run: (clients) => checkScanScheduleConfigured(clients.dataMap) },
  { key: "purview.datamap.classification_applied", title: "Scanned assets have classifications applied", severityDefault: "medium", isoReferences: ["A.8.2.1"], run: (clients) => checkClassificationApplied(clients.dataMap) },
  { key: "purview.datamap.sensitivity_labels_applied", title: "Scanned assets have sensitivity labels applied", severityDefault: "medium", isoReferences: ["A.8.2.3"], run: (clients) => checkSensitivityLabelsApplied(clients.dataMap) },
];
