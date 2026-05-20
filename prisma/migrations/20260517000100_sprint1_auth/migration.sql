-- Sprint 1 auth fields for email-first web registration.
CREATE TYPE "UserStatus" AS ENUM ('active', 'suspended', 'banned', 'deleted');

ALTER TYPE "Gender" ADD VALUE IF NOT EXISTS 'non_binary';
ALTER TYPE "Gender" ADD VALUE IF NOT EXISTS 'other';

ALTER TABLE "users" ALTER COLUMN "phone" DROP NOT NULL;

ALTER TABLE "users"
  ADD COLUMN "first_name" VARCHAR(100),
  ADD COLUMN "last_name" VARCHAR(100),
  ADD COLUMN "email_verified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "email_verify_token" VARCHAR(128),
  ADD COLUMN "email_verify_token_expires" TIMESTAMP(0),
  ADD COLUMN "reset_password_token" VARCHAR(128),
  ADD COLUMN "reset_token_expires" TIMESTAMP(0),
  ADD COLUMN "oauth_provider" VARCHAR(50),
  ADD COLUMN "oauth_id" VARCHAR(255),
  ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'active',
  ADD COLUMN "onboarding_completed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "last_active_at" TIMESTAMP(0);

CREATE UNIQUE INDEX "users_email_verify_token_key" ON "users"("email_verify_token");
CREATE UNIQUE INDEX "users_reset_password_token_key" ON "users"("reset_password_token");
CREATE INDEX "users_email_idx" ON "users"("email");
CREATE INDEX "users_status_idx" ON "users"("status");

CREATE TABLE "refresh_tokens" (
  "id" BIGSERIAL NOT NULL,
  "user_id" BIGINT NOT NULL,
  "token" VARCHAR(128) NOT NULL,
  "expires_at" TIMESTAMP(0) NOT NULL,
  "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "refresh_tokens_token_key" ON "refresh_tokens"("token");
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

ALTER TABLE "refresh_tokens"
  ADD CONSTRAINT "refresh_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
