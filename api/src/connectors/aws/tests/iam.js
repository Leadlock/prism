import {
  GetAccountPasswordPolicyCommand,
  ListUsersCommand,
  ListMFADevicesCommand,
  ListAccessKeysCommand,
} from "@aws-sdk/client-iam";

const MAX_ACCESS_KEY_AGE_DAYS = 90;

export async function checkMfaEnforced(iam) {
  const { Users } = await iam.send(new ListUsersCommand({}));
  const users = Users || [];
  const results = [];
  for (const user of users) {
    const { MFADevices } = await iam.send(new ListMFADevicesCommand({ UserName: user.UserName }));
    const hasMfa = (MFADevices || []).length > 0;
    results.push({
      resourceId: user.Arn,
      status: hasMfa ? "pass" : "fail",
      message: hasMfa
        ? `${user.UserName} has at least one MFA device registered`
        : `${user.UserName} has no MFA device registered`,
      evidencePayload: { userName: user.UserName, mfaDeviceCount: (MFADevices || []).length },
    });
  }
  if (results.length === 0) {
    results.push({ resourceId: "account", status: "not_applicable", message: "No IAM users found", evidencePayload: {} });
  }
  return results;
}

export async function checkPasswordPolicy(iam) {
  try {
    const { PasswordPolicy: policy } = await iam.send(new GetAccountPasswordPolicyCommand({}));
    const meetsBar =
      (policy.MinimumPasswordLength || 0) >= 14 &&
      policy.RequireSymbols &&
      policy.RequireNumbers &&
      policy.RequireUppercaseCharacters &&
      policy.RequireLowercaseCharacters;
    return [{
      resourceId: "account-password-policy",
      status: meetsBar ? "pass" : "fail",
      message: meetsBar
        ? "Account password policy meets minimum bar (14+ chars, mixed case, numbers, symbols)"
        : "Account password policy does not meet minimum bar",
      evidencePayload: policy,
    }];
  } catch (err) {
    if (err.name === "NoSuchEntityException") {
      return [{ resourceId: "account-password-policy", status: "fail", message: "No account password policy is configured", evidencePayload: {} }];
    }
    throw err;
  }
}

export async function checkAccessKeyAge(iam) {
  const { Users } = await iam.send(new ListUsersCommand({}));
  const users = Users || [];
  const results = [];
  for (const user of users) {
    const { AccessKeyMetadata } = await iam.send(new ListAccessKeysCommand({ UserName: user.UserName }));
    for (const key of AccessKeyMetadata || []) {
      if (key.Status !== "Active") continue;
      const ageDays = Math.floor((Date.now() - new Date(key.CreateDate).getTime()) / (1000 * 60 * 60 * 24));
      const pass = ageDays <= MAX_ACCESS_KEY_AGE_DAYS;
      results.push({
        resourceId: key.AccessKeyId,
        status: pass ? "pass" : "fail",
        message: pass
          ? `Access key ${key.AccessKeyId} is ${ageDays} days old (within ${MAX_ACCESS_KEY_AGE_DAYS}-day limit)`
          : `Access key ${key.AccessKeyId} is ${ageDays} days old, exceeding the ${MAX_ACCESS_KEY_AGE_DAYS}-day rotation limit`,
        evidencePayload: { userName: user.UserName, accessKeyId: key.AccessKeyId, ageDays },
      });
    }
  }
  if (results.length === 0) {
    results.push({ resourceId: "account", status: "not_applicable", message: "No active IAM access keys found", evidencePayload: {} });
  }
  return results;
}

export const iamTests = [
  { key: "aws.iam.mfa_enforced", title: "IAM users have MFA enabled", severityDefault: "critical", isoReferences: ["A.9.4.2"], run: (clients) => checkMfaEnforced(clients.iam) },
  { key: "aws.iam.password_policy", title: "Account password policy meets minimum strength", severityDefault: "high", isoReferences: ["A.9.4.3"], run: (clients) => checkPasswordPolicy(clients.iam) },
  { key: "aws.iam.access_key_age", title: "IAM access keys are rotated within 90 days", severityDefault: "high", isoReferences: ["A.9.2.4"], run: (clients) => checkAccessKeyAge(clients.iam) },
];
