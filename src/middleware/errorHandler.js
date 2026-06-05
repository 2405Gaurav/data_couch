/**
 * =============================================================================
 * FILE: src/middleware/errorHandler.js
 * =============================================================================
 *
 * PURPOSE:
 *   Centralized error handling middleware for Express. This is the "last resort"
 *   catch-all that ensures every error — whether from validation, Gemnini API
 *   failures, or unexpected bugs — produces a consistent, safe HTTP response.
 *
 * HOW IT FITS INTO THE ARCHITECTURE:
 *   This middleware is registered LAST in the Express middleware stack
 *   in server.js. Express error-handling middleware has a special signature
 *   (4 parameters: err, req, res, next). When any route handler calls
 *   next(error) or throws an error, Express skips all regular middleware
 *   and calls this error handler.
 *
 *   Flow:
 *     Request → Route handler → Error occurs → next(error) → This middleware → Response
 *
 * EXECUTION FLOW:
 *   1. An error is passed to this middleware (via next(err) or Express auto-catch).
 *   2. The middleware inspects the error's status code and message.
 *   3. It maps the error to the appropriate HTTP status code.
 *   4. It logs the error with full context for debugging.
 *   5. It sends a clean, structured JSON response to the client.
 *   6. It NEVER exposes stack traces or internal details to the client.
 *
 * KEY CONCEPTS:
 *
 *   **Centralized Error Handling**: Instead of try/catch in every route,
 *   errors bubble up to this one handler. This prevents error-handling
 *   duplication and ensures no error slips through unhandled.
 *
 *   **Error-First Middleware**: Express convention requires the error
 *   parameter first. Any middleware with (err, req, res, next) signature
 *   is treated as error-handling middleware.
 *
 *   **Security**: We never send raw error messages or stack traces to
 *   the client. This prevents information leakage (internal paths, DB
 *   connection strings, etc.) that attackers could exploit.
 * =============================================================================
 */

import { logger } from "../utils/logger.js";
import { formatError } from "../utils/responseFormatter.js";

/**
 * errorHandler - Express error-handling middleware.
 *
 * This function catches ALL errors that occur during request processing.
 * Express recognizes it as error-handling middleware because it has
 * exactly 4 parameters.
 *
 * @param {Error} err - The error object (may have custom statusCode property)
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {Function} next - Express next middleware function
 */
export function errorHandler(err, req, res, next) {
  /*
   * DETERMINE THE HTTP STATUS CODE
   *
   * Custom errors (like our AppError class or validation errors) may
   * set a `statusCode` property on the error object. If present, use it.
   * Otherwise, default to 500 (Internal Server Error).
   *
   * Common status codes in this application:
   *   400 - Bad Request (validation failed)
   *   404 - Not Found (route doesn't exist)
   *   429 - Too Many Requests (rate limited)
   *   500 - Internal Server Error (unexpected failure)
   */
  const statusCode = err.statusCode || 500;

  /*
   * DETERMINE THE ERROR MESSAGE
   *
   * In development, we show the actual error message for debugging.
   * In production, we hide internal error details and show a generic
   * message. This prevents leaking sensitive info like database
   * connection strings, API keys in error messages, etc.
   *
   * NODE_ENV is set to "development" by default if not specified.
   */
  const isDevelopment = process.env.NODE_ENV !== "production";

  const clientMessage =
    statusCode === 500 && !isDevelopment
      ? "An internal server error occurred. Please try again later."
      : err.message || "An unexpected error occurred.";

  /*
   * LOG THE ERROR
   *
   * We log with full detail regardless of environment. Logs are for
   * developers, not clients. Include the request method and path
   * so we can trace which endpoint caused the error.
   */
  logger.error("Request error", {
    method: req.method,
    path: req.originalUrl,
    statusCode,
    errorName: err.name,
    errorMessage: err.message,
    /*
     * Stack traces are logged but never sent to the client.
     * They help developers debug but reveal internal structure
     * that could aid attackers.
     */
    stack: err.stack,
  });

  /*
   * BUILD AND SEND THE ERROR RESPONSE
   *
   * We use our standardized formatError() utility so all error
   * responses have the same structure as success responses.
   */
  const response = formatError(clientMessage, err.code || "INTERNAL_ERROR");

  res.status(statusCode).json(response);
}

/**
 * AppError - Custom error class for application-level errors.
 *
 * Why create a custom error class? JavaScript's built-in Error only
 * has a message. We often need additional context:
 *   - statusCode: Which HTTP status to return
 *   - code: A machine-readable error identifier
 *
 * Usage example:
 *   throw new AppError("Code field is required", 400, "VALIDATION_ERROR");
 *
 * This gets caught by our errorHandler middleware, which reads the
 * statusCode and code properties to build the HTTP response.
 */
export class AppError extends Error {
  /**
   * @param {string} message - Human-readable error description
   * @param {number} statusCode - HTTP status code (400, 404, 429, 500)
   * @param {string} code - Machine-readable error identifier
   */
  constructor(message, statusCode = 500, code = "INTERNAL_ERROR") {
    /*
     * Call the parent Error constructor with the message.
     * This sets up the .message and .stack properties correctly.
     */
    super(message);

    /*
     * Set the name to our class name for better log readability.
     * Without this, err.name would be "Error" instead of "AppError".
     */
    this.name = "AppError";

    this.statusCode = statusCode;
    this.code = code;
  }
}
