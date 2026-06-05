/**
 * =============================================================================
 * FILE: src/config/gemini.js
 * =============================================================================
 *
 * PURPOSE:
 *   Centralizes the configuration and initialization of the Google Gemini AI
 *   client. All Gemini-related setup lives here so that the rest of the
 *   application never touches raw API keys or client construction directly.
 *
 * HOW IT FITS INTO THE ARCHITECTURE:
 *   This module sits in the "config" layer — the foundation of the app.
 *   The `gemini.service.js` file imports the initialized model from here.
 *   If we ever switch from Gemini to another AI provider, only this file
 *   and the service need to change. Routes, controllers, and workflows
 *   remain untouched.
 *
 * EXECUTION FLOW:
 *   1. On startup, server.js calls the initialization function.
 *   2. This module validates that GEMINI_API_KEY exists in the environment.
 *   3. It creates a GoogleGenerativeAI client instance.
 *   4. It selects the Gemini model to use.
 *   5. The resulting model object is exported for use by gemini.service.js.
 *
 * KEY CONCEPTS:
 *   - **Singleton pattern**: We create ONE Gemini client and reuse it.
 *     Creating a new client per request wastes memory and connection pools.
 *   - **Fail-fast validation**: If the API key is missing, we crash
 *     immediately rather than failing on every request later.
 *   - **Model selection**: We use "gemini-2.0-flash" for a balance of
 *     speed and accuracy. Flash models respond faster, which is ideal
 *     for automated analysis pipelines.
 * =============================================================================
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "../utils/logger.js";

/**
 * The Gemini model identifier we want to use.
 *
 * "gemini-2.0-flash" is Google's fast inference model, optimized for
 * lower latency. This is ideal for code analysis where we want quick
 * turnaround. You could switch to "gemini-2.5-pro" for deeper
 * analysis at the cost of higher latency and token usage.
 */
const MODEL_NAME = "gemini-2.0-flash";

/**
 * Holds the initialized Gemini model instance.
 * This starts as null and gets populated by initializeGemini().
 * We use null to make it obvious if someone forgets to call init.
 */
let generativeModel = null;

/**
 * initializeGemini() - Creates and validates the Gemini AI client.
 *
 * This function MUST be called once during application startup before
 * any analysis requests are made. It performs two critical tasks:
 *
 * 1. **Validates the API key**: Without a valid key, every Gemini
 *    call will fail. Better to crash at startup than to silently
 *    fail on every request.
 *
 * 2. **Creates the model instance**: We construct the client once
 *    and reuse it across all requests (singleton pattern).
 *
 * @throws {Error} If GEMINI_API_KEY is not set in the environment
 */
export function initializeGemini() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    /*
     * FAIL-FAST PRINCIPLE:
     * Rather than returning a fallback or silently degrading, we throw
     * an error. This ensures the developer knows immediately that
     * something is wrong, rather than debugging cryptic "API key invalid"
     * errors later when the first request comes in.
     */
    throw new Error(
      "FATAL: GEMINI_API_KEY is not set in environment variables.\n" +
      "Please copy .env.example to .env and add your Gemini API key.\n" +
      "Get a key at: https://aistudio.google.com/apikey"
    );
  }

  /*
   * Create the GoogleGenerativeAI client.
   * This object manages authentication and connection pooling internally.
   * It does NOT make any network requests at construction time —
   * the first API call happens when we actually send a prompt.
   */
  const genAI = new GoogleGenerativeAI(apiKey);

  /*
   * getGenerativeModel() returns a model object that we use to generate content.
   * We don't call generateContent() here — we just prepare the model reference.
   */
  generativeModel = genAI.getGenerativeModel({ model: MODEL_NAME });

  logger.info("Gemini AI client initialized", { model: MODEL_NAME });
}

/**
 * getGeminiModel() - Returns the initialized Gemini model instance.
 *
 * Other parts of the application (specifically gemini.service.js) call
 * this function to get access to the Gemini model for making API calls.
 *
 * @returns {object} The initialized Gemini generative model
 * @throws {Error} If initializeGemini() has not been called yet
 */
export function getGeminiModel() {
  if (!generativeModel) {
    throw new Error(
      "Gemini model not initialized. Call initializeGemini() first."
    );
  }
  return generativeModel;
}
