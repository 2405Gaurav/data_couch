/**
 * =============================================================================
 * FILE: src/services/gemini.service.js
 * =============================================================================
 *
 * PURPOSE:
 *   Encapsulates ALL communication with the Google Gemini AI API.
 *   This service is the ONLY place in the application that calls Gemini.
 *   If Gemini's API changes, if we switch models, or if we add caching,
 *   only this file needs to be updated.
 *
 * HOW IT FITS INTO THE ARCHITECTURE:
 *   This service is called exclusively by the Inngest workflow
 *   (analyze-code.workflow.js). The workflow says "analyze this code,"
 *   and this service handles the entire Gemini interaction:
 *   - Building the prompt (via security.prompt.js)
 *   - Calling the Gemini API
 *   - Parsing the JSON response
 *   - Handling errors and timeouts
 *   - Returning a clean, validated result object
 *
 *   The controller and routes NEVER touch this service directly —
 *   they only emit Inngest events. The workflow orchestrates the call.
 *
 * EXECUTION FLOW:
 *   1. Workflow calls analyzeCodeSecurity(codeSnippet)
 *   2. This function builds the prompt using the prompt module
 *   3. It calls Gemini's generateContent() with a timeout
 *   4. It extracts the text response
 *  5. It parses the JSON from Gemini's text
 * 6. It validates the parsed JSON has the expected structure
 *   7. It returns the validated result or throws an appropriate error
 *
 * KEY CONCEPTS:
 *
 *   **Service Layer Pattern**: Business logic lives in services, not
 *   controllers. Controllers handle HTTP concerns; services handle
 *   domain concerns (like talking to AI APIs).
 *
 *   **Timeout Protection**: AI API calls can hang or take very long.
 *   We wrap the call in a timeout to prevent the workflow from
 *   blocking indefinitely. If Gemini doesn't respond in 30 seconds,
 *   we fail with a clear error.
 *
 *   **JSON Parsing Safeguard**: LLMs sometimes return malformed JSON
 *   (extra text, markdown fences, truncated output). We handle ALL
 *   of these cases: extract JSON from markdown, fix common issues,
 *   and validate the result structure.
 *
 *   **Retry Delegation**: This service does NOT implement retries.
 *   Retry logic belongs to Inngest (the workflow layer). If this
 *   service throws, Inngest will retry according to its configuration.
 *   This separation of concerns means we don't duplicate retry logic.
 * =============================================================================
 */

import { getGeminiModel } from "../config/gemini.js";
import { buildSecurityPrompt } from "../prompts/security.prompt.js";
import { logger } from "../utils/logger.js";

/**
 * GEMINI_TIMEOUT_MS - Maximum time to wait for a Gemini API response.
 *
 * 30 seconds is a reasonable timeout for code analysis:
 * - Most responses come back in 5-15 seconds
 * - 30 seconds allows for cold starts and complex code
 * - Anything beyond 30 seconds likely indicates a network issue
 *
 * If this timeout fires, the promise rejects and Inngest handles the retry.
 */
const GEMINI_TIMEOUT_MS = 30_000;

/**
 * analyzeCodeSecurity - Sends code to Gemini for security analysis.
 *
 * This is the primary function of the service. It:
 *   1. Gets the initialized Gemini model
 *   2. Builds the security analysis prompt
 *   3. Calls the Gemini API with a timeout
 *   4. Parses and validates the response
 *   5. Returns the structured security report
 *
 * @param {string} codeSnippet - The source code to analyze
 * @returns {Promise<object>} The parsed and validated security report
 * @throws {Error} If Gemini call fails, times out, or returns invalid JSON
 *
 * Example return value:
 *   {
 *     riskLevel: "HIGH",
 *     summary: "Code contains hardcoded credentials and insecure authentication",
 *     findings: [
 *       {
 *         issue: "Hardcoded Password",
 *         severity: "CRITICAL",
 *         description: "A password is hardcoded directly in source code...",
 *         recommendation: "Use environment variables or a secrets manager..."
 *       }
 *     ]
 *   }
 */
export async function analyzeCodeSecurity(codeSnippet) {
  logger.info("Starting Gemini security analysis", {
    codeLength: codeSnippet.length,
  });

  /*
   * STEP 1: Get the Gemini model instance.
   *
   * getGeminiModel() will throw if the model hasn't been initialized.
   * This is a programmer error (forgot to call initializeGemini at startup),
   * not a runtime error, so we let it propagate.
   */
  const model = getGeminiModel();

  /*
   * STEP 2: Build the prompt.
   *
   * We delegate prompt construction to the dedicated prompt module.
   * This keeps the prompt logic separate from the API call logic.
   */
  const prompt = buildSecurityPrompt(codeSnippet);

  /*
   * STEP 3: Call Gemini API with timeout protection.
   *
   * We use Promise.race() to race between the actual API call and a
   * timeout promise. Whichever settles first wins:
   * - If Gemini responds within 30s → we get the result
   * - If Gemini doesn't respond → the timeout rejects with an error
   *
   * WHY TIMEOUT? In a serverless environment, a hanging API call can
   * consume execution time until the platform kills the function.
   * By managing our own timeout, we fail gracefully and let the
   * workflow system (Inngest) retry later.
   */
  let result;
  try {
    result = await Promise.race([
      /*
       * The actual Gemini API call.
       * generateContent() sends the prompt to Gemini and returns
       * a GenerateContentResult object containing the model's response.
       */
      model.generateContent(prompt),

      /*
       * Timeout promise that rejects after GEMINI_TIMEOUT_MS.
       * We create a new Error with a descriptive message so that
       * when it's caught, the error logs clearly show it was a timeout.
       */
      new Promise((_, reject) =>
        setTimeout(() => {
          reject(new Error(`Gemini API call timed out after ${GEMINI_TIMEOUT_MS}ms`));
        }, GEMINI_TIMEOUT_MS)
      ),
    ]);
  } catch (apiError) {
    /*
     * Log the failure with context for debugging.
     * We include the error name and message but not the full stack
     * to keep logs readable. The stack is available in the error
     * object if Inngest needs it for retry decisions.
     */
    logger.error("Gemini API call failed", {
      errorName: apiError.name,
      errorMessage: apiError.message,
    });

    /*
     * Re-throw the error so Inngest can handle the retry.
     * We do NOT return a fallback value here — that would mask
     * the failure. The workflow's retry configuration will
     * determine whether to try again.
     */
    throw apiError;
  }

  /*
   * STEP 4: Extract the text response from Gemini's result object.
   *
   * Gemini's response structure is:
   *   result.response.text() → the generated text (our JSON string)
   *
   * The response object also contains other metadata (safety ratings,
   * finish reason, etc.) but we only need the text.
   */
  let responseText;
  try {
    responseText = result.response.text();
    logger.info("Gemini response received", {
      responseLength: responseText.length,
    });
  } catch (extractionError) {
    logger.error("Failed to extract text from Gemini response", {
      errorMessage: extractionError.message,
    });
    throw new Error("Gemini returned an empty or malformed response");
  }

  /*
   * STEP 5: Parse the JSON from Gemini's response.
   *
   * This is the trickiest part. Even with careful prompt engineering,
   * LLMs sometimes return:
   *   - JSON wrapped in markdown code fences: ```json { ... } ```
   *   - JSON with leading/trailing text
   *   - Malformed JSON (missing commas, extra commas, etc.)
   *   - Completely non-JSON text
   *
   * We handle these cases with increasing levels of fallback.
   */
  const parsedReport = parseGeminiJsonResponse(responseText);

  /*
   * STEP 6: Validate the parsed report structure.
   *
   * Even if JSON parsing succeeded, the structure might not match
   * what we expect. We validate the top-level fields and the
   * structure of each finding.
   */
  const validatedReport = validateReportStructure(parsedReport);

  logger.info("Security analysis complete", {
    riskLevel: validatedReport.riskLevel,
    findingCount: validatedReport.findings.length,
  });

  return validatedReport;
}

/**
 * parseGeminiJsonResponse - Safely parses JSON from Gemini's text response.
 *
 * This function handles the common LLM response issues:
 *   1. Response wrapped in markdown code fences
 *   2. Response with leading/trailing non-JSON text
 *   3. Malformed JSON (within reason)
 *
 * @param {string} responseText - Raw text from Gemini
 * @returns {object} Parsed JSON object
 * @throws {Error} If the response cannot be parsed as valid JSON
 */
function parseGeminiJsonResponse(responseText) {
  /*
   * CLEANUP STEP 1: Remove markdown code fences.
   *
   * Despite our prompt saying "Do NOT include code fences," LLMs
   * sometimes still add them. This regex handles:
   *   ```json\n{...}\n```
   *   ```\n{...}\n```
   *
   * Regex explanation:
   *   /^```(?:json)?\s*\n?/  — Remove opening fence (with or without "json")
   *   /\n?```\s*$/           — Remove closing fence
   *   The 'm' flag makes ^ and $ match line boundaries
   */
  let cleanedText = responseText
    .replace(/^```(?:json)?\s*\n?/m, "")
    .replace(/\n?```\s*$/m, "")
    .trim();

  /*
   * CLEANUP STEP 2: Try direct JSON.parse first.
   *
   * If the response is clean JSON (which is the common case when
   * prompt engineering is good), this will succeed.
   */
  try {
    return JSON.parse(cleanedText);
  } catch (directParseError) {
    logger.warn("Direct JSON parse failed, attempting extraction", {
      error: directParseError.message,
    });
  }

  /*
   * CLEANUP STEP 3: Extract JSON from surrounding text.
   *
   * If the model added explanatory text before/after the JSON:
   *   "Here is the analysis:\n{...}\nHope this helps!"
   *
   * We find the outermost { } braces and try to parse that substring.
   */
  const jsonStart = cleanedText.indexOf("{");
  const jsonEnd = cleanedText.lastIndexOf("}");

  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    const extractedJson = cleanedText.substring(jsonStart, jsonEnd + 1);

    try {
      const parsed = JSON.parse(extractedJson);
      logger.info("Successfully extracted JSON from response text");
      return parsed;
    } catch (extractionParseError) {
      logger.warn("Extracted JSON is still invalid", {
        error: extractionParseError.message,
      });
    }
  }

  /*
   * If all parsing attempts fail, we throw a descriptive error.
   * We include a snippet of the raw response to help with debugging.
   */
  const preview = responseText.substring(0, 200);
  throw new Error(
    `Failed to parse Gemini response as JSON. Response preview: "${preview}"`
  );
}

/**
 * validateReportStructure - Ensures the parsed report has the expected shape.
 *
 * Even valid JSON might not have the exact fields we expect. This function
 * provides default values for missing fields and validates data types.
 *
 * @param {object} report - The parsed JSON report from Gemini
 * @returns {object} A validated report with guaranteed structure
 */
function validateReportStructure(report) {
  /*
   * We use a "default + override" pattern:
   *   1. Start with a default structure (safe fallback)
   *   2. Override with whatever Gemini provided
   *   3. Validate specific fields
   *
   * This ensures we ALWAYS return a valid structure, even if
   * Gemini omits fields or returns unexpected types.
   */
  const defaults = {
    riskLevel: "LOW",
    summary: "Analysis completed with unexpected response format.",
    findings: [],
  };

  /*
   * Merge: defaults first, then Gemini's values override them.
   * This means missing fields fall back to defaults, but provided
   * fields use Gemini's values.
   */
  const merged = { ...defaults, ...report };

  /*
   * VALIDATE riskLevel — must be one of our allowed values.
   * If Gemini returned something weird like "EXTREME" or a number,
   * we default to "LOW" to avoid downstream errors.
   */
  const validRiskLevels = ["LOW", "MEDIUM", "HIGH"];
  if (!validRiskLevels.includes(merged.riskLevel)) {
    logger.warn("Invalid riskLevel from Gemini, defaulting to LOW", {
      received: merged.riskLevel,
    });
    merged.riskLevel = "LOW";
  }

  /*
   * VALIDATE findings — must be an array.
   * If Gemini returned findings as a string or object, we default
   * to an empty array rather than crashing when we try to .length it.
   */
  if (!Array.isArray(merged.findings)) {
    logger.warn("findings is not an array, defaulting to empty array", {
      receivedType: typeof merged.findings,
    });
    merged.findings = [];
  }

  /*
   * VALIDATE each finding — ensure it has the required fields.
   * We don't reject incomplete findings; instead, we fill in
   * placeholder values so the report is still usable.
   */
  merged.findings = merged.findings.map((finding, index) => ({
    issue: finding.issue || `Unknown Issue ${index + 1}`,
    severity: validateFindingSeverity(finding.severity),
    description: finding.description || "No description provided.",
    recommendation: finding.recommendation || "No recommendation provided.",
  }));

  return merged;
}

/**
 * validateFindingSeverity - Ensures a finding's severity is a valid value.
 *
 * @param {string} severity - The severity value to validate
 * @returns {string} A valid severity string
 */
function validateFindingSeverity(severity) {
  const validSeverities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

  /*
   * If severity is a string, normalize to uppercase for comparison.
   * Gemini might return "high" instead of "HIGH".
   */
  if (typeof severity === "string") {
    const normalized = severity.toUpperCase();
    if (validSeverities.includes(normalized)) {
      return normalized;
    }
  }

  /*
   * Default to MEDIUM if severity is invalid.
   * MEDIUM is the safest default — it's neither alarmist (HIGH)
   * nor dismissive (LOW) for unknown severities.
   */
  logger.warn("Invalid finding severity, defaulting to MEDIUM", {
    received: severity,
  });
  return "MEDIUM";
}
