/**
 * =============================================================================
 * FILE: src/controllers/analysis.controller.js
 * =============================================================================
 *
 * PURPOSE:
 *   Handles the business logic for the POST /api/analyze endpoint.
 *   The controller receives a validated request, emits an Inngest event
 *   to trigger background analysis, and returns an immediate response
 *   to the client — WITHOUT waiting for Gemini to finish.
 *
 * HOW IT FITS INTO THE ARCHITECTURE:
 *   This is the "bridge" between the HTTP layer and the async workflow:
 *
 *   Request → Route → Validator → THIS CONTROLLER → Inngest event → Workflow
 *                                                    ↓
 *                                           Immediate HTTP response
 *
 *   The controller's ONLY job is to:
 *     1. Extract the code snippet from the validated request
 *     2. Send an Inngest event to trigger the background workflow
 *     3. Return a success response immediately
 *
 *   It does NOT call Gemini. It does NOT wait for analysis results.
 *   This separation enables true async architecture.
 *
 * EXECUTION FLOW:
 *   1. Express routes the request here after validation passes
 *   2. Controller extracts req.body.code
 *   3. Controller calls inngest.send() to emit a "code/analyze" event
 *   4. Controller returns 200 OK with a success message
 *   5. LATER (in the background): Inngest triggers the workflow
 *
 * KEY CONCEPTS:
 *
 *   **Asynchronous Job Pattern**: The HTTP request/response cycle is
 *   completely decoupled from the slow AI analysis. The client gets
 *   an immediate acknowledgment; results arrive later. This is
 *   how services like GitHub Actions work — you push code and get
 *   an immediate response, but the CI pipeline runs asynchronously.
 *
 *   **Fire-and-Forget with Guarantees**: Unlike a simple Promise
 *   (which is lost if the server crashes), Inngest guarantees the
 *   event will be processed. Once inngest.send() succeeds, the
 *   workflow WILL run — even if our server restarts.
 *
 *   **Controller Responsibility**: The controller is THIN. It
 *   orchestrates (sends event, returns response) but doesn't
 *   contain business logic. Business logic belongs in services
 *   and workflows.
 * =============================================================================
 */

import { inngest } from "../config/inngest.js";
import { formatSuccess } from "../utils/responseFormatter.js";
import { logger } from "../utils/logger.js";
import { AppError } from "../middleware/errorHandler.js";

/**
 * submitAnalysis - Controller for POST /api/analyze.
 *
 * This function:
 *   1. Extracts the code snippet from the request body
 *   2. Emits a "code/analyze" event to Inngest
 *   3. Returns an immediate success response
 *
 * @param {Request} req - Express request (body validated by middleware)
 * @param {Response} res - Express response
 * @param {Function} next - Express next middleware (for error handling)
 *
 * The request body has already been validated by our validator middleware,
 * so we can safely assume req.body.code exists and is a non-empty string.
 */
export async function submitAnalysis(req, res, next) {
  try {
    const { code } = req.body;

    logger.info("Analysis request received", {
      codeLength: code.length,
    });

    /*
     * EMIT INNGEST EVENT
     *
     * inngest.send() publishes an event to the Inngest platform.
     * The event object has two key fields:
     *
     *   - name: "code/analyze" — must match the event name in our workflow.
     *     If these don't match, the workflow won't be triggered.
     *
     *   - data: { code } — the payload that the workflow receives.
     *     The workflow accesses this via event.data.code.
     *
     * inngest.send() is async — it makes an HTTP call to the Inngest
     * server (local or cloud) to register the event. We await it to
     * ensure the event is confirmed before responding to the client.
     *
     * If inngest.send() fails, the error propagates to our catch block.
     * This is the correct behavior — if we can't guarantee the event
     * was received, we should NOT tell the client "success."
     */
    await inngest.send({
      name: "code/analyze",
      data: { code },
    });

    logger.info("Inngest event emitted successfully", {
      eventName: "code/analyze",
    });

    /*
     * RETURN IMMEDIATE RESPONSE
     *
     * Crucially, we do NOT wait for the Gemini analysis or the workflow
     * to complete. The response says "submitted" — not "completed."
     *
     * This is the key architectural decision that solves the serverless
     * timeout problem. A typical Gemini call takes 5-30 seconds. On
     * serverless platforms with 10-30 second timeouts, synchronous
     * processing would frequently fail. By decoupling the request from
     * the processing, we keep HTTP responses fast (< 100ms).
     *
     * In a production application, you might include a jobId in the
     * response so the client can poll for results:
     *   { success: true, message: "...", data: { jobId: "abc123" } }
     * The client would then GET /api/analyze/abc123 to check the result.
     */
    res.status(200).json(
      formatSuccess("Analysis job submitted successfully.")
    );
  } catch (error) {
    /*
     * If inngest.send() fails (e.g., Inngest server is down, network
     * error), we pass the error to Express error-handling middleware.
     *
     * We wrap it in an AppError with a 503 status code (Service Unavailable)
     * because the failure is with a downstream service (Inngest), not
     * our application logic.
     *
     * 503 is more appropriate than 500 here because:
     * - 500 = "Our server has a bug"
     * - 503 = "A dependency is temporarily unavailable"
     * The client knows to retry later with 503.
     */
    logger.error("Failed to emit Inngest event", {
      errorMessage: error.message,
    });

    next(
      new AppError(
        "Failed to submit analysis job. The workflow service is temporarily unavailable. Please try again.",
        503,
        "WORKFLOW_ERROR"
      )
    );
  }
}
