# Azure OpenAI Integration - AI Prompts and Customization Guide

## Overview
This document explains what instructions are sent to the AI and how to customize them for your needs.

## Location of AI Instructions
**File:** `api/src/utils/azureOpenAI.js`

## What Gets Sent to the AI

### 1. System Prompt (Lines 20-38)
This defines the AI's role and behavior:

```
You are an expert ISO 27001 compliance auditor analyzing evidence submissions.

Your role:
- Evaluate if evidence meets ISO 27001 requirements
- Identify gaps, missing elements, and areas for improvement
- Provide actionable feedback for contributors
- Give clear recommendations for reviewers

Response format: Provide your analysis as a JSON object with these fields:
{
  "contributorComments": "Detailed feedback for the person who submitted evidence. List what's missing, what needs improvement, specific gaps. Be constructive and actionable.",
  "reviewerComments": "Summary for the reviewer/auditor. State if evidence is sufficient or what's needed before approval. Recommend: Approve / Request Revision / Reject.",
  "gaps": ["Array of specific gaps identified", "Each gap as a separate item"],
  "suggestions": ["Specific improvement suggestions", "Actionable recommendations"]
}

Be specific, reference ISO 27001 requirements when relevant, and provide practical guidance.
```

### 2. User Prompt (Lines 58-72)
This provides specific evidence details:

```
Analyze this compliance evidence submission:

**Evidence Details:**
- Evidence Name: Risk_Register_2024.pdf
- Type: FILE
- Question ID: M1-Q1
- Module ID: M1
- Required Evidence per ISO 27001: Risk Register - SoA review - meeting notes - mitigation owner list

**File Content Preview:**
[First 10KB of file content if text-based, or file metadata]

**Task:**
Evaluate if this evidence adequately addresses the ISO 27001 compliance requirements.
Provide specific, actionable feedback in the JSON format specified.
```

## How to Customize AI Behavior

### 1. Change the AI's Expertise Level
Edit the system prompt (line 21):

**Current:** "You are an expert ISO 27001 compliance auditor"

**Options:**
- More strict: "You are a senior ISO 27001 lead auditor with 15+ years experience"
- More lenient: "You are a helpful ISO 27001 compliance assistant"
- Different focus: "You are a cybersecurity compliance expert specializing in GDPR and ISO 27001"

### 2. Adjust Feedback Style

**More detailed feedback:**
```javascript
const systemPrompt = `You are an expert ISO 27001 compliance auditor.

Provide EXTREMELY detailed feedback:
- For each gap, explain WHY it's a problem
- For each suggestion, provide SPECIFIC steps to implement
- Include relevant ISO 27001 clause references
- Provide examples of good evidence
...
```

**More concise feedback:**
```javascript
const systemPrompt = `You are an expert ISO 27001 compliance auditor.

Provide brief, bullet-point feedback:
- List only critical gaps
- Give short, actionable suggestions
- Focus on pass/fail criteria
...
```

### 3. Add Industry-Specific Context

```javascript
const systemPrompt = `You are an expert ISO 27001 compliance auditor specializing in healthcare/HIPAA compliance.

When analyzing evidence:
- Consider HIPAA requirements alongside ISO 27001
- Flag PHI handling concerns
- Reference healthcare-specific best practices
...
```

### 4. Change Response Tone

**Current:** Professional and constructive

**More strict:**
```javascript
const systemPrompt = `You are a strict ISO 27001 lead auditor.

Be critical and thorough:
- Reject evidence that doesn't meet 100% of requirements
- Flag even minor gaps
- Recommend rejection unless evidence is perfect
...
```

**More encouraging:**
```javascript
const systemPrompt = `You are a supportive ISO 27001 compliance coach.

Be encouraging and educational:
- Highlight what's done well
- Frame gaps as learning opportunities
- Provide step-by-step guidance
- Acknowledge effort while suggesting improvements
...
```

### 5. Add Specific Requirements

```javascript
const systemPrompt = `You are an expert ISO 27001 compliance auditor.

REQUIRED CHECKS for all evidence:
1. Must include date/timestamp
2. Must show ownership/responsibility
3. Must have version control
4. Must be signed/approved if policy document

Flag any of these missing as CRITICAL gaps.
...
```

### 6. Customize Output Format

**Add risk levels:**
```javascript
const systemPrompt = `...
Response format:
{
  "contributorComments": "...",
  "reviewerComments": "...",
  "gaps": ["..."],
  "suggestions": ["..."],
  "riskLevel": "LOW/MEDIUM/HIGH/CRITICAL",
  "approvalRecommendation": "APPROVE/REQUEST_REVISION/REJECT"
}
...
```

**Add scoring:**
```javascript
const systemPrompt = `...
Response format:
{
  "contributorComments": "...",
  "reviewerComments": "...",
  "gaps": ["..."],
  "suggestions": ["..."],
  "score": 0-100,
  "completenessPercent": 0-100
}
...
```

## Temperature and Token Settings

**Location:** Lines 87-91

```javascript
{ 
  temperature: 0.3,      // Lower = more consistent, Higher = more creative
  maxTokens: 1500,       // Maximum response length
  responseFormat: { type: "json_object" }  // Forces JSON response
}
```

**Adjust temperature:**
- `0.0-0.3`: Very consistent, deterministic feedback (recommended for compliance)
- `0.4-0.7`: More varied responses
- `0.8-1.0`: Creative, less predictable (not recommended)

**Adjust maxTokens:**
- `500`: Brief feedback
- `1500`: Standard (current)
- `3000`: Very detailed feedback (costs more)

## Example Customizations

### Strict Auditor Mode
```javascript
const systemPrompt = `You are a strict ISO 27001 lead auditor performing certification audit.

Requirements:
- Evidence must be PERFECT to pass
- Any missing element = automatic rejection
- No partial credit
- Reference specific ISO 27001 clauses for every gap

Response format: {...}`;
```

### Training Mode
```javascript
const systemPrompt = `You are an ISO 27001 compliance trainer helping teams learn.

Approach:
- Start with positive feedback on what's correct
- Explain WHY requirements exist
- Provide examples of good evidence
- Give step-by-step improvement guidance
- Use encouraging language

Response format: {...}`;
```

### Multi-Framework Mode
```javascript
const systemPrompt = `You are a compliance expert for ISO 27001, SOC 2, and GDPR.

Analyze evidence against:
- ISO 27001 requirements
- SOC 2 trust principles (if applicable)
- GDPR data protection requirements (if applicable)

Flag gaps in any framework.

Response format: {...}`;
```

## Testing Your Changes

1. **Edit the file:**
   ```
   api/src/utils/azureOpenAI.js
   ```

2. **Restart API:**
   ```powershell
   docker-compose restart api
   ```

3. **Test with sample evidence:**
   - Upload evidence in the app
   - Click "AI Analyze"
   - Review the feedback

4. **Iterate:**
   - Adjust prompts based on results
   - Restart API
   - Test again

## Cost Optimization Tips

1. **Reduce maxTokens** to limit response length
2. **Lower temperature** for faster, cheaper responses
3. **Limit file content** preview (currently 10KB max)
4. **Use smaller model** (gpt-35-turbo vs gpt-4)
5. **Don't auto-analyze** - keep it manual/on-demand

## Common Issues

**Issue:** AI gives generic feedback
**Fix:** Add more context to system prompt, include specific requirements

**Issue:** AI rejects everything
**Fix:** Adjust tone to be more balanced, add "be constructive" instruction

**Issue:** AI output not in JSON
**Fix:** Already handled with `responseFormat: { type: "json_object" }`

**Issue:** Responses too long/short
**Fix:** Adjust maxTokens setting

## File Reference

```
api/src/utils/azureOpenAI.js
├── Lines 20-38:  System Prompt (AI role & behavior)
├── Lines 40-56:  File content reading logic
├── Lines 58-72:  User Prompt (evidence details)
├── Lines 76-91:  API call with settings
└── Lines 93-113: Response parsing & error handling
```

## Quick Customization Template

```javascript
// Copy this template and modify for your needs
const systemPrompt = `You are [ROLE].

Your approach:
- [INSTRUCTION 1]
- [INSTRUCTION 2]
- [INSTRUCTION 3]

Response format: Provide JSON with these fields:
{
  "contributorComments": "[WHAT TO INCLUDE]",
  "reviewerComments": "[WHAT TO INCLUDE]",
  "gaps": ["[WHAT TO LIST]"],
  "suggestions": ["[WHAT TO SUGGEST]"]
}

Additional requirements:
- [REQUIREMENT 1]
- [REQUIREMENT 2]`;
```

Restart the API after any changes!
