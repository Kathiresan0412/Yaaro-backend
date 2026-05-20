CREATE TABLE IF NOT EXISTS "user_profiles" (
  "user_id" BIGINT PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "display_name" VARCHAR(120),
  "pronouns" VARCHAR(80),
  "sexual_orientation" JSONB,
  "headline" VARCHAR(60),
  "bio" VARCHAR(500),
  "height_cm" INTEGER,
  "body_type" VARCHAR(80),
  "ethnicity" JSONB,
  "hair_colour" VARCHAR(80),
  "eye_colour" VARCHAR(80),
  "education" VARCHAR(160),
  "job_title" VARCHAR(160),
  "company" VARCHAR(160),
  "industry" VARCHAR(160),
  "religion" VARCHAR(120),
  "nationality" VARCHAR(120),
  "languages" JSONB,
  "smoking" VARCHAR(80),
  "drinking" VARCHAR(80),
  "exercise" VARCHAR(80),
  "diet" VARCHAR(80),
  "sleep_schedule" VARCHAR(80),
  "living_situation" VARCHAR(120),
  "has_children" VARCHAR(80),
  "wants_children" VARCHAR(80),
  "has_pets" JSONB,
  "wants_pets" VARCHAR(80),
  "fav_pet" VARCHAR(120),
  "fav_colour" VARCHAR(120),
  "fav_food" JSONB,
  "fav_music" JSONB,
  "fav_movie_genre" JSONB,
  "love_language" VARCHAR(120),
  "relationship_goal" VARCHAR(120),
  "star_sign" VARCHAR(40),
  "mbti" VARCHAR(8),
  "spotify_anthem_id" VARCHAR(160),
  "spotify_anthem_name" VARCHAR(255),
  "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "user_hobbies" (
  "user_id" BIGINT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "hobby" VARCHAR(80) NOT NULL,
  PRIMARY KEY ("user_id", "hobby")
);

CREATE TABLE IF NOT EXISTS "user_photos" (
  "id" BIGSERIAL PRIMARY KEY,
  "user_id" BIGINT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "url" TEXT NOT NULL,
  "order_index" INTEGER NOT NULL DEFAULT 0,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "status" "PhotoStatus" NOT NULL DEFAULT 'pending',
  "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "user_photos_user_id_idx" ON "user_photos"("user_id");

CREATE TABLE IF NOT EXISTS "user_locations" (
  "user_id" BIGINT PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "latitude" DECIMAL(10, 7),
  "longitude" DECIMAL(10, 7),
  "city" VARCHAR(120),
  "country" VARCHAR(120),
  "updated_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "user_preferences" (
  "user_id" BIGINT PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "show_gender" VARCHAR(40) NOT NULL DEFAULT 'everyone',
  "min_age" INTEGER NOT NULL DEFAULT 18,
  "max_age" INTEGER NOT NULL DEFAULT 45,
  "max_distance_km" INTEGER NOT NULL DEFAULT 50,
  "global_mode" BOOLEAN NOT NULL DEFAULT false,
  "show_verified_only" BOOLEAN NOT NULL DEFAULT false,
  "show_photos_only" BOOLEAN NOT NULL DEFAULT true,
  "updated_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
