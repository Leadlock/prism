import { ListFunctionsCommand, GetFunctionUrlConfigCommand, GetPolicyCommand } from "@aws-sdk/client-lambda";

async function listFunctions(lambda) {
  const { Functions } = await lambda.send(new ListFunctionsCommand({}));
  return Functions || [];
}

function hasWildcardPrincipal(statement) {
  if (statement.Effect !== "Allow") return false;
  const principal = statement.Principal;
  if (principal === "*") return true;
  if (principal && typeof principal === "object") {
    const values = [].concat(principal.AWS ?? []);
    return values.includes("*");
  }
  return false;
}

export async function checkLambdaFunctionUrlNotPublic(lambda) {
  const functions = await listFunctions(lambda);
  if (functions.length === 0) {
    return [{ resourceId: "account", status: "not_applicable", message: "No Lambda functions found", evidencePayload: {} }];
  }
  const results = [];
  for (const fn of functions) {
    let urlConfig;
    try {
      urlConfig = await lambda.send(new GetFunctionUrlConfigCommand({ FunctionName: fn.FunctionName }));
    } catch (err) {
      if (err.name === "ResourceNotFoundException") continue;
      throw err;
    }
    const pass = urlConfig.AuthType === "AWS_IAM";
    results.push({
      resourceId: fn.FunctionArn || fn.FunctionName,
      status: pass ? "pass" : "fail",
      message: pass
        ? `${fn.FunctionName}'s function URL requires AWS_IAM authentication`
        : `${fn.FunctionName}'s function URL allows unauthenticated (public) access`,
      evidencePayload: { functionName: fn.FunctionName, authType: urlConfig.AuthType },
    });
  }
  if (results.length === 0) {
    results.push({ resourceId: "account", status: "not_applicable", message: "No Lambda functions have a Function URL configured", evidencePayload: {} });
  }
  return results;
}

export async function checkLambdaNoWildcardResourcePolicy(lambda) {
  const functions = await listFunctions(lambda);
  if (functions.length === 0) {
    return [{ resourceId: "account", status: "not_applicable", message: "No Lambda functions found", evidencePayload: {} }];
  }
  const results = [];
  for (const fn of functions) {
    let policyDoc;
    try {
      const { Policy } = await lambda.send(new GetPolicyCommand({ FunctionName: fn.FunctionName }));
      policyDoc = JSON.parse(Policy);
    } catch (err) {
      if (err.name === "ResourceNotFoundException") {
        results.push({
          resourceId: fn.FunctionArn || fn.FunctionName,
          status: "pass",
          message: `${fn.FunctionName} has no resource-based policy attached`,
          evidencePayload: { functionName: fn.FunctionName },
        });
        continue;
      }
      throw err;
    }
    const wildcardStatements = (policyDoc.Statement || []).filter(hasWildcardPrincipal);
    const pass = wildcardStatements.length === 0;
    results.push({
      resourceId: fn.FunctionArn || fn.FunctionName,
      status: pass ? "pass" : "fail",
      message: pass
        ? `${fn.FunctionName}'s resource policy does not grant a wildcard principal`
        : `${fn.FunctionName}'s resource policy grants access to a wildcard principal ("*")`,
      evidencePayload: { functionName: fn.FunctionName, wildcardStatementCount: wildcardStatements.length },
    });
  }
  return results;
}

export const lambdaTests = [
  { key: "aws.lambda.function_url_not_public", title: "Lambda function URLs require authentication", severityDefault: "critical", isoReferences: ["A.13.1.1"], run: (clients) => checkLambdaFunctionUrlNotPublic(clients.lambda) },
  { key: "aws.lambda.no_wildcard_resource_policy", title: "Lambda resource policies do not grant a wildcard principal", severityDefault: "critical", isoReferences: ["A.9.1.2"], run: (clients) => checkLambdaNoWildcardResourcePolicy(clients.lambda) },
];
