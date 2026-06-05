/**
 * =============================================================================
 * FILE: src/routes/analysis.routes.js
 * =============================================================================
 *
 * PURPOSE:
 *   Defines the API routes for the code analysis feature. Routes map
 *   HTTP endpoints (URLs + methods) to their handler functions (controllers).
 *
 * HOW IT FITS INTO THE ARCHITECTURE:
 *   Routes are the entry point for HTTP requests. They sit at the top of
 *   the request-handling pipeline:
 *
 *   HTTP Request → Express router → THIS ROUTE → Validator → Controller → Response
 *
 *   This file is the ONLY place where URL paths are defined. If a URL
 *   needs to change, you change it here — no need to hunt through
 *   controllers or middleware.
 *
 * EXECUTION FLOW:
 *   1. Express receives POST /api/analyze
 *   2. The router matches the path and method to the route below
 *   3. The validator middleware runs first (checks request body)
 *   4. If validation passes, the controller runs (emits Inngest event)
 *   5. The controller sends the HTTP response
 *
 * KEY CONCEPTS:
 *
 *   **Express Router**: We create a separate Router instance (not the
 *   main app) so routes can be modular. Each feature can have its own
 *   router file, and server.js mounts them at specific path prefixes.
 *
 *   **Middleware Chain**: Each route can specify middleware that runs
 *   before the controller. Here, we include the validation middleware.
 *   Express runs them in order: validateAnalysisRequest → submitAnalysis.
 *
 *   **One Route Per File (SRP)**: This file handles analysis routes only.
 *   If we add user management, webhook, or health check endpoints, they
 *   each get their own route file. This keeps things organized.
 * =============================================================================
 */

import { Router } from "express";
import { submitAnalysis } from "../controllers/analysis.controller.js";
import { validateAnalysisRequest } from "../validators/analysis.validator.js";

/**
 * Create a new Express Router instance.
 *
 * We use Router() instead of the main app to keep routes modular.
 * The main server.js file will mount this router at a path prefix
 * like "/api", making the full endpoint "/api/analyze".
 */
const router = Router();

/**
 * POST /analyze — Submit code for security analysis.
 *
 * FULL URL: POST /api/analyze (when mounted at /api in server.js)
 *
 * REQUEST BODY:
 *   {
 *     "code": "const password = 'admin123';"
 *   }
 *
 * RESPONSE (success):
 *   {
 *     "success": true,
 *     "message": "Analysis job submitted successfully."
 *   }
 *
 * MIDDLEWARE CHAIN:
 *   1. validateAnalysisRequest — ensures req.body.code is a valid string
 *   2. submitAnalysis — emits Inngest event and returns immediate response
 *
 * Why validator BEFORE controller?
 *   Validation is cheap (no API calls), and it prevents wasting
 *   Inngest events on invalid requests. An Inngest event with empty
 *   code would trigger a workflow that immediately fails.
 *   Validating first saves resources and gives instant feedback.
 */
router.post("/analyze", validateAnalysisRequest, submitAnalysis);

/**
 * Export the router so server.js can mount it.
 *
 * In server.js:
 *   app.use("/api", analysisRoutes);
 *
 * This means all routes defined here become accessible under /api/*.
 */
export default router;
