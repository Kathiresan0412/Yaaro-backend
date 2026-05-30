CREATE TABLE IF NOT EXISTS "interest_badge_rules" (
  "id" BIGSERIAL PRIMARY KEY,
  "badge" VARCHAR(120) NOT NULL,
  "keywords" JSONB NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "interest_badge_rules_badge_key" ON "interest_badge_rules"("badge");
CREATE INDEX IF NOT EXISTS "interest_badge_rules_is_active_sort_order_idx"
  ON "interest_badge_rules"("is_active", "sort_order");

INSERT INTO "interest_badge_rules" ("badge", "keywords", "sort_order", "is_active")
VALUES
  ('Gamer', '["game", "gaming", "esports", "playstation", "xbox"]'::jsonb, 10, true),
  ('Traveller', '["travel", "trip", "backpacking", "passport"]'::jsonb, 20, true),
  ('Foodie', '["food", "cooking", "baking", "restaurant"]'::jsonb, 30, true),
  ('Music Lover', '["music", "singing", "guitar", "piano", "concert"]'::jsonb, 40, true),
  ('Bookworm', '["book", "reading", "novel", "poetry"]'::jsonb, 50, true),
  ('Fitness', '["gym", "fitness", "running", "yoga", "workout"]'::jsonb, 60, true),
  ('Creative', '["art", "design", "painting", "photography", "writing"]'::jsonb, 70, true),
  ('Movie Buff', '["movie", "cinema", "film", "netflix"]'::jsonb, 80, true),
  ('Nature', '["hiking", "nature", "camping", "beach", "garden"]'::jsonb, 90, true)
ON CONFLICT ("badge") DO UPDATE SET
  "keywords" = EXCLUDED."keywords",
  "sort_order" = EXCLUDED."sort_order",
  "is_active" = EXCLUDED."is_active",
  "updated_at" = CURRENT_TIMESTAMP;
