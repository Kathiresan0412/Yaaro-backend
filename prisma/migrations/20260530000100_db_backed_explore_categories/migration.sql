CREATE TABLE IF NOT EXISTS "explore_categories" (
  "id" BIGSERIAL PRIMARY KEY,
  "key" VARCHAR(80) NOT NULL,
  "label" VARCHAR(120) NOT NULL,
  "emoji" VARCHAR(16) NOT NULL,
  "hobbies" JSONB NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "explore_categories_key_key" ON "explore_categories"("key");
CREATE INDEX IF NOT EXISTS "explore_categories_is_active_sort_order_idx" ON "explore_categories"("is_active", "sort_order");

INSERT INTO "explore_categories" ("key", "label", "emoji", "hobbies", "sort_order", "is_active")
VALUES
  ('fitness', 'Fitness', '🏋️', '["Fitness", "Gym", "Yoga", "Running", "Cycling"]'::jsonb, 10, true),
  ('foodies', 'Foodies', '🍕', '["Cooking", "Food", "Baking", "Restaurants"]'::jsonb, 20, true),
  ('travel', 'Travel', '✈️', '["Travel", "Backpacking", "Road trips", "Beaches"]'::jsonb, 30, true),
  ('gamers', 'Gamers', '🎮', '["Gaming", "Esports", "Board games"]'::jsonb, 40, true),
  ('music', 'Music', '🎵', '["Music", "Concerts", "Singing", "Dancing"]'::jsonb, 50, true),
  ('outdoors', 'Outdoors', '🌲', '["Hiking", "Camping", "Nature", "Adventure"]'::jsonb, 60, true),
  ('creatives', 'Creatives', '🎨', '["Art", "Photography", "Writing", "Design"]'::jsonb, 70, true),
  ('bookworms', 'Bookworms', '📚', '["Reading", "Books", "Poetry"]'::jsonb, 80, true)
ON CONFLICT ("key") DO UPDATE SET
  "label" = EXCLUDED."label",
  "emoji" = EXCLUDED."emoji",
  "hobbies" = EXCLUDED."hobbies",
  "sort_order" = EXCLUDED."sort_order",
  "is_active" = EXCLUDED."is_active",
  "updated_at" = CURRENT_TIMESTAMP;
