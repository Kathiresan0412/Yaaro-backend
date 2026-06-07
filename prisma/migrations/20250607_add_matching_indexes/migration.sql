-- Performance indexes for matching/discovery operations

-- Composite index for candidate discovery queries (filters active, non-banned, onboarded users)
CREATE INDEX IF NOT EXISTS "users_is_active_is_banned_status_onboarding_completed_idx"
  ON "users" ("is_active", "is_banned", "status", "onboarding_completed");

-- Users: last active for sorting/freshness
CREATE INDEX IF NOT EXISTS "users_last_active_at_idx"
  ON "users" ("last_active_at");

-- Matches: composite for active match lookups by user
CREATE INDEX IF NOT EXISTS "matches_user1_id_is_active_matched_at_idx"
  ON "matches" ("user1_id", "is_active", "matched_at" DESC);

CREATE INDEX IF NOT EXISTS "matches_user2_id_is_active_matched_at_idx"
  ON "matches" ("user2_id", "is_active", "matched_at" DESC);

-- UserLocations: lat/lng for potential spatial queries
CREATE INDEX IF NOT EXISTS "user_locations_latitude_longitude_idx"
  ON "user_locations" ("latitude", "longitude");

-- Profiles: gender + date_of_birth for age/gender filtering in discovery
CREATE INDEX IF NOT EXISTS "profiles_gender_date_of_birth_idx"
  ON "profiles" ("gender", "date_of_birth");

-- Profiles: verified filter
CREATE INDEX IF NOT EXISTS "profiles_is_verified_idx"
  ON "profiles" ("is_verified");

-- Swipes: received likes lookup (used in "likes you" feature)
CREATE INDEX IF NOT EXISTS "swipes_swiped_id_action_created_at_idx"
  ON "swipes" ("swiped_id", "action", "created_at" DESC);
