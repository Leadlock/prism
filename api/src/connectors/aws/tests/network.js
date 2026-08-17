import { ListBucketsCommand, GetPublicAccessBlockCommand } from "@aws-sdk/client-s3";
import { DescribeSecurityGroupsCommand } from "@aws-sdk/client-ec2";

export async function checkS3PublicAccessBlocked(s3) {
  const { Buckets } = await s3.send(new ListBucketsCommand({}));
  const buckets = Buckets || [];
  if (buckets.length === 0) {
    return [{ resourceId: "account", status: "not_applicable", message: "No S3 buckets found", evidencePayload: {} }];
  }
  const results = [];
  for (const bucket of buckets) {
    try {
      const { PublicAccessBlockConfiguration: config } = await s3.send(new GetPublicAccessBlockCommand({ Bucket: bucket.Name }));
      const pass = Boolean(
        config?.BlockPublicAcls && config?.BlockPublicPolicy &&
        config?.IgnorePublicAcls && config?.RestrictPublicBuckets
      );
      results.push({
        resourceId: bucket.Name,
        status: pass ? "pass" : "fail",
        message: pass ? `${bucket.Name} blocks all public access` : `${bucket.Name} does not fully block public access`,
        evidencePayload: config || {},
      });
    } catch (err) {
      if (err.name === "NoSuchPublicAccessBlockConfiguration") {
        results.push({ resourceId: bucket.Name, status: "fail", message: `${bucket.Name} has no public access block configuration`, evidencePayload: {} });
      } else {
        throw err;
      }
    }
  }
  return results;
}

const SENSITIVE_PORTS = [22, 3389];

function ruleExposesSensitivePort(perm) {
  const hasOpenCidr = (perm.IpRanges || []).some((r) => r.CidrIp === "0.0.0.0/0");
  if (!hasOpenCidr) return false;
  const from = perm.FromPort ?? 0;
  const to = perm.ToPort ?? 65535;
  return SENSITIVE_PORTS.some((port) => port >= from && port <= to);
}

export async function checkSecurityGroupsNoOpenIngress(ec2) {
  const { SecurityGroups } = await ec2.send(new DescribeSecurityGroupsCommand({}));
  const groups = SecurityGroups || [];
  const results = [];
  for (const group of groups) {
    const openRules = (group.IpPermissions || []).filter(ruleExposesSensitivePort);
    const pass = openRules.length === 0;
    results.push({
      resourceId: group.GroupId,
      status: pass ? "pass" : "fail",
      message: pass
        ? `${group.GroupId} does not expose SSH/RDP to 0.0.0.0/0`
        : `${group.GroupId} allows inbound SSH or RDP from 0.0.0.0/0`,
      evidencePayload: { groupId: group.GroupId, groupName: group.GroupName, openRuleCount: openRules.length },
    });
  }
  if (results.length === 0) {
    results.push({ resourceId: "account", status: "not_applicable", message: "No security groups found", evidencePayload: {} });
  }
  return results;
}

export const networkTests = [
  { key: "aws.network.s3_public_access_blocked", title: "S3 buckets block public access", severityDefault: "critical", isoReferences: ["A.8.2.3"], run: (clients) => checkS3PublicAccessBlocked(clients.s3) },
  { key: "aws.network.security_groups_no_open_ingress", title: "Security groups do not expose management ports publicly", severityDefault: "critical", isoReferences: ["A.13.1.1"], run: (clients) => checkSecurityGroupsNoOpenIngress(clients.ec2) },
];
