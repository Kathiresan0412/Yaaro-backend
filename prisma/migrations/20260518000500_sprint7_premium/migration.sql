CREATE TYPE "PremiumTier" AS ENUM ('free', 'plus', 'gold', 'platinum');

ALTER TABLE "user_preferences"
  ADD COLUMN IF NOT EXISTS "incognito_mode" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "user_locations"
  ADD COLUMN IF NOT EXISTS "passport_active" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "passport_latitude" DECIMAL(10, 7),
  ADD COLUMN IF NOT EXISTS "passport_longitude" DECIMAL(10, 7),
  ADD COLUMN IF NOT EXISTS "passport_city" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "passport_country" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "passport_updated_at" TIMESTAMP(0);

ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "stripe_subscription_id" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "stripe_customer_id" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_stripe_subscription_id_key"
  ON "subscriptions"("stripe_subscription_id");

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "checkout_session_id" VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS "payments_checkout_session_id_key"
  ON "payments"("checkout_session_id");

CREATE TABLE "boosts" (
  "id" BIGSERIAL PRIMARY KEY,
  "user_id" BIGINT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "started_at" TIMESTAMP(0) NOT NULL,
  "ends_at" TIMESTAMP(0) NOT NULL,
  "views_gained" INTEGER NOT NULL DEFAULT 0,
  "source" VARCHAR(40) NOT NULL DEFAULT 'monthly',
  "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "boosts_user_id_idx" ON "boosts"("user_id");
CREATE INDEX "boosts_ends_at_idx" ON "boosts"("ends_at");

CREATE TABLE "super_likes" (
  "id" BIGSERIAL PRIMARY KEY,
  "user_id" BIGINT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "target_user_id" BIGINT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "swipe_id" BIGINT UNIQUE REFERENCES "swipes"("id") ON DELETE SET NULL,
  "message" VARCHAR(140),
  "sent_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "super_likes_user_id_target_user_id_key" UNIQUE ("user_id", "target_user_id")
);

CREATE INDEX "super_likes_target_user_id_idx" ON "super_likes"("target_user_id");
CREATE INDEX "super_likes_sent_at_idx" ON "super_likes"("sent_at");

CREATE TABLE "top_pick_batches" (
  "id" BIGSERIAL PRIMARY KEY,
  "user_id" BIGINT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "pick_date" DATE NOT NULL,
  "picks" JSONB NOT NULL,
  "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "top_pick_batches_user_id_pick_date_key" UNIQUE ("user_id", "pick_date")
);
