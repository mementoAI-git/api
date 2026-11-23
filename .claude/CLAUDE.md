# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev          # Start dev server with hot reload (nodemon)
npm run worker       # Run background workers in dev mode

# Build
npm run build        # Clean + compile TypeScript (outputs to build/)
npm run compile      # TypeScript compilation only
npm run clean        # Remove build directory

# Production
npm start            # Start production server
npm run worker:prod  # Run workers in production

# Code quality
npm run lint         # Lint with Google TypeScript Style (gts)
npm run fix          # Auto-fix linting issues
```

Node >= 20.18.1 and npm >= 10.0.0 required. Redis must be running — start it with `docker-compose up -d`.

## Architecture

### Entry Points

- **`src/index.ts`** — Bootstraps the app: connects MongoDB + Redis, initializes BullMQ scheduler, registers error/signal handlers, then starts the Express server.
- **`src/app.ts`** — Configures the Express app: applies middleware stack (helmet → CORS → body parsing → logging → BullBoard → compression → Swagger → routes → 404/error handlers).
- **`src/workers/`** — Background job workers (insight, summarization, system), run as a separate process.

### Module Structure

Each feature lives in `src/module/api/<feature>/` with a consistent file layout:
- `routes.ts` — Express router
- `controller.ts` — Request/response handling
- `service.ts` — Business logic
- `validator.ts` / `dto.ts` — Input validation (express-validator + zod)

`src/module/api/index.ts` dynamically scans subdirectories and registers all routes at `/api/<feature>`.

Database models are in `src/module/database/model/`. Connection logic is in `src/module/database/connection.ts`.

### Request Lifecycle

1. Auth routes are public; all others pass through `src/middleware/gaurd.ts` (Bearer JWT validation).
2. Validated requests go through express-validator middleware (defined in `dto.ts`, applied in `routes.ts`).
3. Controllers call services; services throw typed errors from `src/utils/service-error.ts`.
4. `src/middleware/error-handler.ts` catches all errors, logs via Pino, and returns formatted responses.

### Key Services

- **`src/services/redis.ts`** — Redis client; used for caching and rate limiting.
- **`src/services/queues/`** — BullMQ queues: `summarizationQueue`, `insightQueue`, `systemQueue`. BullBoard UI exposed at `/queues`.
- **`src/services/storage/index.ts`** — Multi-provider file storage: GCS (primary) → S3 → Cloudinary (image fallback). Tracks provider per file in the `file` model.
- **`src/services/gemini.ts`** — Google Gemini AI integration.

### Configuration

All environment variables are loaded via dotenv and re-exported as constants from `src/utils/config.ts`. Required variables include: `MONGODB_URL`, `REDIS_URL`, `JWT_SECRET`, `GEMINI_API_KEY`, and credentials for at least one storage provider (GCS/S3/Cloudinary). See README.md for the full list.

### Custom Error Classes

Use the typed errors from `src/utils/service-error.ts` in services (`BadRequestException`, `UnauthorizedException`, `InternalServerErrorException`, etc.) — the global error handler maps these to the correct HTTP status codes.

### API Documentation

Swagger/OpenAPI docs are available at `/docs` when the server is running. Source files are in `src/docs/`.

## Product language

Apply these to all user-facing copy: emails (`views/mail/`), API messages, prompts and docs.

- Call the AI "your Memento" (for example "Talk to your Memento"). It doubles as the user's digital mind. Never call it an "AI twin" or "digital twin".
- Say "people" and "connection" for the people a user invites (for example "Ada Lovelace added you as a connection"). Never say "beneficiary" in user-facing copy. Internal code names such as the `beneficiary` model may stay.
- Memento has launched and signup is open. Don't describe it as a private beta, and don't ask for invite codes.
