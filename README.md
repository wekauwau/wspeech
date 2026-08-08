# TTS Platform

A multi-tenant Text-to-Speech-as-a-Service backend built with TypeScript, Fastify, and GCP.

## Features

- Public TTS API (async job submission + polling, plus sync endpoint)
- API-key based auth for programmatic access, JWT for account/dashboard
- Per-key rate limiting (requests/sec) separate from per-account billing quota (characters/month)
- Stripe-based subscription tiers gating the quota
- Background worker consuming TTS jobs from a queue
- Piper TTS engine (self-hosted, offline)

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Runtime**: Node.js
- **HTTP Framework**: Fastify
- **Database**: PostgreSQL (Atlas migrations, Kysely query builder)
- **Cache/Queue**: Redis (BullMQ)
- **Payments**: Stripe (test mode)
- **TTS Engine**: Piper (containerized)
- **Deployment**: Cloud Run (GCP)

## Project Structure

```
tts-platform/
├── apps/
│   ├── api/              # Fastify HTTP server
│   └── worker/           # BullMQ worker for TTS jobs
├── packages/
│   └── shared/           # Shared code (types, utils, DB schema)
├── docker/               # Dockerfiles
├── deploy/               # GCP deployment configs
├── docs/                 # Documentation
├── schema/               # Database schema
└── scripts/              # Development scripts
```

## Getting Started

### Prerequisites

- Node.js 22+
- pnpm 11.20.0+
- Docker & Docker Compose

### Local Development

```bash
# Install dependencies
pnpm install

# Start services (PostgreSQL, Redis, Piper)
docker compose up -d

# Run database migrations
pnpm db:push

# Start API server
pnpm dev:api

# Start worker (in separate terminal)
pnpm dev:worker
```

### API Endpoints

- `POST /v1/auth/register` - Register new user
- `POST /v1/auth/login` - Login (returns JWT)
- `POST /v1/api-keys` - Create API key (requires JWT)
- `POST /v1/tts` - Submit TTS job (async)
- `GET /v1/tts/:job_id` - Get job status
- `POST /v1/tts/sync` - Sync TTS (returns audio directly)
- `GET /v1/usage` - Get usage stats

## Deployment

### Cloud Run (Recommended)

See [CLOUD_RUN_vs_GKE.md](docs/CLOUD_RUN_vs_GKE.md) for tradeoffs.

```bash
# Deploy to GCP
./deploy/deploy.sh <project-id> <region>

# Deploy API service
gcloud run services deploy tts-api \
  --source ./docker \
  --region <region> \
  --allow-unauthenticated

# Deploy Worker service
gcloud run services deploy tts-worker \
  --source ./docker \
  --region <region> \
  --no-allow-unauthenticated
```

### GKE Autopilot (Stretch Goal)

See [CLOUD_RUN_vs_GKE.md](docs/CLOUD_RUN_vs_GKE.md) for comparison.

## Development

### Scripts

- `pnpm dev:api` - Start API in dev mode
- `pnpm dev:worker` - Start worker in dev mode
- `pnpm typecheck` - Run TypeScript checks
- `pnpm lint` - Run ESLint
- `pnpm test` - Run tests
- `pnpm db:push` - Push schema changes
- `pnpm db:reset` - Reset database
- `pnpm db:full` - Full database reset + seed

### Testing

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm vitest run packages/shared/src/__tests__/rate-limit.test.ts
```

## Architecture

### Authentication

- **JWT**: For user accounts (login, API key management)
- **API Keys**: For programmatic access (TTS endpoints)

### Rate Limiting

- Fixed-window rate limiting per API key
- Redis Lua scripts for atomic operations
- Returns `X-RateLimit-*` headers

### Billing

- Stripe Checkout for subscription management
- Webhook-driven subscription state updates
- Tier-gated quotas (free: 10k chars, starter: 100k, pro: 1M, enterprise: 10M)

### TTS Pipeline

1. Client submits text via API
2. Job added to BullMQ queue
3. Worker picks up job, calls Piper TTS
4. Audio stored in Cloud Storage (production) or local filesystem (dev)
5. Client polls job status, downloads audio when complete

## License

MIT
