# Memento Backend

A Node.js/TypeScript backend application built with Express.js, MongoDB, and Redis.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [Database Setup](#database-setup)
- [Running the Application](#running-the-application)
- [Docker Setup](#docker-setup)
- [Project Structure](#project-structure)
- [API Documentation](#api-documentation)
- [Production Operations](#production-operations)
- [Billing and Storage](#billing-and-storage)
- [Troubleshooting](#troubleshooting)

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** >= 20.14.0
- **npm** >= 10.0.0 (or **yarn**)
- **Docker** and **Docker Compose** (for Redis)
- **MongoDB** (remote instance - Atlas or self-hosted)
- **Git**

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd memento-backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   # or
   yarn install
   ```

3. **Build the project**
   ```bash
   npm run build
   # or
   yarn build
   ```

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
# Application
NODE_ENV=development
PORT=5000

# Database
MONGODB_URL=mongodb://your-remote-mongodb-url
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your-jwt-secret-key

# Email Configuration
MAIL_HOST=smtp.example.com
MAIL_PORT=465
MAIL_USER=your-email@example.com
MAIL_PASSWORD=your-email-password

# OAuth Providers
GOOGLE_ID=your-google-client-id
GOOGLE_SECRET=your-google-client-secret
META_ID=your-meta-app-id
META_SECRET=your-meta-app-secret
APPLE_ID=your-apple-client-id
APPLE_SECRET=your-apple-client-secret

# Storage
STORAGE_BASE_URL=your-storage-base-url
STORAGE_API_KEY=your-storage-api-key

# AWS S3 (if using)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
AWS_S3_BUCKET_NAME=your-bucket-name

# URLs
FRONTEND_URL=http://localhost:5173
BACKEND_URL=http://localhost:5000

# AI Services
GEMINI_API_KEY=your-gemini-api-key

# Development
DEV_MAILS=dev1@example.com,dev2@example.com
```

> **Note:** Replace all placeholder values with your actual credentials.

## Database Setup

### MongoDB

This application uses a **remote MongoDB** instance. You can use:
- **MongoDB Atlas** (cloud-hosted)
- **Self-hosted MongoDB** instance

Set the `MONGODB_URL` in your `.env` file to your MongoDB connection string.

### Redis

Redis runs locally using Docker. See the [Docker Setup](#docker-setup) section below.

## Running the Application

### Development Mode

1. **Start Redis** (using Docker Compose)
   ```bash
   docker-compose up -d redis
   ```

2. **Run the application in development mode**
   ```bash
   npm run dev
   # or
   yarn dev
   ```

   The application will start on `http://localhost:5000` (or the port specified in your `.env` file).

### Production Mode

1. **Build the project**
   ```bash
   npm run build
   ```

2. **Start Redis** (if not already running)
   ```bash
   docker-compose up -d redis
   ```

3. **Start the application**
   ```bash
   npm start
   # or
   yarn start
   ```

## Production Operations

- `GET /health` is the process liveness check.
- `GET /ready` verifies required dependencies and should gate traffic during deploys.
- `GET /metrics` exposes authenticated admin operational signals; it is not public.
- Run `npm run migrations:status:prod` against the built artifact before switching traffic. A failed or pending required migration blocks the release.
- Run `npm run compat:report -- --days 30 --supported web:<version>,ios:<version>,android:<version>` before retiring a compatibility shim. The report is read-only and never authorizes removal by itself.

Production configuration, rollback expectations, and compatibility evidence are documented in [the compatibility registry](docs/compatibility-registry.md). Do not remove legacy read paths until the supported-client window, telemetry threshold, and explicit approval are all recorded.

### Deploying from your machine

When GitHub Actions is unavailable (for example, the month's minutes are used up), deploy with the same steps the workflows run:

```bash
cp .deploy.env.example .deploy.env   # once: server host, user and your SSH key
scripts/deploy.sh dev                # from the dev branch
scripts/deploy.sh prod               # from main; asks you to type DEPLOY
```

The script refuses to run unless you are on the right branch with a clean tree that matches `origin`. It then runs lint, the contract check, the tests and the build, uploads an immutable release to `/opt/memento/backend-<env>/releases/`, installs its dependencies, runs migrations, switches `current`, reloads PM2 and checks `/ready`. If activation fails, the server-side script rolls back to the previous release by itself.

`scripts/deploy/<env>/*.sh` are the workflows' own remote scripts, copied verbatim; `test/scripts/deploy-scripts.test.ts` fails if they drift apart. Your SSH key must be in the server's `authorized_keys` for the deploy user.

## Billing and Storage

### Staging Pro access

The dev/staging PM2 deployment enables `STAGING_AUTO_PRO=true` for both the API
and workers. It grants every existing and new staging account effective Pro
access immediately, including the configured Pro storage allowance. No signup,
payment, or database backfill is required for existing users.

The application requires both `MEMENTO_ENV=dev` and `STAGING_AUTO_PRO=true`.
Production PM2 processes force the flag off. `NODE_ENV` is not used to identify
staging because both deployments run with `NODE_ENV=production`.

This is an environment entitlement: subscription summaries report active Pro
without an expiry, while stored subscription/payment records remain unchanged.
Explicit per-user storage overrides and administrative feature flags still
apply. To test Free plans or real subscription expiry on staging, set
`STAGING_AUTO_PRO=false` and reload both processes with the updated environment;
the original subscription behavior resumes without a data migration.

Polar is the only active payment integration. Paystack values remain readable only where older persisted records may contain them; there is no Paystack checkout, portal, invoice, or webhook flow.

The API is authoritative for subscription access and storage usage. Default storage quotas are configurable through `STORAGE_LIMIT_FREE_BYTES`, `STORAGE_LIMIT_PRO_BYTES`, and `STORAGE_LIMIT_LEGACY_BYTES`; the shipped defaults are 200 MiB for Free and 10 GiB for Pro and Legacy. A per-user administrative override takes precedence. Limits are enforced unless `STORAGE_QUOTA_ENFORCEMENT_ENABLED=false`; uploads over the limit return 403 `storage_quota_exceeded`, and `/staff/operations` counts accounts already over theirs (`storage_over_limit`). See [the billing implementation checklist](BILLING_IMPLEMENTATION_CHECKLIST.md) for contract, reconciliation, deployment, and staging sign-off requirements.

## Docker Setup

### Redis Container

The application uses Redis for caching and rate limiting. Redis runs in a Docker container.

**Start Redis:**
```bash
docker-compose up -d
```

**Stop Redis:**
```bash
docker-compose down
```

**View Redis logs:**
```bash
docker-compose logs -f redis
```

**Check Redis status:**
```bash
docker ps | grep redis
```

**Test Redis connection:**
```bash
docker exec -it memento-redis redis-cli ping
# Should return: PONG
```

### Connecting to Redis

Your application running locally will connect to Redis using:
```
REDIS_URL=redis://localhost:6379
```

The Redis container exposes port `6379` to your host machine, so your application can connect to it directly.

## Project Structure

```
memento-backend/
├── build/                 # Compiled JavaScript files
├── src/
│   ├── app.ts            # Express app configuration
│   ├── index.ts          # Application entry point
│   ├── middleware/       # Custom middleware
│   ├── module/           # Feature modules
│   │   ├── api/         # API routes
│   │   ├── auth/        # Authentication module
│   │   ├── database/    # Database models and connection
│   │   └── ...
│   ├── services/        # External services (Redis, Gemini, etc.)
│   └── utils/           # Utility functions and config
├── public/              # Static assets
├── views/               # Email templates
├── docker-compose.yml   # Docker Compose configuration
├── package.json
└── tsconfig.json
```

## API Documentation

### Available Endpoints

The API is organized into modules:

- `/api/auth` - Authentication endpoints
- `/api/user` - User management
- `/api/beneficiary` - Beneficiary management
- `/api/capsule` - Capsule operations
- `/api/memory` - Memory management
- `/api/prompt` - Prompt management
- `/api/ai` - AI-related endpoints
- `/api/file` - File upload/download
- `/api/activity` - Activity tracking

> **Note:** For detailed API documentation, refer to the API documentation or contact the development team.

## Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Start production server
- `npm run lint` - Run linter
- `npm run fix` - Fix linting issues
- `npm run clean` - Clean build directory

## Troubleshooting

### Redis Connection Issues

**Problem:** Cannot connect to Redis

**Solutions:**
1. Ensure Redis container is running:
   ```bash
   docker ps | grep redis
   ```

2. Check Redis logs:
   ```bash
   docker-compose logs redis
   ```

3. Verify Redis URL in `.env`:
   ```env
   REDIS_URL=redis://localhost:6379
   ```

4. Test Redis connection:
   ```bash
   docker exec -it memento-redis redis-cli ping
   ```

### MongoDB Connection Issues

**Problem:** Cannot connect to MongoDB

**Solutions:**
1. Verify `MONGODB_URL` in `.env` is correct
2. Check if MongoDB instance is accessible
3. Verify network connectivity to remote MongoDB
4. Check MongoDB connection string format

### Port Already in Use

**Problem:** Port 5000 is already in use

**Solutions:**
1. Change `PORT` in `.env` to a different port
2. Or stop the process using port 5000:
   ```bash
   # Find process using port 5000
   lsof -ti:5000
   # Kill the process
   kill -9 $(lsof -ti:5000)
   ```

### Build Errors

**Problem:** TypeScript compilation errors

**Solutions:**
1. Clean and rebuild:
   ```bash
   npm run clean
   npm run build
   ```

2. Check for TypeScript errors:
   ```bash
   npm run lint
   ```

## Contributing

1. Create a feature branch
2. Make your changes
3. Run tests and linting
4. Submit a pull request

## License

MIT

## Support

For issues and questions, please contact the development team or open an issue in the repository.
## File access rollout operations

Audit active file records without writing:

```bash
yarn files:audit-access
yarn files:backfill-thumbnails
```

The thumbnail backfill is dry-run by default. After reviewing its unmatched
count, apply only the recoverable thumbnail keys with:

```bash
yarn files:backfill-thumbnails --commit
```

This backfill does not change legacy file access modes. Before production
rollout, configure reverse-proxy and CDN access logs to redact the `sig`,
`token`, and `code` query parameters just as the application logger does.
