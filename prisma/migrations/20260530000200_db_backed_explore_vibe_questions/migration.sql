CREATE TABLE IF NOT EXISTS "explore_vibe_questions" (
  "id" BIGSERIAL PRIMARY KEY,
  "key" VARCHAR(80) NOT NULL,
  "prompt" VARCHAR(255) NOT NULL,
  "answers" JSONB NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "explore_vibe_questions_key_key" ON "explore_vibe_questions"("key");
CREATE INDEX IF NOT EXISTS "explore_vibe_questions_is_active_sort_order_idx"
  ON "explore_vibe_questions"("is_active", "sort_order");

INSERT INTO "explore_vibe_questions" ("key", "prompt", "answers", "sort_order", "is_active")
VALUES
  ('daily-2026-05-18', 'A perfect weekend starts with...', '["A spontaneous trip", "A slow morning"]'::jsonb, 10, true),
  ('daily-2026-05-19', 'Choose your date energy.', '["Street food crawl", "Quiet rooftop talk"]'::jsonb, 20, true),
  ('daily-2026-05-20', 'Would you rather...', '["Travel often", "Build a cozy home"]'::jsonb, 30, true)
ON CONFLICT ("key") DO UPDATE SET
  "prompt" = EXCLUDED."prompt",
  "answers" = EXCLUDED."answers",
  "sort_order" = EXCLUDED."sort_order",
  "is_active" = EXCLUDED."is_active",
  "updated_at" = CURRENT_TIMESTAMP;
