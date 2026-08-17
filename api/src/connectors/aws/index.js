import { IAMClient } from "@aws-sdk/client-iam";
import { CloudTrailClient } from "@aws-sdk/client-cloudtrail";
import { ConfigServiceClient } from "@aws-sdk/client-config-service";
import { S3Client } from "@aws-sdk/client-s3";
import { EC2Client } from "@aws-sdk/client-ec2";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { resolveAwsCredentials } from "./credentials.js";
import { iamTests } from "./tests/iam.js";
import { loggingTests } from "./tests/logging.js";
import { networkTests } from "./tests/network.js";

export const key = "aws";

export const tests = [...iamTests, ...loggingTests, ...networkTests];

function buildClients(credentials, region) {
  return {
    iam: new IAMClient({ credentials, region }),
    cloudtrail: new CloudTrailClient({ credentials, region }),
    configService: new ConfigServiceClient({ credentials, region }),
    s3: new S3Client({ credentials, region }),
    ec2: new EC2Client({ credentials, region }),
  };
}

export async function testConnection({ authType, config, secret }) {
  const credentials = await resolveAwsCredentials({ authType, config, secret });
  const sts = new STSClient({ credentials, region: config.region || "us-east-1" });
  const identity = await sts.send(new GetCallerIdentityCommand({}));
  return { ok: true, externalAccountId: identity.Account };
}

export async function runTests({ authType, config, secret }) {
  const credentials = await resolveAwsCredentials({ authType, config, secret });
  const clients = buildClients(credentials, config.region || "us-east-1");
  const runResults = [];
  for (const test of tests) {
    const results = await test.run(clients);
    for (const result of results) {
      runResults.push({ testKey: test.key, severity: test.severityDefault, ...result });
    }
  }
  return runResults;
}
