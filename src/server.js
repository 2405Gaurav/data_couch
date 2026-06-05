/**
 * =============================================================================
 * FILE: src/server.js
 * =============================================================================
 *
 * PURPOSE:
 *   The main entry point for the application. This file:
 *   1. Loads environment variables
 *   2. Validates critical configuration
 *   3. Initializes external services (Gemini)
 *   4. Configures Express middleware and routes
 *   5. Registers the Inngest webhook endpoint
 *   6. Starts the HTTP server
 *
 * HOW IT FITS INTO THE ARCHITECTURE:
 *   server.js is the "conductor" — it doesn't contain business logic.
 *   Instead, it wires together all the pieces:
 *
 *   ┌─────────────────────────────────────────────────┐
 *   │                   server.js                      │
 *   │                                                  │
 *   │  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
 *   │  │  Config   │  │  Routes  │  │  Middleware   │  │
 *   │  │  (gemini, │  │ (analysis│  │ (errorHandler)│  │
 *   │  │  inngest) │  │  routes) │  │              │  │
 *   │  └──────────┘  └──────────┘  └──────────────┘  │
 *   │         ↓              ↓              ↓         │
 *   │  ┌─────────────────────────────────────────┐    │
 *   │  │           Express Application            │    │
 *   │  │    + Inngest webhook endpoint             │    │
 *   │  └─────────────────────────────────────────┘    │
 *   └─────────────────────────────────────────────────┘
 *
 * EXECUTION FLOW:
 *   1. Load .env file → make environment variables available
 *   2. Validate required env vars → fail fast if missing
 *   3. Initialize Gemini client → prepare for AI calls
 *   4. Create Express app → set up HTTP server
 *   5. Register JSON body parser → parse request bodies
 *   6. Register routes → map URLs to controllers
 *   7. Register Inngest serve → create webhook for Inngest
 *   8. Register error handler → catch all errors
 *   9. Start listening → accept HTTP connections
 *
 * KEY CONCEPTS:
 *
 *   **Startup Order Matters**: We validate configuration and initialize
 *   services BEFORE starting the server. If something is wrong (missing
 *   API key, network issue), we want to fail immediately — not after
 *   the first request comes in.
 *
 *   **Inngest Serve Middleware**: The `serve(inngest)` call creates a
 *   special Express middleware that handles Inngest's webhook requests.
 *   When Inngest wants to trigger a workflow, it calls this endpoint.
 *   The middleware verifies the request signature and routes it to
 *   the correct workflow function.
 * =============================================================================
 */

import dotenv from "dotenv";
import express from "express";
import { serve } from "inngest/express";

/*
 * STEP 1: Load environment variables from .env file.
 *
 * dotenv.config() reads the .env file in the project root and adds
 * its key-value pairs to process.env. This MUST happen before any
 * code that reads process.env (like our config modules).
 *
 * The call is placed at the very top of the file to guarantee that
 * all subsequent imports have access to the environment variables.
 */
dotenv.config();

/*
 * Import config, routes, middleware, and workflows AFTER dotenv.config().
 * These modules read from process.env, so they need env vars loaded first.
 */
import { initializeGemini } from "./config/gemini.js";
import { inngest } from "./config/inngest.js";
import analysisRoutes from "./routes/analysis.routes.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { logger } from "./utils/logger.js";

/*
 * Import the workflow so it registers with Inngest.
 *
 * IMPORTANT: Even though we don't USE the export directly, importing
 * the workflow file has a SIDE EFFECT — it calls inngest.createFunction(),
 * which registers the workflow with the Inngest client. Without this
 * import, the Inngest serve middleware won't know about our workflow,
 * and events won't trigger anything.
 *
 * This is a common pattern in event-driven systems: the act of importing
 * a module registers its handlers. Think of it like registering an
 * event listener — you import the file, and the listener is attached.
 */
import "./workflows/analyze-code.workflow.js";

/**
 * validateEnvironment - Checks that all required environment variables are set.
 *
 * This is our "fail-fast" check. If critical variables are missing, we
 * throw an error BEFORE the server starts accepting requests. This is
 * MUCH better than discovering the problem at runtime when a user
 * submits their first analysis request.
 *
 * Why not default the variables?
 *   - GEMINI_API_KEY: No sensible default exists. You MUST have a real key.
 *   - PORT: We CAN default to 3000 (a common development port).
 */
function validateEnvironment() {
  const requiredVars = ["GEMINI_API_KEY"];

  /*
   * Check each required variable. If any is missing or empty, collect
   * it into an array so we can report ALL missing variables at once.
   * This is better than failing on the first missing variable and
   * making the developer fix them one at a time.
   */
  const missing = requiredVars.filter(
    (varName) => !process.env[varName] || process.env[varName].trim() === ""
  );

  if (missing.length > 0) {
    throw new Error(
      `FATAL: Missing required environment variables: ${missing.join(", ")}\n` +
      "Please copy .env.example to .env and fill in the missing values."
    );
  }

  logger.info("Environment validation passed");
}

/**
 * STEP 2: Validate environment and initialize services.
 *
 * We wrap everything in a try/catch because any failure during
 * startup should produce a clear error message and exit the process
 * with a non-zero code (which signals to hosting platforms that
 * the container/instance is unhealthy).
 */
try {
  /*
   * Validate environment variables first.
   * If this fails, we don't bother initializing Gemini — there's
   * no point starting the server without a valid API key.
   */
  validateEnvironment();

  /*
   * Initialize the Gemini AI client.
   * This validates the API key format and creates the model instance.
   * If the key is invalid, this will throw.
   */
  initializeGemini();

  logger.info("All services initialized successfully");
} catch (startupError) {
  /*
   * Log the error with full detail for debugging.
   * We use console.error here (not our logger) because the logger
   * might not be fully configured yet during startup.
   */
  console.error("\n" + "=".repeat(60));
  console.error("STARTUP FAILED");
  console.error("=".repeat(60));
  console.error(startupError.message);
  console.error("=".repeat(60) + "\n");

  /*
   * Exit with code 1 to signal failure to the host environment.
   * Docker, Kubernetes, PM2, etc. use this exit code to decide
   * whether to restart the container/process.
   */
  process.exit(1);
}

/**
 * STEP 3: Create the Express application.
 */
const app = express();

/**
 * STEP 4: Configure Express middleware.
 *
 * Middleware runs for EVERY request, in the order it's registered.
 * The order matters: body parser must come before routes, and
 * error handler must come LAST.
 */

/*
 * JSON body parser.
 * This middleware parses incoming JSON request bodies and attaches
 * the parsed object to req.body. Without it, req.body is undefined.
 *
 * We set a body size limit of 1mb to prevent denial-of-service
 * attacks where someone sends a massive payload to exhaust memory.
 * Code snippets should never be that large.
 */
app.use(express.json({ limit: "1mb" }));

/**
 * STEP 5: Register API routes.
 *
 * Mount the analysis routes at /api.
 * This means POST /api/analyze maps to our analysis controller.
 *
 * The prefix "/api" is a common convention that:
 *   - Separates API endpoints from potential frontend routes
 *   - Makes it easy to add API versioning later (/api/v1, /api/v2)
 *   - Is expected by API clients and documentation tools
 */
app.use("/api", analysisRoutes);

/**
 * STEP 6: Register Inngest webhook endpoint.
 *
 * The serve() function creates a special middleware that handles
 * all Inngest-related requests. By default, it mounts at:
 *   - GET  /api/inngest — Inngest checks this to discover workflows
 *   - POST /api/inngest — Inngest calls this to trigger workflows
 *
 * Inngest needs these endpoints to:
 *   1. DISCOVER: On startup, Inngest dev server calls GET /api/inngest
 *      to learn what workflows we have registered.
 *   2. EXECUTE: When an event matches our workflow, Inngest calls
 *      POST /api/inngest with the event data and step instructions.
 *
 * WITHOUT this middleware, Inngest cannot communicate with our app.
 */
app.use("/api/inngest", serve({ client: inngest }));

/**
 * STEP 7: Register 404 handler.
 *
 * If a request doesn't match any route above, we return 404.
 * This must come AFTER all valid routes but BEFORE the error handler.
 *
 * Why not let Express's default 404 handle it?
 *   Express's default 404 returns HTML. We want JSON for consistency.
 *   Also, our custom 404 includes the attempted path, which helps
 *   with debugging ("Oh, I called /api/analyses instead of /api/analyze").
 */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
    error: "NOT_FOUND",
  });
});

/**
 * STEP 8: Register global error handler.
 *
 * This MUST be the LAST middleware registered. Express recognizes
 * error-handling middleware by its 4-parameter signature.
 * All errors thrown or passed via next(error) end up here.
 */
app.use(errorHandler);

/**
 * STEP 9: Start the server.
 *
 * We read PORT from environment variables with a default of 3000.
 * Using env vars for the port makes the app configurable — you can
 * run multiple instances on different ports, or hosting platforms
 * can assign a port dynamically.
 */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  logger.info("Server started", {
    port: PORT,
    env: process.env.NODE_ENV || "development",
    endpoints: {
      analyze: `http://localhost:${PORT}/api/analyze`,
      inngest: `http://localhost:${PORT}/api/inngest`,
    },
  });

  /*
   * REMINDER: Tell the developer what to do next.
   * The Inngest Dev Server is a SEPARATE process that must also
   * be running. Without it, events are sent to nowhere and
   * workflows never execute.
   */
  console.log("\n" + "=".repeat(60));
  console.log("  AI Code Vulnerability Analyzer is running!");
  console.log("=".repeat(60));
  console.log(`  Express API:  http://localhost:${PORT}/api/analyze`);
  console.log(`  Inngest Hook: http://localhost:${PORT}/api/inngest`);
  console.log("=".repeat(60));
  console.log("  REMINDER: Start the Inngest Dev Server in another terminal:");
  console.log("  npx inngest-cli dev -u http://localhost:" + PORT + "/api/inngest");
  console.log("=".repeat(60) + "\n");
});
