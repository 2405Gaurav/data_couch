/**
 * =============================================================================
 * FILE: src/workflows/analyze-code.workflow.js
 * =============================================================================
 *
 * PURPOSE:
 *   Defines the Inngest workflow (function) that handles code security
 *   analysis in the background. When a user submits code, the API endpoint
 *   emits an Inngest event and responds immediately. THIS workflow
 *   catches that event and performs the actual analysis — calling Gemini,
 *   processing the results, and logging the findings.
 *
 * HOW IT FITS INTO THE ARCHITECTURE:
 *   This is the CORE of our asynchronous architecture. Without Inngest,
 *   the Express handler would have to call Gemini synchronously, keeping
 *   the HTTP connection open for 5-30 seconds. With Inngest:
 *
 *   WITHOUT Inngest (synchronous — problems!):
 *     Request → Express → [Wait 15s for Gemini] → Response
 *                             ↑
 *                     Serverless timeout risk!
 *                     User sees loading spinner.
 *
 *   WITH Inngest (asynchronous — correct!):
 *     Request → Express → Emit event → Immediate Response (200 OK)
 *                              ↓
 *                     Inngest triggers this workflow
 *                              ↓
 *                     Workflow calls Gemini (15s)
 *                              ↓
 *                     Log/process results
 *
 * EXECUTION FLOW:
 *   1. Inngest receives the "code/analyze" event (emitted by the controller)
 *   2. Inngest calls this workflow function
 *   3. The workflow extracts the code snippet from event data
 *   4. It calls gemini.service.js to perform the AI analysis
 *   5. It logs the security findings
 *   6. If Gemini fails, Inngest retries automatically (up to 3 times)
 *
 * KEY CONCEPTS:
 *
 *   **Durable Execution**: Inngest guarantees this workflow will run to
 *   completion. If the server crashes mid-execution, Inngest resumes
 *   from the last completed step when the server restarts. This is
 *   crucial for AI workflows that may take long or fail temporarily.
 *
 *   **Automatic Retries**: If our Gemini call fails (network error,
 *   rate limit, timeout), Inngest automatically retries with
 *   exponential backoff. We don't need to write retry loops —
 *   Inngest handles it declaratively.
 *
 *   **Step Functions**: Each `step.run()` call is a checkpoint.
 *   Inngest saves the result after each step. If we crash and restart,
 *   we SKIP already-completed steps and continue from where we left off.
 *   This is what makes execution "durable."
 *
 *   **Event-Data Coupling**: The event carries the data the workflow
 *   needs. The controller includes `code` in the event payload.
 *   The workflow reads it from `event.data.code`.
 * =============================================================================
 */

import { inngest } from "../config/inngest.js";
import { analyzeCodeSecurity } from "../services/gemini.service.js";
import { logger } from "../utils/logger.js";

/**
 * analyzeCodeWorkflow - The Inngest function that handles code analysis.
 *
 * This function is registered with Inngest. When Inngest receives an event
 * matching "code/analyze", it calls this function.
 *
 * CONFIGURATION:
 *   - id: "analyze-code" — unique identifier for this workflow in Inngest dashboard
 *   - event: "code/analyze" — the event name that triggers this workflow
 *   - retries: 3 — if the function fails, Inngest will retry up to 3 times
 *
 * RETRY BEHAVIOR:
 *   After a failure, Inngest waits with exponential backoff:
 *     Retry 1: ~1 second wait
 *     Retry 2: ~2 seconds wait
 *     Retry 3: ~4 seconds wait
 *
 *   This backoff prevents hammering a temporarily-unavailable API.
 *   The backoff is automatic — no configuration needed.
 *
 * WHY 3 RETRIES?
 *   Gemini API failures are usually transient (rate limits, network blips).
 *   3 retries covers the vast majority of temporary failures without
 *   creating excessive delays. If 3 retries fail, the error is logged
 *   and the workflow is marked as failed in the Inngest dashboard.
 */
export const analyzeCodeWorkflow = inngest.createFunction(
  /*
   * FUNCTION CONFIGURATION
   *
   * This object defines the workflow's metadata and retry behavior.
   * - id: Used in the Inngest Dev Server UI and for deduplication
   * - retries: Maximum number of automatic retries on failure
   */
  {
    id: "analyze-code",
    retries: 3,
  },

  /*
   * EVENT TRIGGER
   *
   * This string must exactly match the event name used in
   * `inngest.send()` in our controller. If they don't match,
   * the workflow will never be triggered.
   *
   * Naming convention: "domain/action" — we use "code/analyze"
   * because this is about code analysis in the "code" domain.
   */
  "code/analyze",

  /**
   * WORKFLOW HANDLER — The function that runs when the event is received.
   *
   * @param {object} event - The Inngest event object, containing:
   *   - event.data: The payload sent with the event (our code snippet)
   *   - event.id: Unique event identifier
   *   - event.name: The event name ("code/analyze")
   *
   * @param {object} step - The Inngest step utility for durable execution.
   *   Each `step.run()` call creates a checkpoint. If the function crashes
   *   and restarts, completed steps are skipped.
   *
   *   IMPORTANT: Code OUTSIDE of step.run() is NOT durable. It runs fresh
   *   on every function invocation. Only code INSIDE step.run() has
   *   its result memoized (saved and reused after crashes).
   *
   * @returns {object} The final result of the workflow
   */
  async ({ event, step }) => {
    logger.info("Workflow triggered: analyze-code", {
      eventId: event.id,
    });

    /*
     * STEP 1: Extract and validate the code snippet from the event.
     *
     * We wrap this in step.run() so it becomes a durable checkpoint.
     * The step has:
     *   - name: "extract-code" — appears in Inngest dashboard for debugging
     *   - handler: The function that performs the work
     *
     * After this step completes, even if the server crashes and restarts,
     * this step's result is remembered and NOT re-executed.
     */
    const codeSnippet = await step.run("extract-code", async () => {
      const { code } = event.data;

      /*
       * Defensive check: Even though our Express validator already
       * validated the code before emitting the event, we check again
       * here. This is a "defense in depth" practice — don't trust
       * that upstream validation is always correct, especially when
       * events could come from other sources in the future.
       */
      if (!code || typeof code !== "string" || code.trim().length === 0) {
        throw new Error("Invalid code snippet received in workflow event");
      }

      logger.info("Code snippet extracted from event", {
        codeLength: code.length,
      });

      return code;
    });

    /*
     * STEP 2: Call Gemini for security analysis.
     *
     * This is the expensive step — it calls the external AI API.
     * By wrapping it in step.run(), we get:
     *   1. Durable execution: if the server crashes during the Gemini
     *      call, Inngest can retry this specific step
     *   2. Observability: the step appears in the Inngest dashboard
     *      with its duration and result
     *   3. Retries: if this step throws, Inngest retries the whole
     *      function (up to our configured 3 retries)
     */
    const report = await step.run("analyze-with-gemini", async () => {
      logger.info("Calling Gemini for security analysis", {
        codeSnippetLength: codeSnippet.length,
      });

      /*
       * Delegate to our Gemini service.
       * The service handles prompt building, API calling,
       * JSON parsing, and response validation.
       * If it throws, Inngest catches it and retries.
       */
      const result = await analyzeCodeSecurity(codeSnippet);

      logger.info("Gemini analysis completed successfully", {
        riskLevel: result.riskLevel,
        findingCount: result.findings.length,
      });

      return result;
    });

    /*
     * STEP 3: Process and log the results.
     *
     * In a production application, this step might:
     *   - Save results to a database
     *   - Send a notification (email, Slack, webhook)
     *   - Emit another Inngest event for downstream processing
     *
     * For this training lab, we log the results as structured JSON
     * so they're visible in the server logs and Inngest dashboard.
     */
    await step.run("log-findings", async () => {
      logger.info("Security analysis results", {
        riskLevel: report.riskLevel,
        summary: report.summary,
        totalFindings: report.findings.length,

        /*
         * For each finding, log a summary.
         * We don't log the full description/recommendation to keep
         * logs readable — those are in the report object if needed.
         */
        findings: report.findings.map((f) => ({
          issue: f.issue,
          severity: f.severity,
        })),
      });

      return { logged: true };
    });

    /*
     * RETURN the final report.
     *
     * This return value is stored by Inngest and visible in the
     * Inngest Dev Server dashboard. It's the "output" of the workflow.
     *
     * In a full application, a separate GET endpoint would fetch
     * this result from a database (using a job ID from the event).
     * For this lab, the workflow completes and we can see the result
     * in the Inngest Dev Server.
     */
    return report;
  }
);
