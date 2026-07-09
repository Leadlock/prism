import fetch from "node-fetch";
import fs from "fs";

// ─── OAuth2 Token Cache ───────────────────────────────────────────────────────

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry - 300000) {
    return cachedToken;
  }

  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Azure OAuth2 credentials not configured. Set AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET in .env");
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://ai.azure.com/.default"
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to acquire Azure token: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in * 1000);

  console.log("[AI] Acquired new Azure access token");
  return cachedToken;
}

// ─── Azure AI Agent helper (threads/messages/runs pattern) ────────────────────

async function agentRequest(path, method = "GET", body = null) {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const token = await getAccessToken();
  const url = `${endpoint}${path}?api-version=v1`;

  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Azure Agent API ${method} ${path} returned ${response.status}: ${errorText}`);
  }

  return response.json();
}

async function pollRunUntilComplete(threadId, runId, maxWaitMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const run = await agentRequest(`/threads/${threadId}/runs/${runId}`);
    const status = run.status;

    if (status === "completed") return run;
    if (["failed", "cancelled", "expired"].includes(status)) {
      throw new Error(`Run ended with status: ${status}. ${run.last_error?.message || ""}`);
    }

    // Wait before polling again
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  throw new Error("Agent run timed out after 60 seconds");
}

// ─── Evidence Analysis ────────────────────────────────────────────────────────

export async function analyzeEvidence({ evidenceName, evidenceType, questId, moduleId, requiredEvidence, filePath }) {
  console.log(`[AI] Analyzing evidence: ${evidenceName}`);
  console.log(`[AI] File path: ${filePath}`);
  console.log(`[AI] Evidence type: ${evidenceType}`);

  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const agentId = process.env.AZURE_AGENT_ID;

  if (!endpoint) {
    throw new Error("AZURE_OPENAI_ENDPOINT not configured in .env");
  }
  if (!agentId) {
    throw new Error("AZURE_AGENT_ID not configured in .env");
  }

  // Read file content if it's a text-based file
  let evidenceContent = "No file content available";

  if (evidenceType === "FILE" && filePath) {
    try {
      console.log(`[AI] Attempting to read file: ${filePath}`);

      if (!fs.existsSync(filePath)) {
        console.error(`[AI] File does not exist: ${filePath}`);
        evidenceContent = `FILE NOT FOUND: ${filePath}`;
      } else {
        const fileExt = filePath.split(".").pop().toLowerCase();
        console.log(`[AI] File extension: ${fileExt}`);

        if (["txt", "csv", "log", "json", "md", "html", "xml"].includes(fileExt)) {
          const content = fs.readFileSync(filePath, "utf8");
          evidenceContent = content.substring(0, 10000);
          console.log(`[AI] Read ${evidenceContent.length} characters from file`);
        } else if (["pdf", "docx", "xlsx"].includes(fileExt)) {
          evidenceContent = `Binary file uploaded: ${fileExt.toUpperCase()} - ${evidenceName}\n\nNote: This is a ${fileExt.toUpperCase()} file. The AI is analyzing based on filename and metadata only.`;
        } else {
          evidenceContent = `File type: ${fileExt.toUpperCase()} - ${evidenceName}\n\nUnsupported format for content reading. Analyzing based on filename and metadata.`;
        }
      }
    } catch (err) {
      console.error(`[AI] Error reading file:`, err);
      evidenceContent = `Unable to read file content: ${err.message}`;
    }
  } else if (evidenceType === "LINK") {
    evidenceContent = `Evidence provided as external link: ${evidenceName || evidenceType}`;
  }

  console.log(`[AI] Evidence content preview: ${evidenceContent.substring(0, 200)}...`);

  const userPrompt = `Analyze this compliance evidence submission:

**Evidence Details:**
- Evidence Name: ${evidenceName || "N/A"}
- Type: ${evidenceType}
- Question ID: ${questId || "N/A"}
- Module ID: ${moduleId || "N/A"}
- Required Evidence per ISO 27001: ${requiredEvidence || "Not specified"}

**File Content Preview:**
${evidenceContent}

**Task:**
Evaluate if this evidence adequately addresses the ISO 27001 compliance requirements.
Provide your analysis as JSON with: contributorComments, reviewerComments, gaps array, suggestions array.`;

  console.log(`[AI] Sending request to Azure AI Agent (threads/runs pattern)...`);
  console.log(`[AI] Using agent: ${agentId}`);
  console.log(`[AI] Endpoint: ${endpoint}`);

  try {
    // Step 1: Create a thread
    const thread = await agentRequest("/threads", "POST", {});
    const threadId = thread.id;
    console.log(`[AI] Created thread: ${threadId}`);

    // Step 2: Add message to thread
    await agentRequest(`/threads/${threadId}/messages`, "POST", {
      role: "user",
      content: userPrompt
    });
    console.log(`[AI] Added message to thread`);

    // Step 3: Create a run with the agent
    const run = await agentRequest(`/threads/${threadId}/runs`, "POST", {
      assistant_id: agentId
    });
    console.log(`[AI] Created run: ${run.id}, status: ${run.status}`);

    // Step 4: Poll until complete
    await pollRunUntilComplete(threadId, run.id);
    console.log(`[AI] Run completed`);

    // Step 5: Get messages from thread
    const messagesResult = await agentRequest(`/threads/${threadId}/messages`);
    const assistantMessages = (messagesResult.data || []).filter(m => m.role === "assistant");
    
    if (assistantMessages.length === 0) {
      throw new Error("No response from agent");
    }

    // Get the latest assistant message content
    const latestMsg = assistantMessages[0];
    let resultText = "";
    if (Array.isArray(latestMsg.content)) {
      const textPart = latestMsg.content.find(c => c.type === "text");
      resultText = textPart?.text?.value || textPart?.text || JSON.stringify(latestMsg.content);
    } else {
      resultText = String(latestMsg.content);
    }

    console.log(`[AI] Response content: ${resultText.substring(0, 200)}...`);

    // Step 6: Clean up thread
    try {
      await agentRequest(`/threads/${threadId}`, "DELETE");
    } catch (e) {
      // Non-critical, just log
      console.warn(`[AI] Failed to delete thread: ${e.message}`);
    }

    // Parse the response
    try {
      const jsonMatch = resultText.match(/```json\s*([\s\S]*?)\s*```/) || resultText.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : resultText;
      const parsed = JSON.parse(jsonStr);
      console.log(`[AI] Successfully parsed JSON response`);
      return {
        contributorComments: parsed.contributorComments || "No contributor feedback generated",
        reviewerComments: parsed.reviewerComments || "No reviewer feedback generated",
        gaps: Array.isArray(parsed.gaps) ? parsed.gaps : [],
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : []
      };
    } catch (parseError) {
      console.error(`[AI] JSON parse error:`, parseError.message);
      return {
        contributorComments: resultText,
        reviewerComments: "AI provided unstructured feedback. See contributor comments.",
        gaps: [],
        suggestions: []
      };
    }
  } catch (error) {
    console.error(`[AI] Azure AI Agent Error:`, error.message);
    throw new Error(`AI analysis failed: ${error.message}`);
  }
}
