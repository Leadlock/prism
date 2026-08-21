# Extending the AWS Connector

This document specifies how to extend Prism's existing AWS evidence-collection connector
(`api/src/connectors/aws/`) with checks for eight new services. It does not change the
connector's architecture, auth model, or the shape of a "check" — it only adds new SDK
clients, new test files, and new seed rows following the existing pattern exactly.

## 1. Overview

The AWS connector (`key = "aws"`) currently ships checks for:

| Service area | File | Checks |
|---|---|---|
| IAM | `tests/iam.js` | MFA enforcement, password policy, access key age |
| Logging | `tests/logging.js` | CloudTrail enabled (single check), Config recorder enabled |
| Network (EC2/S3 partial) | `tests/network.js` | S3 public access block, security group open ingress |
| RDS | `tests/rds.js` | Public accessibility, storage encryption, automated backups |
| Lambda | `tests/lambda.js` | Function URL auth, resource policy wildcard principal |
| DynamoDB | `tests/dynamodb.js` | Point-in-time recovery, CMK encryption |
| KMS | `tests/kms.js` | Key rotation, key policy wildcard principal |

This spec adds **20 new checks across 8 additional service areas**, without touching or
re-numbering any existing `test_key`:

| Service | New file | New checks |
|---|---|---|
| AWS Config (deepen) | `tests/config.js` | 2 |
| CloudTrail (deepen) | `tests/logging.js` (extended, not a new file) | 2 |
| CloudWatch / CloudWatch Logs | `tests/cloudwatch.js` | 2 |
| WAFv2 | `tests/waf.js` | 2 |
| Secrets Manager | `tests/secretsmanager.js` | 3 |
| GuardDuty | `tests/guardduty.js` | 2 |
| Security Hub | `tests/securityhub.js` | 2 |
| ECR | `tests/ecr.js` | 3 |
| ECS | `tests/ecs.js` | 2 |
| **Total** | | **20** |

CloudTrail is deepened in the existing `tests/logging.js` (it already imports
`@aws-sdk/client-cloudtrail` and exports `loggingTests`) rather than a new file, to avoid a
second module owning `cloudtrail` client calls. AWS Config is also deepened in a **new**
`tests/config.js` file (separate from `logging.js`) since its two new checks are
meaningfully different in scope (rule compliance / recording scope) from the existing
recorder-on/off check, and to keep each file's job template call scoped to one client.

Nothing about `resolveAwsCredentials`, the `integrations` catalog row, the connections UI,
or `runTests()`'s loop needs to change — only `buildClients()` and the `tests` array in
`api/src/connectors/aws/index.js` gain entries.

## 2. Authentication (unchanged) — additional IAM permissions required

Auth is unchanged: customers still connect via `auth_type = 'iam_role'`, Prism still calls
`resolveAwsCredentials()` in `api/src/connectors/aws/credentials.js`, which does
`sts:AssumeRole` with the customer-supplied `RoleArn` and `ExternalId`. No new auth code is
needed.

What **does** change is the customer-side IAM policy attached to the role Prism assumes.
Customers must add the following actions (all read-only, no `*` resource wildcards implied
beyond what the APIs require — several of these AWS APIs are list/describe-only and do not
support resource-level scoping). Add this as a new statement, or merge into the existing
policy statement, in the customer's onboarding IAM policy template/docs:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PrismAwsConnectorNewServices",
      "Effect": "Allow",
      "Action": [
        "config:DescribeConfigRules",
        "config:DescribeComplianceByConfigRule",
        "config:GetComplianceDetailsByConfigRule",
        "config:DescribeConfigurationRecorders",

        "cloudtrail:DescribeTrails",
        "cloudtrail:GetTrailStatus",
        "cloudtrail:GetEventSelectors",

        "cloudwatch:DescribeAlarms",
        "logs:DescribeLogGroups",

        "wafv2:ListWebACLs",
        "wafv2:GetWebACL",
        "wafv2:ListResourcesForWebACL",
        "wafv2:GetLoggingConfiguration",

        "secretsmanager:ListSecrets",
        "secretsmanager:DescribeSecret",

        "guardduty:ListDetectors",
        "guardduty:GetDetector",
        "guardduty:ListFindings",
        "guardduty:GetFindings",

        "securityhub:DescribeHub",
        "securityhub:GetEnabledStandards",
        "securityhub:GetFindings",

        "ecr:DescribeRepositories",
        "ecr:GetRepositoryPolicy",
        "ecr:DescribeImageScanFindings",

        "ecs:ListClusters",
        "ecs:DescribeClusters",
        "ecs:ListTaskDefinitions",
        "ecs:DescribeTaskDefinition"
      ],
      "Resource": "*"
    }
  ]
}
```

Notes for the customer-facing setup docs:
- `config:DescribeConfigRules` / `DescribeComplianceByConfigRule` / `GetComplianceDetailsByConfigRule` and
  `cloudtrail:*`, `cloudwatch:DescribeAlarms`, `logs:DescribeLogGroups` are all list/describe
  IAM actions that AWS does not support resource-level restriction on — `Resource: "*"` is
  required by the service, not a Prism choice.
- `wafv2:GetWebACL` and `wafv2:GetLoggingConfiguration` technically support resource ARNs;
  since Prism doesn't know ARNs ahead of a scan, this policy grants account-wide read, which
  is consistent with every other read in this connector's design (it's a single shared role
  used for full-account posture scanning, not a scoped per-resource integration).
- No write/mutating action is included anywhere in this list — this connector is
  strictly read-only evidence collection, matching the existing 7 services.

## 3. API Reference

All packages are official `@aws-sdk/client-*` v3 packages, same major/minor line already
pinned in `api/package.json` (currently `^3.111x.0`). Verified against the npm registry
(latest resolved: `3.1115.0` for all eight new packages as of this doc):

| Package | New in `package.json`? |
|---|---|
| `@aws-sdk/client-config-service` | Already a dependency (imported, underused) |
| `@aws-sdk/client-cloudtrail` | Already a dependency |
| `@aws-sdk/client-cloudwatch` | **New** |
| `@aws-sdk/client-cloudwatch-logs` | **New** |
| `@aws-sdk/client-wafv2` | **New** |
| `@aws-sdk/client-secrets-manager` | **New** |
| `@aws-sdk/client-guardduty` | **New** |
| `@aws-sdk/client-securityhub` | **New** |
| `@aws-sdk/client-ecr` | **New** |
| `@aws-sdk/client-ecs` | **New** |

Add to `api/package.json` `dependencies` (mirroring the existing pinning style):

```json
"@aws-sdk/client-cloudwatch": "^3.1115.0",
"@aws-sdk/client-cloudwatch-logs": "^3.1115.0",
"@aws-sdk/client-ecr": "^3.1115.0",
"@aws-sdk/client-ecs": "^3.1115.0",
"@aws-sdk/client-guardduty": "^3.1115.0",
"@aws-sdk/client-secrets-manager": "^3.1115.0",
"@aws-sdk/client-securityhub": "^3.1115.0",
"@aws-sdk/client-wafv2": "^3.1115.0",
```

### AWS Config (deepen)

- `DescribeConfigRulesCommand({})` → `ConfigRules[]` (paginated via `NextToken`, unlikely to
  exceed one page for most accounts).
- `DescribeComplianceByConfigRuleCommand({ ConfigRuleNames })` → `ComplianceByConfigRules[]`
  with `.Compliance.ComplianceType` (`COMPLIANT` | `NON_COMPLIANT` | `NOT_APPLICABLE` |
  `INSUFFICIENT_DATA`).
- `DescribeConfigurationRecordersCommand({})` (already imported in `logging.js`) — the
  `recordingGroup.allSupported` field on each recorder tells you if all resource types are
  recorded vs. a scoped subset.
- No rate-limit concerns for a single-account scan (Config's API quota is generous;
  ~2 req/sec default is far above what one scan needs).

### CloudTrail (deepen)

- `DescribeTrailsCommand({})` (already imported) — `trailList[].LogFileValidationEnabled`
  and `trailList[].KmsKeyId` are already present on the object returned today; no new API
  call needed for log-file-validation.
- `GetEventSelectorsCommand({ TrailName })` → `EventSelectors[]` (or
  `AdvancedEventSelectors[]` for trails configured via the newer advanced selector API) —
  used to confirm S3/Lambda data events are logged, not just management events.
- Handle both `EventSelectors` (legacy) and `AdvancedEventSelectors` (current console
  default) response shapes — a trail configured via the modern console UI will populate
  `AdvancedEventSelectors` and leave `EventSelectors` empty.

### CloudWatch / CloudWatch Logs

- `DescribeAlarmsCommand({})` (from `@aws-sdk/client-cloudwatch`) → `MetricAlarms[]` +
  `CompositeAlarms[]`, paginated via `NextToken`.
- `DescribeLogGroupsCommand({})` (from `@aws-sdk/client-cloudwatch-logs`, a **separate**
  package/client from `client-cloudwatch`) → `logGroups[]` with `.retentionInDays`
  (`undefined`/absent means "never expire") and `.kmsKeyId`.
- Both commands paginate with `nextToken`; for accounts with many log groups, loop until
  `nextToken` is absent.

### WAFv2

- WAFv2 is **scope-sensitive**: `Scope: "REGIONAL"` for ALB/API Gateway/AppSync-attached
  Web ACLs (any configured region), `Scope: "CLOUDFRONT"` for CloudFront distributions —
  and a `CLOUDFRONT`-scoped call **must** be made against the `us-east-1` endpoint
  regardless of the connection's configured region. Run both scopes; construct one extra
  `WAFV2Client` pinned to `us-east-1` for the CLOUDFRONT scope only.
- `ListWebACLsCommand({ Scope })` → `WebACLs[]` (id/name/ARN only).
- `GetWebACLCommand({ Id, Name, Scope })` → full Web ACL incl. `DefaultAction`, `Rules`.
- `ListResourcesForWebACLCommand({ WebACLArn, ResourceType })` → associated resource ARNs
  (`ResourceType` one of `APPLICATION_LOAD_BALANCER`, `API_GATEWAY`, `APPSYNC`,
  `COGNITO_USER_POOL`, `APP_RUNNER_SERVICE`, `VERIFIED_ACCESS_INSTANCE`) — needed to check
  whether internet-facing resources actually have a Web ACL attached, not just whether one
  exists.
- `GetLoggingConfigurationCommand({ ResourceArn })` → throws `WAFNonexistentItemException`
  if logging isn't configured for that Web ACL — treat that exception as "logging
  disabled", not an error.

### Secrets Manager

- `ListSecretsCommand({})` → `SecretList[]`, paginated via `NextToken`. Each entry already
  includes `RotationEnabled`, `RotationRules`, `LastRotatedDate`, `KmsKeyId` — no need to
  call `DescribeSecretCommand` per-secret for these fields (saves N extra calls); reserve
  `DescribeSecretCommand` only if a field is missing from the list response in practice.
- Default account-wide rate limit App Server throttling is generous (5 req/sec default);
  `ListSecrets` pagination alone is sufficient for even large secret inventories.

### GuardDuty

- `ListDetectorsCommand({})` → `DetectorIds[]` (0 or 1 in almost all single-region-per-call
  setups — one detector per account per region).
- `GetDetectorCommand({ DetectorId })` → `.Status` (`ENABLED`/`DISABLED`) and `.DataSources`
  (S3Logs/Kubernetes/MalwareProtection sub-statuses).
- `ListFindingsCommand({ DetectorId, FindingCriteria })` → finding IDs, paginate via
  `NextToken`; filter with `FindingCriteria: { Criterion: { severity: { Gte: 7 } } }` to
  scope directly to High/Critical (GuardDuty severities are 0.1–8.9; ≥7.0 is High+) rather
  than filtering client-side.
- `GetFindingsCommand({ DetectorId, FindingIds })` → full finding detail if titles/detail
  are needed in `evidencePayload` (max 50 IDs per call — batch if more).

### Security Hub

- `DescribeHubCommand({})` — throws `InvalidAccessException` if Security Hub isn't enabled
  in the region; treat that as "not enabled" (fail), not a runtime error.
- `GetEnabledStandardsCommand({})` → `StandardsSubscriptions[]` with `.StandardsStatus`
  (`READY`/`PENDING`/`FAILED`) — check at least one standard (e.g. AWS Foundational Security
  Best Practices, CIS AWS Foundations) is subscribed and `READY`.
- `GetFindingsCommand({ Filters })` → paginate via `NextToken`; filter with
  `Filters: { SeverityLabel: [{ Value: "CRITICAL", Comparison: "EQUALS" }, { Value: "HIGH", Comparison: "EQUALS" }], RecordState: [{ Value: "ACTIVE", Comparison: "EQUALS" }], WorkflowStatus: [{ Value: "NEW", Comparison: "EQUALS" }] }`
  to scope server-side to actionable, unresolved high-severity findings.

### ECR

- `DescribeRepositoriesCommand({})` → `repositories[]` with `.imageScanningConfiguration.scanOnPush`
  and `.imageTagMutability` (`MUTABLE`/`IMMUTABLE`) already inline — no extra call needed
  for those two checks. Paginate via `nextToken`.
- `GetRepositoryPolicyCommand({ repositoryName })` → throws `RepositoryPolicyNotFoundException`
  if no policy is attached (treat as pass — no policy means no wildcard grant).
- `DescribeImageScanFindingsCommand({ repositoryName, imageId })` is only needed if a deeper
  "images have no critical CVEs" check is added later — not required for the 3 checks
  proposed here, listed for completeness since it's in the least-privilege policy above as
  a natural next step.

### ECS

- `ListClustersCommand({})` → cluster ARNs, then `DescribeClustersCommand({ clusters, include: ["SETTINGS"] })`
  → `.settings[]` with `{ name: "containerInsights", value: "enabled"|"disabled" }`.
- `ListTaskDefinitionsCommand({ status: "ACTIVE" })` → paginate via `nextToken`, then
  `DescribeTaskDefinitionCommand({ taskDefinition })` per family:revision → 
  `.taskDefinition.containerDefinitions[].privileged` (boolean, defaults to `false`/absent
  when not set).
- Calling `DescribeTaskDefinition` once per active revision can be a lot of calls for
  accounts with many task definitions/revisions — consider checking only the latest
  `ACTIVE` revision per family (group `ListTaskDefinitions` results by family, keep the
  highest revision number) rather than every historical active revision.

## 4. Proposed Checks

`test_key` | `title` | `severity_default` | `iso_reference` | `description` | `remediation_guidance`
---|---|---|---|---|---
`aws.config.rules_compliant` | AWS Config rules report compliant resources | medium | A.12.1.2 | Checks every AWS Config rule's compliance evaluation is COMPLIANT, flagging any rule with NON_COMPLIANT resources. | Review the non-compliant resources listed under the Config rule and remediate them, or update the rule if it no longer reflects policy. |
`aws.config.all_resource_types_recorded` | AWS Config recorder tracks all supported resource types | medium | A.12.1.1 | Checks the AWS Config recorder is configured with `allSupported: true` rather than a scoped subset of resource types. | Edit the Config recorder settings to record all resource types supported in the region. |
`aws.cloudtrail.log_file_validation_enabled` | CloudTrail trails have log file validation enabled | high | A.12.4.2 | Checks every CloudTrail trail has log file integrity validation enabled, so log tampering can be detected. | Enable log file validation on the trail under CloudTrail > Trails > General details. |
`aws.cloudtrail.data_events_logged` | CloudTrail records data-plane events for S3 and Lambda | medium | A.12.4.1 | Checks at least one trail has event selectors (or advanced event selectors) configured to log S3 object-level and Lambda invoke data events. | Add an event selector (or advanced event selector) to the trail covering S3 and Lambda data events. |
`aws.cloudwatch.alarms_configured` | CloudWatch alarms exist for account activity | medium | A.12.4.1 | Checks at least one CloudWatch alarm (metric or composite) is configured in the account/region. | Create CloudWatch alarms for key security metrics (e.g. root account usage, unauthorized API calls, IAM policy changes). |
`aws.cloudwatch.log_group_retention_configured` | CloudWatch Logs groups have a retention period set | medium | A.12.4.1 | Checks every CloudWatch Logs log group has a finite retention period rather than "Never expire". | Set a retention policy on the log group under CloudWatch > Log groups > Actions > Edit retention setting. |
`aws.waf.web_acl_associated` | Internet-facing resources are protected by a WAF Web ACL | high | A.13.1.1 | Checks Application Load Balancers, API Gateway stages, and CloudFront distributions have an associated WAFv2 Web ACL. | Create a WAFv2 Web ACL with the AWS managed rule groups appropriate for the workload and associate it with the resource. |
`aws.waf.logging_enabled` | WAF Web ACLs have logging enabled | medium | A.12.4.1 | Checks every WAFv2 Web ACL has a logging configuration delivering to a log destination (Kinesis Firehose, S3, or CloudWatch Logs). | Enable logging on the Web ACL and configure a log destination under WAF > Web ACLs > Logging and metrics. |
`aws.secretsmanager.rotation_enabled` | Secrets Manager secrets have automatic rotation enabled | high | A.9.2.4 | Checks every secret in Secrets Manager has `RotationEnabled` set, so credentials are rotated on a schedule rather than manually. | Configure automatic rotation on the secret, using a rotation Lambda function appropriate to the credential type. |
`aws.secretsmanager.encrypted_with_cmk` | Secrets Manager secrets are encrypted with a customer-managed key | medium | A.10.1.2 | Checks every secret uses a customer-managed KMS key rather than the default `aws/secretsmanager` AWS-owned key. | Re-encrypt the secret with a customer-managed KMS key under the secret's Encryption configuration. |
`aws.secretsmanager.no_stale_secrets` | Secrets Manager secrets are rotated within policy | medium | A.9.2.4 | Checks that secrets with rotation enabled have actually rotated within their configured rotation interval (flags a configured-but-stalled rotation). | Investigate why the rotation Lambda is failing (check CloudWatch Logs for the rotation function) and trigger a manual rotation to re-establish the schedule. |
`aws.guardduty.enabled` | GuardDuty is enabled | critical | A.12.6.1 | Checks a GuardDuty detector exists and its status is ENABLED in the account/region. | Enable GuardDuty for the account/region under GuardDuty > Get started. |
`aws.guardduty.high_severity_findings_resolved` | No unresolved high-severity GuardDuty findings | high | A.16.1.2 | Checks there are no active (unarchived) GuardDuty findings with severity ≥ 7.0 (High/Critical). | Triage the finding in GuardDuty, remediate the underlying issue, and archive the finding once resolved. |
`aws.securityhub.enabled` | Security Hub is enabled with a standard subscribed | high | A.12.6.1 | Checks Security Hub is enabled in the account/region and at least one security standard (e.g. AWS Foundational Security Best Practices) is subscribed and READY. | Enable Security Hub and subscribe to at least the AWS Foundational Security Best Practices standard. |
`aws.securityhub.critical_findings_resolved` | No active critical/high Security Hub findings | high | A.16.1.2 | Checks there are no ACTIVE, unresolved (WorkflowStatus = NEW) Security Hub findings with severity CRITICAL or HIGH. | Triage the finding in Security Hub, remediate the underlying resource misconfiguration, and update its workflow status once resolved. |
`aws.ecr.image_scanning_enabled` | ECR repositories scan images on push | high | A.12.6.1 | Checks every ECR repository has `scanOnPush` enabled so images are scanned for known vulnerabilities automatically. | Enable "Scan on push" under the repository's Image scanning settings, or enable enhanced scanning account-wide via Amazon Inspector. |
`aws.ecr.tag_immutability_enabled` | ECR repositories enforce immutable image tags | medium | A.12.5.1 | Checks every ECR repository has `imageTagMutability` set to IMMUTABLE, preventing a tag (e.g. `latest`, `prod`) from being silently repointed to a different image. | Set the repository's tag mutability setting to Immutable under repository settings. |
`aws.ecr.no_wildcard_repository_policy` | ECR repository policies do not grant a wildcard principal | critical | A.9.1.2 | Checks no ECR repository's resource policy grants access to Principal "*". | Scope the repository policy's Principal to specific account IDs, roles, or organizations instead of "*". |
`aws.ecs.no_privileged_containers` | ECS task definitions do not run privileged containers | critical | A.9.4.4 | Checks no container definition in an active ECS task definition revision sets `privileged: true`. | Remove the `privileged` flag from the container definition and grant only the specific Linux capabilities the container needs via `linuxParameters.capabilities`. |
`aws.ecs.container_insights_enabled` | ECS clusters have Container Insights enabled | medium | A.12.4.1 | Checks every ECS cluster has the `containerInsights` cluster setting enabled for monitoring and logging. | Enable Container Insights under the cluster's Monitoring settings, or via `UpdateClusterSettings`. |

That's 2 + 2 + 2 + 2 + 3 + 2 + 2 + 3 + 2 = **20 checks**.

## 5. Seed SQL

The `('aws', 'Amazon Web Services', 'cloud', 'iam_role', 'active')` row in `integrations`
already exists (inserted earlier in `init.sql`) — do **not** re-insert it. Append the
following directly after the existing AWS `test_control_mappings` block (i.e. right before
the `-- azure` section, after line ~656 as of this writing) in `init.sql`:

```sql
INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('aws', 'aws.config.rules_compliant', 'AWS Config rules report compliant resources', 'Checks every AWS Config rule''s compliance evaluation is COMPLIANT, flagging any rule with NON_COMPLIANT resources.', 'medium', 'Review the non-compliant resources listed under the Config rule and remediate them, or update the rule if it no longer reflects policy.'),
  ('aws', 'aws.config.all_resource_types_recorded', 'AWS Config recorder tracks all supported resource types', 'Checks the AWS Config recorder is configured with allSupported: true rather than a scoped subset of resource types.', 'medium', 'Edit the Config recorder settings to record all resource types supported in the region.'),
  ('aws', 'aws.cloudtrail.log_file_validation_enabled', 'CloudTrail trails have log file validation enabled', 'Checks every CloudTrail trail has log file integrity validation enabled, so log tampering can be detected.', 'high', 'Enable log file validation on the trail under CloudTrail > Trails > General details.'),
  ('aws', 'aws.cloudtrail.data_events_logged', 'CloudTrail records data-plane events for S3 and Lambda', 'Checks at least one trail has event selectors (or advanced event selectors) configured to log S3 object-level and Lambda invoke data events.', 'medium', 'Add an event selector (or advanced event selector) to the trail covering S3 and Lambda data events.'),
  ('aws', 'aws.cloudwatch.alarms_configured', 'CloudWatch alarms exist for account activity', 'Checks at least one CloudWatch alarm (metric or composite) is configured in the account/region.', 'medium', 'Create CloudWatch alarms for key security metrics (e.g. root account usage, unauthorized API calls, IAM policy changes).'),
  ('aws', 'aws.cloudwatch.log_group_retention_configured', 'CloudWatch Logs groups have a retention period set', 'Checks every CloudWatch Logs log group has a finite retention period rather than "Never expire".', 'medium', 'Set a retention policy on the log group under CloudWatch > Log groups > Actions > Edit retention setting.'),
  ('aws', 'aws.waf.web_acl_associated', 'Internet-facing resources are protected by a WAF Web ACL', 'Checks Application Load Balancers, API Gateway stages, and CloudFront distributions have an associated WAFv2 Web ACL.', 'high', 'Create a WAFv2 Web ACL with the AWS managed rule groups appropriate for the workload and associate it with the resource.'),
  ('aws', 'aws.waf.logging_enabled', 'WAF Web ACLs have logging enabled', 'Checks every WAFv2 Web ACL has a logging configuration delivering to a log destination (Kinesis Firehose, S3, or CloudWatch Logs).', 'medium', 'Enable logging on the Web ACL and configure a log destination under WAF > Web ACLs > Logging and metrics.'),
  ('aws', 'aws.secretsmanager.rotation_enabled', 'Secrets Manager secrets have automatic rotation enabled', 'Checks every secret in Secrets Manager has RotationEnabled set, so credentials are rotated on a schedule rather than manually.', 'high', 'Configure automatic rotation on the secret, using a rotation Lambda function appropriate to the credential type.'),
  ('aws', 'aws.secretsmanager.encrypted_with_cmk', 'Secrets Manager secrets are encrypted with a customer-managed key', 'Checks every secret uses a customer-managed KMS key rather than the default aws/secretsmanager AWS-owned key.', 'medium', 'Re-encrypt the secret with a customer-managed KMS key under the secret''s Encryption configuration.'),
  ('aws', 'aws.secretsmanager.no_stale_secrets', 'Secrets Manager secrets are rotated within policy', 'Checks that secrets with rotation enabled have actually rotated within their configured rotation interval (flags a configured-but-stalled rotation).', 'medium', 'Investigate why the rotation Lambda is failing (check CloudWatch Logs for the rotation function) and trigger a manual rotation to re-establish the schedule.'),
  ('aws', 'aws.guardduty.enabled', 'GuardDuty is enabled', 'Checks a GuardDuty detector exists and its status is ENABLED in the account/region.', 'critical', 'Enable GuardDuty for the account/region under GuardDuty > Get started.'),
  ('aws', 'aws.guardduty.high_severity_findings_resolved', 'No unresolved high-severity GuardDuty findings', 'Checks there are no active (unarchived) GuardDuty findings with severity >= 7.0 (High/Critical).', 'high', 'Triage the finding in GuardDuty, remediate the underlying issue, and archive the finding once resolved.'),
  ('aws', 'aws.securityhub.enabled', 'Security Hub is enabled with a standard subscribed', 'Checks Security Hub is enabled in the account/region and at least one security standard (e.g. AWS Foundational Security Best Practices) is subscribed and READY.', 'high', 'Enable Security Hub and subscribe to at least the AWS Foundational Security Best Practices standard.'),
  ('aws', 'aws.securityhub.critical_findings_resolved', 'No active critical/high Security Hub findings', 'Checks there are no ACTIVE, unresolved (WorkflowStatus = NEW) Security Hub findings with severity CRITICAL or HIGH.', 'high', 'Triage the finding in Security Hub, remediate the underlying resource misconfiguration, and update its workflow status once resolved.'),
  ('aws', 'aws.ecr.image_scanning_enabled', 'ECR repositories scan images on push', 'Checks every ECR repository has scanOnPush enabled so images are scanned for known vulnerabilities automatically.', 'high', 'Enable "Scan on push" under the repository''s Image scanning settings, or enable enhanced scanning account-wide via Amazon Inspector.'),
  ('aws', 'aws.ecr.tag_immutability_enabled', 'ECR repositories enforce immutable image tags', 'Checks every ECR repository has imageTagMutability set to IMMUTABLE, preventing a tag (e.g. latest, prod) from being silently repointed to a different image.', 'medium', 'Set the repository''s tag mutability setting to Immutable under repository settings.'),
  ('aws', 'aws.ecr.no_wildcard_repository_policy', 'ECR repository policies do not grant a wildcard principal', 'Checks no ECR repository''s resource policy grants access to Principal "*".', 'critical', 'Scope the repository policy''s Principal to specific account IDs, roles, or organizations instead of "*".'),
  ('aws', 'aws.ecs.no_privileged_containers', 'ECS task definitions do not run privileged containers', 'Checks no container definition in an active ECS task definition revision sets privileged: true.', 'critical', 'Remove the privileged flag from the container definition and grant only the specific Linux capabilities the container needs via linuxParameters.capabilities.'),
  ('aws', 'aws.ecs.container_insights_enabled', 'ECS clusters have Container Insights enabled', 'Checks every ECS cluster has the containerInsights cluster setting enabled for monitoring and logging.', 'medium', 'Enable Container Insights under the cluster''s Monitoring settings, or via UpdateClusterSettings.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, framework, iso_reference) VALUES
  ('aws.config.rules_compliant', 'ISO27001', 'A.12.1.2'),
  ('aws.config.all_resource_types_recorded', 'ISO27001', 'A.12.1.1'),
  ('aws.cloudtrail.log_file_validation_enabled', 'ISO27001', 'A.12.4.2'),
  ('aws.cloudtrail.data_events_logged', 'ISO27001', 'A.12.4.1'),
  ('aws.cloudwatch.alarms_configured', 'ISO27001', 'A.12.4.1'),
  ('aws.cloudwatch.log_group_retention_configured', 'ISO27001', 'A.12.4.1'),
  ('aws.waf.web_acl_associated', 'ISO27001', 'A.13.1.1'),
  ('aws.waf.logging_enabled', 'ISO27001', 'A.12.4.1'),
  ('aws.secretsmanager.rotation_enabled', 'ISO27001', 'A.9.2.4'),
  ('aws.secretsmanager.encrypted_with_cmk', 'ISO27001', 'A.10.1.2'),
  ('aws.secretsmanager.no_stale_secrets', 'ISO27001', 'A.9.2.4'),
  ('aws.guardduty.enabled', 'ISO27001', 'A.12.6.1'),
  ('aws.guardduty.high_severity_findings_resolved', 'ISO27001', 'A.16.1.2'),
  ('aws.securityhub.enabled', 'ISO27001', 'A.12.6.1'),
  ('aws.securityhub.critical_findings_resolved', 'ISO27001', 'A.16.1.2'),
  ('aws.ecr.image_scanning_enabled', 'ISO27001', 'A.12.6.1'),
  ('aws.ecr.tag_immutability_enabled', 'ISO27001', 'A.12.5.1'),
  ('aws.ecr.no_wildcard_repository_policy', 'ISO27001', 'A.9.1.2'),
  ('aws.ecs.no_privileged_containers', 'ISO27001', 'A.9.4.4'),
  ('aws.ecs.container_insights_enabled', 'ISO27001', 'A.12.4.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;
```

Both blocks use the same `ON CONFLICT DO NOTHING` idiom as the existing seed data, so
re-running `init.sql` (or applying it to an already-seeded database) is safe.

## 6. Implementation Notes

Files to **add**:
- `api/src/connectors/aws/tests/config.js` — exports `configTests` (2 checks: rules
  compliance, recording scope). Imports from `@aws-sdk/client-config-service`.
- `api/src/connectors/aws/tests/cloudwatch.js` — exports `cloudwatchTests` (2 checks).
  Needs **both** a `@aws-sdk/client-cloudwatch` client (for `DescribeAlarmsCommand`) and a
  `@aws-sdk/client-cloudwatch-logs` client (for `DescribeLogGroupsCommand`) — these are two
  separate SDK packages/clients even though they're one console service area, so
  `buildClients()` needs two new entries (see below), and this test file's `run()` receives
  both.
- `api/src/connectors/aws/tests/waf.js` — exports `wafTests` (2 checks). Needs a
  `WAFV2Client` per scope (`REGIONAL` in the connection's configured region, `CLOUDFRONT`
  pinned to `us-east-1`) — construct the second client inline in this file or add a second
  entry to `buildClients()` (e.g. `wafRegional` / `wafCloudfront`); prefer building both in
  `buildClients()` for consistency with how every other client is constructed once and
  reused.
- `api/src/connectors/aws/tests/secretsmanager.js` — exports `secretsManagerTests` (3
  checks).
- `api/src/connectors/aws/tests/guardduty.js` — exports `guarddutyTests` (2 checks).
- `api/src/connectors/aws/tests/securityhub.js` — exports `securityHubTests` (2 checks).
- `api/src/connectors/aws/tests/ecr.js` — exports `ecrTests` (3 checks).
- `api/src/connectors/aws/tests/ecs.js` — exports `ecsTests` (2 checks).

Files to **edit**:
- `api/src/connectors/aws/tests/logging.js` — add the 2 CloudTrail-deepening checks
  (`checkCloudTrailLogFileValidation`, `checkCloudTrailDataEventsLogged`) alongside the
  existing `checkCloudTrailEnabled`/`checkConfigEnabled`, and append their check objects to
  the exported `loggingTests` array. No new client needed — reuses `clients.cloudtrail`.
- `api/src/connectors/aws/index.js`:
  - Add SDK imports: `CloudWatchClient` (`@aws-sdk/client-cloudwatch`),
    `CloudWatchLogsClient` (`@aws-sdk/client-cloudwatch-logs`), `WAFV2Client`
    (`@aws-sdk/client-wafv2`), `SecretsManagerClient` (`@aws-sdk/client-secrets-manager`),
    `GuardDutyClient` (`@aws-sdk/client-guardduty`), `SecurityHubClient`
    (`@aws-sdk/client-securityhub`), `ECRClient` (`@aws-sdk/client-ecr`), `ECSClient`
    (`@aws-sdk/client-ecs`).
  - Add imports for the 7 new test modules' exports (`configTests`, `cloudwatchTests`,
    `wafTests`, `secretsManagerTests`, `guarddutyTests`, `securityHubTests`, `ecrTests`,
    `ecsTests`) and append them all to the `tests` array.
  - Extend `buildClients()` to construct and return the 8 new clients (`configService` is
    already constructed — just start actually passing it into `configTests`; the other 7
    are new keys: `cloudwatch`, `cloudwatchLogs`, `wafRegional`, `wafCloudfront`,
    `secretsManager`, `guardduty`, `securityHub`, `ecr`, `ecs`). `wafCloudfront` is the one
    client in this connector constructed with a hardcoded `region: "us-east-1"` rather than
    `config.region` — call this out with a code comment since it's the one exception to the
    "one client, one region" pattern every other client in this file follows.
- `api/package.json` — add the 8 new `@aws-sdk/client-*` dependencies listed in §3.
- `init.sql` — append the two `INSERT` blocks from §5 immediately after the existing AWS
  `test_control_mappings` block (before the `-- azure` seed section begins).

No changes needed to: `credentials.js`, `testConnection()`, `runTests()`'s loop, the
`integrations` catalog row, any frontend file (the Integrations UI already renders whatever
`automated_tests`/`test_control_mappings` rows exist for a connector), or any DB migration
beyond the `init.sql` seed rows above (no schema/table changes — `automated_tests` and
`test_control_mappings` already have the columns these inserts use).
