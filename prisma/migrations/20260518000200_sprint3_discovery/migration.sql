DO $$ BEGIN
  CREATE TYPE "SwipeAction" AS ENUM ('like', 'pass', 'superlike');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "swipes" (
  "id" BIGSERIAL PRIMARY KEY,
  "swiper_id" BIGINT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "swiped_id" BIGINT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "action" "SwipeAction" NOT NULL,
  "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "swipes_swiper_id_swiped_id_key" UNIQUE ("swiper_id", "swiped_id")
);

CREATE INDEX IF NOT EXISTS "swipes_swiper_id_idx" ON "swipes"("swiper_id");
CREATE INDEX IF NOT EXISTS "swipes_swiped_id_idx" ON "swipes"("swiped_id");
CREATE INDEX IF NOT EXISTS "swipes_action_idx" ON "swipes"("action");
CREATE INDEX IF NOT EXISTS "swipes_created_at_idx" ON "swipes"("created_at");
