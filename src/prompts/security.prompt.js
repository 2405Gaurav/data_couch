/**
 * =============================================================================
 * FILE: src/prompts/security.prompt.js
 * =============================================================================
 *
 * PURPOSE:
 *   Constructs the prompt sent to Google Gemini for security analysis.
 *   This is the most critical file for output quality — the prompt
 *   determines whether Gemini returns structured, parseable JSON or
 *   rambling free-form text.
 *
 * HOW IT FITS INTO THE ARCHITECTURE:
 *   The gemini.service.js module calls buildSecurityPrompt(code) to get
 *   the complete prompt text before sending it to the Gemini API.
 *   Separating the prompt from the service allows:
 *   - Prompt engineers to iterate without touching service code
 *   - Different prompts for different analysis types (future extension)
 *   - Prompt versioning and A/B testing
 *
 * EXECUTION FLOW:
 *   1. gemini.service.js calls buildSecurityPrompt(userCodeSnippet)
 *   2. This function constructs the full prompt with system instructions + code
 *   3. The prompt string is returned and passed to Gemini's generateContent()
 *
 * KEY CONCEPTS:
 *
 *   **Prompt Engineering for Structured Output**: Getting an LLM to return
 *   valid JSON (not prose) requires very specific prompt design:
 *   - Explicit instruction: "Return ONLY valid JSON"
 *   - Schema definition: Show the exact JSON structure expected
 *   - Negative examples: "Do NOT include markdown, explanations, etc."
 *   - Fallback instruction: What to do if code is safe
 *
 *   **System + User Prompt Pattern**: We use a combined prompt that includes
 *   both the "system" instructions (who you are, what to do) and the
 *   "user" content (the code to analyze). The Gemini SDK supports
 *   separate system/user messages, but for simplicity and compatibility
 *   with various Gemini model versions, we combine them here.
 *
 *   **Safety Categories**: We enumerate the SPECIFIC vulnerability types
 *   we want detected. Without this, the model may:
 *   - Miss categories we care about (e.g., XSS)
 *   - Invent categories we don't want (e.g., "bad variable naming")
 *   - Give vague findings without categorization
 * =============================================================================
 */

/**
 * buildSecurityPrompt - Creates the complete prompt for Gemini security analysis.
 *
 * @param {string} code - The code snippet to be analyzed
 * @returns {string} The complete prompt to send to Gemini
 *
 * The prompt is carefully structured in sections:
 *
 * 1. ROLE DEFINITION: Tells Gemini what expert role to play
 * 2. TASK: Specifies exactly what analysis to perform
 * 3. CATEGORIES: Lists the specific vulnerability types to check
 * 4. OUTPUT FORMAT: Defines the exact JSON schema
 * 5. RULES: Critical constraints that prevent malformed output
 * 6. CODE: The actual code to analyze
 * 7. REMINDER: Final reinforcement of the JSON-only rule
 */
export function buildSecurityPrompt(code) {
  /*
   * PROMPT DESIGN PHILOSOPHY:
   *
   * This prompt uses several proven prompt engineering techniques:
   *
   * 1. **Role Assignment** ("You are a senior security engineer"):
   *    Framing the AI as an expert improves output quality because the
   *    model "activates" relevant domain knowledge.
   *
   * 2. **Enumerated Categories**:
   *    Rather than saying "find security issues" (too vague), we list
   *    exactly 8 vulnerability categories. This focuses the analysis
   *    and prevents the model from going off-topic.
   *
   * 3. **Exact Schema**:
   *    We provide the EXACT JSON structure we expect. Studies show
   *    that showing the schema directly in the prompt yields the
   *    highest format compliance rate.
   *
   * 4. **Negative Instructions** ("Do NOT include..."):
   *    LLMs tend to be "helpful" — they might add markdown formatting,
   *    explanatory text, or code blocks around the JSON. We explicitly
   *    forbid this to get clean, parseable output.
   *
   * 5. **Bookend Reinforcement**:
   *    We state the JSON requirement at the BEGINNING and END of the
   *    prompt. The "recency effect" means the last instruction has
   *    disproportionate influence on output.
   *
   * 6. **Empty Findings Handling**:
   *    We tell Gemini what to do when code is safe. Without this,
   *    the model might return an empty findings array without
   *    setting riskLevel properly, or might refuse to analyze
   *    "safe" code at all.
   */

  return `You are a senior application security engineer performing a code security review. Analyze the following code snippet for security vulnerabilities.

TASK: Review the code for the following vulnerability categories:
1. Hardcoded Secrets - API keys, passwords, tokens, credentials embedded in source code
2. SQL Injection - Unsanitized user input concatenated into SQL queries
3. Command Injection - User input passed to system/shell commands without sanitization
4. Insecure Authentication - Weak password handling, missing auth checks, insecure session management
5. Sensitive Data Exposure - Logging sensitive data, exposing internal information, missing encryption
6. Cross-Site Scripting (XSS) - Unsanitized output rendered in HTML contexts
7. Insecure API Usage - Unencrypted connections, missing input validation, open CORS policies
8. Dangerous Dependencies - Use of known-vulnerable packages or unsafe functions (eval, Function constructor, etc.)

OUTPUT FORMAT: Return ONLY a valid JSON object with exactly this structure. Do NOT include any other text, markdown, explanations, or code fences:

{
  "riskLevel": "LOW | MEDIUM | HIGH",
  "summary": "A one-sentence summary of the overall security posture",
  "findings": [
    {
      "issue": "Short name for the vulnerability",
      "severity": "LOW | MEDIUM | HIGH | CRITICAL",
      "description": "Detailed explanation of the vulnerability and how it manifests in this code",
      "recommendation": "Specific actionable fix for this finding"
    }
  ]
}

RULES:
- Return ONLY the JSON object, nothing else.
- Do NOT wrap the JSON in markdown code fences or backticks.
- Do NOT add any explanatory text before or after the JSON.
- If the code appears safe, return riskLevel "LOW", an appropriate summary, and an empty findings array.
- Each finding must have all four fields: issue, severity, description, recommendation.
- The severity field in each finding must be one of: LOW, MEDIUM, HIGH, CRITICAL.
- The riskLevel field must be one of: LOW, MEDIUM, HIGH.
- Be specific in your descriptions — reference the actual problematic code.
- Be actionable in your recommendations — provide concrete code fixes.

CODE TO ANALYZE:
\`\`\`
${code}
\`\`\`

Remember: Return ONLY the JSON object. No markdown. No explanation. No code fences. Just the JSON.`;
}
