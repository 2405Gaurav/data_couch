/**
 * =============================================================================
 * FILE: src/config/inngest.js
 * =============================================================================
 *
 * PURPOSE:
 *   Creates and configures the Inngest client — the central object that
 *   connects our Express server to the Inngest platform for event-driven
 *   background processing.
 *
 * HOW IT FITS INTO THE ARCHITECTURE:
 *   Inngest acts as the "nervous system" of our async workflow:
 *
 *   Express route  →  emits Inngest event  →  returns HTTP response immediately
 *                                            ↓
 *                            Inngest triggers our workflow function
 *                                            ↓
 *                            Workflow calls Gemini, processes results
 *
 *   This config module creates the Inngest client that makes all of this
 *   possible. The client is used in two places:
 *     1. `analysis.controller.js` — to emit events
 *     2. `analyze-code.workflow.js` — to register the workflow handler
 *     3. `server.js` — to register the Inngest middleware with Express
 *
 * EXECUTION FLOW:
 *   1. On import, this module creates an Inngest client instance.
 *   2. The client is configured with an app ID and a signing key.
 *   3. The client is exported for use across the application.
 *
 * KEY CONCEPTS:
 *
 *   **Event-Driven Architecture**: Instead of calling Gemini directly
 *   from the API handler (which would block the HTTP response), we
 *   "emit an event" to Inngest. The event says: "Hey, there's new code
 *   to analyze." Inngest receives this event and triggers our workflow
 *   function separately. This is the async pattern that solves the
 *   serverless timeout problem.
 *
 *   **Inngest Client ID ("code-analyzer")**: This is a human-readable
 *   identifier for our application in the Inngest dashboard. It helps
 *   us distinguish this app from others when monitoring events and
 *   executions.
 *
 *   **Event Key**: Authenticates our events when sending them to Inngest.
 *   In local development with the Inngest Dev Server, this can be "test".
 *   In production, this is a real key from the Inngest dashboard.
 *
 *   **Signing Key**: Used to verify that incoming requests to our
 *   webhook endpoint (the Inngest serve endpoint) are genuinely from
 *   Inngest. Without this, an attacker could send fake workflow triggers
 *   to our server. In local dev, "test" works. In production, use the
 *   real signing key.
 * =============================================================================
 */

import { Inngest } from "inngest";

/**
 * Create the Inngest client.
 *
 * The Inngest constructor takes a configuration object:
 *
 * - `id`: A unique identifier for this application. This appears in
 *   the Inngest Dev Server UI and dashboard. Choose something
 *   descriptive that identifies your specific application.
 *
 * Our app is called "code-analyzer" because it analyzes code for
 * security vulnerabilities.
 */
const inngest = new Inngest({
  id: "code-analyzer",
});

/**
 * Export the Inngest client instance.
 *
 * This is a singleton — we create one client and reuse it everywhere.
 * The client handles:
 *   - Event emission (sending events to Inngest)
 *   - Workflow registration (telling Inngest which functions to run)
 *   - Connection management (reconnect, retries, etc.)
 *
 * Used by:
 *   - analysis.controller.js → inngest.send() to emit events
 *   - analyze-code.workflow.js → inngest.createFunction() to define workflows
 *   - server.js → serve(inngest) to register the webhook endpoint
 */
export { inngest };
