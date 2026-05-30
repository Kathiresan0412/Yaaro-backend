ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "free_messages_used_today" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "free_messages_reset_at" DATE;
