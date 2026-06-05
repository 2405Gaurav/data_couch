/**
 * =============================================================================
 * FILE: src/validators/analysis.validator.js
 * =============================================================================
 *
 * PURPOSE:
 *   Validates incoming requests for the code analysis endpoint. This module
 *   acts as the "gatekeeper" — ensuring that only well-formed requests reach
 *   our controller and workflow logic. Invalid requests are rejected early
 *   with clear, specific error messages.
 *
 * HOW IT FITS INTO THE ARCHITECTURE:
 *   This validator sits between the route definition and the controller.
 *   When a POST /api/analyze request arrives, the validator checks the
 *   request body BEFORE any business logic runs. If validation fails,
 *   the request is rejected with a 400 status code and never reaches
 *   the controller or Inngest workflow.
 *
 *   Flow:
 *     POST /api/analyze → route → validator → (if valid) → controller → Inngest event
 *                                     ↓ (if invalid)
 *                                   400 Bad Request
 *
 * EXECUTION FLOW:
 *   1. Express route handler calls validateAnalysisRequest(req, res, next).
 *   2. The function checks the request body for the "code" field.
 *   3. If valid, calls next() to pass control to the next handler (controller).
 *   4. If invalid, sends a 400 response and does NOT call next().
 *
 * KEY CONCEPTS:
 *
 *   **Validation at the Edge**: Validate input as early as possible.
 *   Bad data that reaches business logic causes confusing errors, wasted
 *   API calls (Gemini charges per token!), and security vulnerabilities.
 *
 *   **Fail Fast, Fail Clear**: When validation fails, tell the client
 *   EXACTLY what's wrong. "Bad request" is useless. "'code' field is
 *   required and must be a non-empty string" is helpful.
 *
 *   **Express Middleware Chain**: This validator is middleware — it has
 *   (req, res, next) parameters. If validation passes, we call next()
 *   to continue the chain. If it fails, we send an error response
 *   and stop the chain.
 * =============================================================================
 */

import { formatError } from "../utils/responseFormatter.js";
import { logger } from "../utils/logger.js";

/**
 * validateAnalysisRequest - Validates the request body for POST /api/analyze.
 *
 * Checks performed (in order):
 *   1. Request body must exist (not null/undefined)
 *   2. The "code" field must be present
 *   3. The "code" field must be a string
 *   4. The "code" field must not be empty (after trimming whitespace)
 *   5. The "code" field must not exceed a reasonable length limit
 *
 * We check in this specific order so that the first failing check
 * produces the error message. This gives the client one clear action
 * item at a time rather than a wall of errors.
 *
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {Function} next - Express next middleware function
 */
export function validateAnalysisRequest(req, res, next) {
  /*
   * CHECK 1: Request body exists.
   *
   * Express should always provide req.body, but if the Content-Type
   * header is missing or wrong (e.g., "text/plain" instead of
   * "application/json"), Express won't parse the body and req.body
   * will be undefined.
   */
  if (!req.body || typeof req.body !== "object") {
    logger.warn("Validation failed: missing or invalid request body");
    return res.status(400).json(
      formatError(
        "Request body must be a JSON object. Ensure Content-Type is application/json.",
        "VALIDATION_ERROR"
      )
    );
  }

  const { code } = req.body;

  /*
   * CHECK 2: The "code" field exists.
   *
   * We use `code === undefined` rather than `!code` because !code would
   * also reject the string "" (empty string) — but we handle empty
   * strings separately in CHECK 4 with a more specific message.
   */
  if (code === undefined) {
    logger.warn("Validation failed: missing 'code' field");
    return res.status(400).json(
      formatError(
        "The 'code' field is required. Send your code snippet as a string value.",
        "VALIDATION_ERROR"
      )
    );
  }

  /*
   * CHECK 3: The "code" field is a string.
   *
   * Why must it be a string? Our prompt template inserts the code directly
   * into a text prompt for Gemini. Numbers, arrays, or objects would
   * produce nonsensical prompts or errors during string interpolation.
   *
   * Example of what we want to PREVENT:
   *   { "code": 123 }        → Number, not a code snippet
   *   { "code": ["a","b"] }  → Array, not a code snippet
   *   { "code": { a: 1 } }  → Object, not a code snippet
   */
  if (typeof code !== "string") {
    logger.warn("Validation failed: 'code' is not a string", {
      receivedType: typeof code,
    });
    return res.status(400).json(
      formatError(
        `The 'code' field must be a string, but received ${typeof code}.`,
        "VALIDATION_ERROR"
      )
    );
  }

  /*
   * CHECK 4: The "code" field is not empty.
   *
   * We trim whitespace before checking to prevent submissions that are
   * just spaces or newlines. Analyzing whitespace is meaningless and
   * wastes Gemini API tokens.
   */
  if (code.trim().length === 0) {
    logger.warn("Validation failed: 'code' is empty or whitespace only");
    return res.status(400).json(
      formatError(
        "The 'code' field must not be empty. Provide actual code to analyze.",
        "VALIDATION_ERROR"
      )
    );
  }

  /*
   * CHECK 5: Maximum length limit.
   *
   * We cap the code at 50,000 characters to prevent:
   *   - Excessive Gemini API token usage (and cost)
   *   - Potential prompt injection via extremely long inputs
   *   - Memory pressure on the server
   *
   * 50,000 characters is roughly 1,500 lines of code — plenty for
   * any realistic analysis request.
   */
  const MAX_CODE_LENGTH = 50_000;
  if (code.length > MAX_CODE_LENGTH) {
    logger.warn("Validation failed: 'code' exceeds maximum length", {
      length: code.length,
      max: MAX_CODE_LENGTH,
    });
    return res.status(400).json(
      formatError(
        `Code snippet exceeds maximum length of ${MAX_CODE_LENGTH} characters. Received ${code.length} characters.`,
        "VALIDATION_ERROR"
      )
    );
  }

  /*
   * VALIDATION PASSED
   *
   * If we reach this point, all checks passed. Call next() to pass
   * control to the next middleware in the chain (our controller).
   *
   * We also attach a sanitized version of the input to req for
   * downstream use. This "trim" ensures no leading/trailing whitespace
   * is sent to Gemini, which could affect prompt quality.
   */
  req.body.code = code.trim();

  logger.info("Validation passed for analysis request", {
    codeLength: req.body.code.length,
  });

  next();
}
