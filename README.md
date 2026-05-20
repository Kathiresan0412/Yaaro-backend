# Yaro0 Backend

Express + TypeScript API workspace for authentication, profiles, matching, messaging, subscriptions, moderation, notifications, and admin operations.

Expected main areas:

- `src/app.ts` - Express app setup
- `src/server.ts` - HTTP server entry point
- `src/config/` - environment, database, storage, SMS, payment, and realtime config
- `src/routes/` - versioned API routes
- `src/controllers/` - request handlers
- `src/services/` - business logic
- `src/repositories/` - database access layer
- `src/models/` - domain models or ORM models
- `src/middleware/` - auth, admin, subscription, validation, and error middleware
- `src/validators/` - request validation schemas
- `src/jobs/` - queue/background jobs
- `src/events/` - websocket/realtime events
- `src/utils/` - shared helpers
- `src/types/` - TypeScript shared types
- `prisma/` - database schema, migrations, and seed data if Prisma is used

## PostgreSQL

The backend uses Prisma with PostgreSQL. Configure your database in `backend/.env`:

```env
DATABASE_URL="postgresql://avnadmin:YOUR_AIVEN_PASSWORD@pg-3edf519b-yaaroo.c.aivencloud.com:22296/defaultdb?sslmode=require"
```

For Aiven, keep the real password only in `backend/.env`. Do not commit it.
If your connection requires the CA certificate, save it outside git and point Node to it:

```bash
export NODE_EXTRA_CA_CERTS=/absolute/path/to/aiven-ca.pem
```
sssdd

Then run Prisma:

```bash
npm run prisma:migrate
npm run prisma:generate
```

## Railway Deployment

This service expects `DATABASE_URL` to be present before deployment. In Railway:

1. Add a PostgreSQL service to the same project.
2. Open this app service's Variables tab.
3. Add a reference variable named `DATABASE_URL` that points to the Postgres service's `DATABASE_URL`.
4. Redeploy the app service.

`railway.json` runs `npm run prisma:deploy` as a pre-deploy command, then starts the app with `npm run start`. If `DATABASE_URL` is missing, the pre-deploy migration step will fail before the new deployment is promoted.

You can confirm the API can reach PostgreSQL at:

```text
GET http://localhost:8000/api/v1/health/db
```
