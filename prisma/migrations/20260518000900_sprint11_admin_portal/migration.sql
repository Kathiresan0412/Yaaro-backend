CREATE TYPE "AdminRole" AS ENUM ('super_admin', 'moderator', 'support', 'analyst');

ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "suspend_until" TIMESTAMP(0);

CREATE TABLE IF NOT EXISTS "admins" (
  "id" BIGSERIAL PRIMARY KEY,
  "email" VARCHAR(255) NOT NULL,
  "password_hash" VARCHAR(255) NOT NULL,
  "role" "AdminRole" NOT NULL DEFAULT 'moderator',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "admins_email_key"
ON "admins"("email");

CREATE INDEX IF NOT EXISTS "admins_email_idx"
ON "admins"("email");

CREATE INDEX IF NOT EXISTS "admins_role_idx"
ON "admins"("role");

CREATE INDEX IF NOT EXISTS "admins_is_active_idx"
ON "admins"("is_active");

CREATE TABLE IF NOT EXISTS "admin_audit_logs" (
  "id" BIGSERIAL PRIMARY KEY,
  "admin_id" BIGINT,
  "action" VARCHAR(120) NOT NULL,
  "target_type" VARCHAR(80) NOT NULL,
  "target_id" VARCHAR(120),
  "description" VARCHAR(500),
  "metadata" JSONB,
  "ip_address" VARCHAR(80),
  "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_audit_logs_admin_id_fkey"
    FOREIGN KEY ("admin_id") REFERENCES "admins"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "admin_audit_logs_admin_id_created_at_idx"
ON "admin_audit_logs"("admin_id", "created_at");

CREATE INDEX IF NOT EXISTS "admin_audit_logs_action_idx"
ON "admin_audit_logs"("action");

CREATE INDEX IF NOT EXISTS "admin_audit_logs_target_type_target_id_idx"
ON "admin_audit_logs"("target_type", "target_id");

INSERT INTO "settings" ("key", "value", "type", "description", "updated_at")
VALUES
  ('max_daily_swipes_free', '50', 'integer', 'Daily free swipe limit', CURRENT_TIMESTAMP),
  ('superlike_daily_free', '1', 'integer', 'Daily free Super Like allowance', CURRENT_TIMESTAMP),
  ('boost_duration_minutes', '30', 'integer', 'Boost duration in minutes', CURRENT_TIMESTAMP),
  ('maintenance_mode', 'false', 'boolean', 'Temporarily disable user-facing flows', CURRENT_TIMESTAMP),
  ('photo_moderation_required', 'true', 'boolean', 'Require approval before photos are visible', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
