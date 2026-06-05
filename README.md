# AI-Powered Code Vulnerability Analyzer

A backend application that demonstrates how to build reliable AI workflows using Node.js, Express, Inngest, and Google Gemini. Submit code for asynchronous security analysis and receive structured vulnerability reports.

---

## Project Overview

This application solves a real problem in AI-powered development: **serverless timeout limits**. When you call an AI API directly from an HTTP handler, the request can time out before the AI finishes. This project demonstrates the correct approach — emitting an event and returning immediately, then processing the AI call in a background workflow.

**What it does:**
- Accepts a code snippet via a REST API
- Triggers an asynchronous background workflow (Inngest)
- Uses Google Gemini to analyze the code for security vulnerabilities
- Returns a structured JSON security report with risk levels and findings

**What you'll learn:**
- Event-driven architecture with Inngest
- Asynchronous job processing patterns
- Prompt engineering for structured LLM output
- Centralized error handling in Express
- Input validation at the edge
- Service layer architecture

---

## Architecture Diagram

```
                           ┌──────────────────────────────────────────────────┐
                           │              Server Architecture                  │
                           └──────────────────────────────────────────────────┘

    Client                  Express Server                     Inngest              Gemini AI
      │                         │                               │                      │
      │  POST /api/analyze      │                               │                      │
      │  { code: "..." }        │                               │                      │
      │ ──────────────────────> │                               │                      │
      │                         │                               │                      │
      │                         │  1. Validate request          │                      │
      │                         │     (analysis.validator.js)   │                      │
      │                         │                               │                      │
      │                         │  2. Emit "code/analyze"       │                      │
      │                         │     event (inngest.send())    │                      │
      │                         │ ────────────────────────────> │                      │
      │                         │                               │                      │
      │  200 OK                 │                               │                      │
      │  { success: true }      │                               │                      │
      │ <────────────────────── │                               │                      │ 
      │                         │                               │                      │
      │                         │                               │  3. Trigger          │
      │                         │                               │     workflow         │
      │                         │                               │     (analyze-code)   │
      │                         │                               │                      │
      │                         │                               │  4. Call Gemini      │
      │                         │                               │     (gemini.service) │
      │                         │                               │ ───────────────────> │
      │                         │                               │                      │
      │                         │                               │  5. Security report  │
      │                         │                               │ <─────────────────── │
      │                         │                               │                      │
      │                         │                               │  6. Log findings     │
      │                         │                               │     (step.run)       │
      │                         │                               │                      │
```

**Key Insight:** The client gets an immediate response. The AI analysis happens asynchronously in the background. This prevents HTTP timeout errors and makes the API feel fast.

---

## Folder Structure

```
project-root/
├── src/
│   ├── server.js                          # Entry point: starts Express + Inngest
│   ├── routes/
│   │   └── analysis.routes.js             # URL definitions for /api/analyze
│   ├── controllers/
│   │   └── analysis.controller.js         # Request handler: emits Inngest event
│   ├── services/
│   │   └── gemini.service.js              # Gemini API communication layer
│   ├── workflows/
│   │   └── analyze-code.workflow.js       # Inngest background workflow
│   ├── prompts/
│   │   └── security.prompt.js             # Prompt template for Gemini
│   ├── config/
│   │   ├── gemini.js                      # Gemini client initialization
│   │   └── inngest.js                     # Inngest client configuration
│   ├── middleware/
│   │   └── errorHandler.js                # Centralized error handling
│   ├── utils/
│   │   ├── logger.js                      # Structured JSON logging
│   │   └── responseFormatter.js           # Standardized API response format
│   └── validators/
│       └── analysis.validator.js           # Request body validation
├── .env.example                            # Environment variable template
├── package.json                             # Dependencies and scripts
└── README.md                                # This file
```

---

## Installation

### Prerequisites

- **Node.js** 18+ (recommended: 20+)
- **npm** 9+
- A **Google Gemini API key** from [Google AI Studio](https://aistudio.google.com/apikey)

### Steps

1. **Clone the repository** (or copy the project files):
   ```bash
   cd project-root
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up environment variables**:
   ```bash
   cp .env.example .env
   ```
   Open `.env` and fill in your `GEMINI_API_KEY`.

---

## Environment Setup

The `.env` file contains all configuration:

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3000) |
| `GEMINI_API_KEY` | **Yes** | Your Google AI Studio API key |
| `INNGEST_EVENT_KEY` | No | Inngest event auth key (use "test" for local dev) |
| `INNGEST_SIGNING_KEY` | No | Inngest webhook signing key (use "test" for local dev) |

> **Important:** The application will crash on startup if `GEMINI_API_KEY` is not set. This is by design (fail-fast principle).

---

## Running the Application

You need TWO processes running simultaneously:

### Terminal 1: Start the Express server

```bash
npm start
```

You should see:
```
{"timestamp":"...","level":"info","message":"Server started","port":3000,...}

============================================================
  AI Code Vulnerability Analyzer is running!
============================================================
  Express API:  http://localhost:3000/api/analyze
  Inngest Hook: http://localhost:3000/api/inngest
============================================================
  REMINDER: Start the Inngest Dev Server in another terminal:
  npx inngest-cli dev -u http://localhost:3000/api/inngest
============================================================
```

### Terminal 2: Start the Inngest Dev Server

The Inngest Dev Server receives events and triggers your workflows. Without it, events are sent but never processed.

```bash
npx inngest-cli dev -u http://localhost:3000/api/inngest
```

The Inngest Dev Server UI is available at: **http://localhost:8288**

---

## Testing the API

### Submit code for analysis

```bash
curl -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "code": "const password = \"admin123\";\n\napp.get(\"/login\", (req, res) => {\n  console.log(password);\n});"
  }'
```

**Immediate response (before Gemini finishes):**
```json
{
  "success": true,
  "message": "Analysis job submitted successfully."
}
```

### Check the results

Look at your Express server terminal logs. When the workflow completes, you'll see structured log entries like:

```json
{"timestamp":"...","level":"info","message":"Security analysis results","riskLevel":"HIGH","summary":"Code contains hardcoded credentials and insecure authentication patterns","totalFindings":2,"findings":[{"issue":"Hardcoded Password","severity":"CRITICAL"},{"issue":"Sensitive Data Exposure","severity":"HIGH"}]}
```

You can also view the full workflow execution (including the return value) in the **Inngest Dev Server UI** at http://localhost:8288.

---

## Expected Gemini JSON Output

For the test code `const password = "admin123"; app.get("/login", (req,res)=>{ console.log(password); })`, Gemini returns approximately:

```json
{
  "riskLevel": "HIGH",
  "summary": "Code contains hardcoded credentials and logs sensitive data to the console, both of which are critical security vulnerabilities.",
  "findings": [
    {
      "issue": "Hardcoded Password",
      "severity": "CRITICAL",
      "description": "The password 'admin123' is hardcoded directly in the source code. Anyone with access to the code repository can see the credential. This also makes rotating the password extremely difficult since it requires a code change and redeployment.",
      "recommendation": "Store sensitive credentials in environment variables or a secrets manager (e.g., AWS Secrets Manager, HashiCorp Vault). Access them at runtime with process.env.PASSWORD instead of hardcoding."
    },
    {
      "issue": "Sensitive Data Exposure",
      "severity": "HIGH",
      "description": "The password variable is logged to the console using console.log(). Console output may be captured in log aggregation systems, making the credential visible in logging dashboards and log files accessible to support staff or attackers.",
      "recommendation": "Never log sensitive data. If you must log for debugging, redact or mask sensitive fields. Use a logging library that supports automatic redaction of known sensitive patterns."
    }
  ]
}
```

---

## Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `FATAL: GEMINI_API_KEY is not set` | Missing `.env` file or empty API key | Copy `.env.example` to `.env` and add your Gemini API key |
| `ECONNREFUSED 127.0.0.1:3000` | Express server not running | Run `npm start` in a terminal |
| Event sent but no workflow runs | Inngest Dev Server not running | Run `npx inngest-cli dev -u http://localhost:3000/api/inngest` |
| `Gemini API call timed out` | Network issue or Gemini overloaded | Check internet connection; the workflow will auto-retry |
| `Failed to parse Gemini response as JSON` | Gemini returned non-JSON text | Check the raw response in logs; the service handles common issues automatically |
| `The 'code' field is required` | Missing `code` in request body | Ensure your JSON has a `"code"` key with a string value |
| `Content-Type must be application/json` | Missing or wrong Content-Type header | Add `-H "Content-Type: application/json"` to your curl command |

---

## Troubleshooting

### Server won't start

1. Check that Node.js 18+ is installed: `node --version`
2. Check that dependencies are installed: `ls node_modules`
3. Check that `.env` exists and has `GEMINI_API_KEY`

### Inngest events not processing

1. Confirm the Inngest Dev Server is running
2. Check that the URL passed to `inngest-cli dev` matches your Express server
3. Confirm the `GET /api/inngest` endpoint returns a 200 (Inngest uses this to discover workflows):
   ```bash
   curl http://localhost:3000/api/inngest
   ```

### Gemini API errors

1. **401 Unauthorized**: Your API key is invalid. Regenerate it at Google AI Studio.
2. **429 Too Many Requests**: You've hit your rate limit. Wait a minute or upgrade your API plan.
3. **500 Internal Server Error**: Gemini is having issues. The workflow will auto-retry.

### Viewing workflow results

The Inngest Dev Server UI at **http://localhost:8288** shows:
- All received events
- Workflow execution history
- Step-by-step results
- Errors and retries

This is the best way to see your analysis results in a user-friendly format.
