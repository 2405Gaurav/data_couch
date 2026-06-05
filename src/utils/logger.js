/**
 * =============================================================================
 * FILE: src/utils/logger.js
 * =============================================================================
 *
 * PURPOSE:
 *   Provides a structured logging utility for the entire application.
 *   Instead of using console.log() directly (which produces unstructured,
 *   hard-to-search output), we use this logger that outputs structured
 *   JSON-formatted log entries.
 *
 * HOW IT FITS INTO THE ARCHITECTURE:
 *   This is a foundational utility used by EVERY other module. Every file
 *   imports logger to record what's happening. This centralization means:
 *   - We can change logging format in one place
 *   - We can add log levels, filtering, or transport to external services
 *   - All logs have a consistent structure
 *
 * EXECUTION FLOW:
 *   1. Any module imports { logger } from this file.
 *   2. Calls logger.info(), logger.warn(), logger.error(), etc.
 *   3. Each call produces a structured JSON line to stdout or stderr.
 *
 * KEY CONCEPTS:
 *
 *   **Structured Logging**: Each log entry is a JSON object with:
 *   - timestamp: When the event occurred (ISO 8601 format)
 *   - level: The severity (info, warn, error)
 *   - message: What happened
 *   - ...additional context: Any extra data passed as key-value pairs
 *
 *   **Why not console.log()?** In production, logs are aggregated by tools
 *   like Datadog, CloudWatch, or ELK. These tools can parse JSON
 *   automatically, making logs searchable and filterable. Raw text logs
 *   require painful regex parsing. Structured logging is a production
 *   best practice.
 *
 *   **Log Levels**:
 *   - info: Normal operational messages (server started, request received)
 *   - warn: Something unexpected but recoverable (API returned unexpected format)
 *   - error: Something failed (Gemini API call failed, validation error)
 * =============================================================================
 */

/**
 * formatLogEntry - Creates a structured JSON log entry.
 *
 * @param {string} level - The log severity: "info", "warn", or "error"
 * @param {string} message - Human-readable description of what happened
 * @param {object} meta - Optional additional context as key-value pairs
 * @returns {string} A JSON-formatted log line
 *
 * Example output:
 *   {"timestamp":"2026-06-05T10:30:00.000Z","level":"info","message":"Analysis job submitted","codeSnippetId":"abc123"}
 */
function formatLogEntry(level, message, meta = {}) {
  /*
   * We spread meta into the log object so additional context appears as
   * top-level keys. This makes querying easier in log aggregation tools.
   * For example, you could search: level=error AND geminiCallFailed=true
   */
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  });
}

/**
 * The logger object — our application's unified logging interface.
 *
 * Every module uses the same logger. This consistency is critical:
 * - All logs have the same format
 * - All logs include timestamps
 * - We can easily add features (file output, log rotation, etc.) here
 *
 * Usage examples:
 *   logger.info("Server started", { port: 3000 });
 *   logger.warn("Unexpected Gemini response format", { raw: response });
 *   logger.error("Gemini API call failed", { error: err.message });
 */
export const logger = {
  /**
   * info() - Log informational messages.
   * Use for: normal operations, startup messages, successful completions.
   */
  info(message, meta = {}) {
    process.stdout.write(formatLogEntry("info", message, meta) + "\n");
  },

  /**
   * warn() - Log warning messages.
   * Use for: recoverable issues, unexpected but non-fatal situations.
   */
  warn(message, meta = {}) {
    process.stderr.write(formatLogEntry("warn", message, meta) + "\n");
  },

  /**
   * error() - Log error messages.
   * Use for: failures, exceptions, unrecoverable problems.
   *
   * Note: We write errors to stderr (not stdout). This is a Unix convention:
   * - stdout is for program output
   * - stderr is for diagnostic/error output
   * This allows tools to redirect them separately:
   *   node app.js 2>errors.log
   */
  error(message, meta = {}) {
    process.stderr.write(formatLogEntry("error", message, meta) + "\n");
  },
};
