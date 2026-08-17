import { DescribeTrailsCommand, GetTrailStatusCommand } from "@aws-sdk/client-cloudtrail";
import { DescribeConfigurationRecordersCommand, DescribeConfigurationRecorderStatusCommand } from "@aws-sdk/client-config-service";

export async function checkCloudTrailEnabled(cloudtrail) {
  const { trailList } = await cloudtrail.send(new DescribeTrailsCommand({}));
  const trails = trailList || [];
  if (trails.length === 0) {
    return [{ resourceId: "account", status: "fail", message: "No CloudTrail trails are configured", evidencePayload: {} }];
  }
  const results = [];
  for (const trail of trails) {
    const status = await cloudtrail.send(new GetTrailStatusCommand({ Name: trail.TrailARN }));
    const pass = Boolean(status.IsLogging) && Boolean(trail.IsMultiRegionTrail);
    results.push({
      resourceId: trail.TrailARN,
      status: pass ? "pass" : "fail",
      message: pass
        ? `${trail.Name} is logging and multi-region`
        : `${trail.Name} is ${status.IsLogging ? "logging" : "not logging"} and ${trail.IsMultiRegionTrail ? "multi-region" : "single-region"}`,
      evidencePayload: { name: trail.Name, isLogging: status.IsLogging, isMultiRegionTrail: trail.IsMultiRegionTrail },
    });
  }
  return results;
}

export async function checkConfigEnabled(configService) {
  const { ConfigurationRecorders } = await configService.send(new DescribeConfigurationRecordersCommand({}));
  const recorders = ConfigurationRecorders || [];
  if (recorders.length === 0) {
    return [{ resourceId: "account", status: "fail", message: "No AWS Config recorder is configured", evidencePayload: {} }];
  }
  const { ConfigurationRecordersStatus } = await configService.send(new DescribeConfigurationRecorderStatusCommand({}));
  const results = [];
  for (const recorder of recorders) {
    const recorderStatus = (ConfigurationRecordersStatus || []).find((s) => s.name === recorder.name);
    const pass = Boolean(recorderStatus?.recording);
    results.push({
      resourceId: recorder.name,
      status: pass ? "pass" : "fail",
      message: pass ? `${recorder.name} is actively recording` : `${recorder.name} is not recording`,
      evidencePayload: { name: recorder.name, recording: Boolean(recorderStatus?.recording) },
    });
  }
  return results;
}

export const loggingTests = [
  { key: "aws.logging.cloudtrail_enabled", title: "CloudTrail is enabled and multi-region", severityDefault: "critical", isoReferences: ["A.12.4.1"], run: (clients) => checkCloudTrailEnabled(clients.cloudtrail) },
  { key: "aws.logging.config_enabled", title: "AWS Config is recording", severityDefault: "medium", isoReferences: ["A.12.1.1"], run: (clients) => checkConfigEnabled(clients.configService) },
];
