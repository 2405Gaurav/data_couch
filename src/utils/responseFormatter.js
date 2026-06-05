/**
 * =============================================================================
 * FILE: src/utils/responseFormatter.js
 * =============================================================================
 *
 * PURPOSE:
 *   Standardizes API responses across the entire application. Every endpoint
 *   returns the same JSON structure, making the API predictable and easy to
 *   consume for frontend clients, mobile apps, and other services.
 *
 * HOW IT FITS INTO THE ARCHITECTURE:
 *   This utility sits between the controllers and the HTTP response.
 *   Controllers call these functions to build consistent response objects,
 *   then send them via res.json(). This centralization means:
 *   - Every response has the same envelope structure
 *   - We can change the format in one place
 *   - Error responses and success responses look consistent
 *
 * EXECUTION FLOW:
 *   Controller calls formatSuccess() or formatError()
 *   → Gets a plain JavaScript object
 *   → Sends it as the res.json() response body
 *
 * KEY CONCEPTS:
 *
 *   **Response Envelope Pattern**: Every API response is wrapped in a
 *   consistent structure with "success", "message", and "data"/"error"
 *   fields. Clients always know where to look for the status, the
 *   human-readable message, and the payload.
 *
 *   **Why not just return raw data?** Raw data responses make it hard
 *   for clients to distinguish success from error without checking HTTP
 *   status codes. The envelope makes the outcome explicit in the body.
 * =============================================================================
 */

/**
 * formatSuccess - Creates a standardized success response object.
 *
 * @param {string} message - Human-readable description of the successful operation
 * @param {object} data - The payload to return (optional)
 * @returns {object} A response object with success=true
 *
 * Example:
 *   formatSuccess("Analysis job submitted", { jobId: "abc123" })
 *   → { success: true, message: "Analysis job submitted", data: { jobId: "abc123" } }
 */
export function formatSuccess(message, data = null) {
  /*
   * We only include the "data" field if there's actual data to return.
   * This keeps responses clean — an endpoint that just acknowledges
   * receipt (like our POST /api/analyze) doesn't need an empty data field.
   */
  const response = {
    success: true,
    message,
  };

  if (data !== null) {
    response.data = data;
  }

  return response;
}

/**
 * formatError - Creates a standardized error response object.
 *
 * @param {string} message - Human-readable error description
 * @param {string} code - Machine-readable error identifier (optional)
 * @param {object} details - Additional error context (optional)
 * @returns {object} A response object with success=false
 *
 * Example:
 *   formatError("Code field is required", "VALIDATION_ERROR")
 *   → { success: false, message: "Code field is required", error: "VALIDATION_ERROR" }
 *
 * The "code" field is useful for frontend i18n — the client can map
 * machine-readable codes to localized user messages instead of showing
 * raw English strings.
 */
export function formatError(message, code = null, details = null) {
  const response = {
    success: false,
    message,
  };

  /*
   * Only include these fields if they have values. This avoids:
   *   { success: false, message: "...", error: null, details: null }
   * Which would be confusing to API consumers.
   */
  if (code) {
    response.error = code;
  }

  if (details) {
    response.details = details;
  }

  return response;
}
