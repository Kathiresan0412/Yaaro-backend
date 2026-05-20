ALTER TABLE "user_profiles"
ADD COLUMN IF NOT EXISTS "spotify_preview_url" VARCHAR(500),
ADD COLUMN IF NOT EXISTS "spotify_album_art_url" VARCHAR(500);

CREATE TABLE IF NOT EXISTS "mbti_quiz_questions" (
  "id" BIGSERIAL PRIMARY KEY,
  "prompt" VARCHAR(255) NOT NULL,
  "dimension" VARCHAR(2) NOT NULL,
  "yes_value" VARCHAR(1) NOT NULL,
  "no_value" VARCHAR(1) NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "mbti_quiz_questions_is_active_sort_order_idx"
ON "mbti_quiz_questions"("is_active", "sort_order");

CREATE TABLE IF NOT EXISTS "mbti_quiz_answers" (
  "id" BIGSERIAL PRIMARY KEY,
  "user_id" BIGINT NOT NULL,
  "question_id" BIGINT NOT NULL,
  "answer" BOOLEAN NOT NULL,
  "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mbti_quiz_answers_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mbti_quiz_answers_question_id_fkey"
    FOREIGN KEY ("question_id") REFERENCES "mbti_quiz_questions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "mbti_quiz_answers_user_id_created_at_idx"
ON "mbti_quiz_answers"("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "mbti_quiz_answers_question_id_idx"
ON "mbti_quiz_answers"("question_id");

CREATE TABLE IF NOT EXISTS "profile_views" (
  "id" BIGSERIAL PRIMARY KEY,
  "viewer_id" BIGINT,
  "viewed_id" BIGINT NOT NULL,
  "source" VARCHAR(40) NOT NULL DEFAULT 'profile',
  "viewed_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "profile_views_viewer_id_fkey"
    FOREIGN KEY ("viewer_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "profile_views_viewed_id_fkey"
    FOREIGN KEY ("viewed_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "profile_views_viewed_id_viewed_at_idx"
ON "profile_views"("viewed_id", "viewed_at");

CREATE INDEX IF NOT EXISTS "profile_views_viewer_id_viewed_at_idx"
ON "profile_views"("viewer_id", "viewed_at");

CREATE TABLE IF NOT EXISTS "double_date_pairs" (
  "id" BIGSERIAL PRIMARY KEY,
  "owner_id" BIGINT NOT NULL,
  "partner_id" BIGINT,
  "title" VARCHAR(120),
  "activity" VARCHAR(160),
  "city" VARCHAR(120),
  "availability" VARCHAR(160),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "double_date_pairs_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "double_date_pairs_partner_id_fkey"
    FOREIGN KEY ("partner_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "double_date_pairs_owner_id_idx"
ON "double_date_pairs"("owner_id");

CREATE INDEX IF NOT EXISTS "double_date_pairs_partner_id_idx"
ON "double_date_pairs"("partner_id");

CREATE INDEX IF NOT EXISTS "double_date_pairs_is_active_city_idx"
ON "double_date_pairs"("is_active", "city");

CREATE TABLE IF NOT EXISTS "double_date_requests" (
  "id" BIGSERIAL PRIMARY KEY,
  "sender_pair_id" BIGINT NOT NULL,
  "receiver_pair_id" BIGINT NOT NULL,
  "sender_id" BIGINT NOT NULL,
  "receiver_id" BIGINT NOT NULL,
  "message" VARCHAR(240),
  "status" VARCHAR(40) NOT NULL DEFAULT 'pending',
  "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "responded_at" TIMESTAMP(0),
  CONSTRAINT "double_date_requests_sender_pair_id_fkey"
    FOREIGN KEY ("sender_pair_id") REFERENCES "double_date_pairs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "double_date_requests_receiver_pair_id_fkey"
    FOREIGN KEY ("receiver_pair_id") REFERENCES "double_date_pairs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "double_date_requests_sender_id_fkey"
    FOREIGN KEY ("sender_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "double_date_requests_receiver_id_fkey"
    FOREIGN KEY ("receiver_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "double_date_requests_sender_pair_id_receiver_pair_id_key"
ON "double_date_requests"("sender_pair_id", "receiver_pair_id");

CREATE INDEX IF NOT EXISTS "double_date_requests_receiver_id_status_idx"
ON "double_date_requests"("receiver_id", "status");

CREATE INDEX IF NOT EXISTS "double_date_requests_sender_id_status_idx"
ON "double_date_requests"("sender_id", "status");

INSERT INTO "mbti_quiz_questions" ("prompt", "dimension", "yes_value", "no_value", "sort_order")
VALUES
  ('After a long week, do you recharge best by being around people?', 'EI', 'E', 'I', 1),
  ('Do group settings usually energize you more than solo time?', 'EI', 'E', 'I', 2),
  ('Would you rather talk through an idea than sit with it privately first?', 'EI', 'E', 'I', 3),
  ('Do you enjoy meeting new people without much advance planning?', 'EI', 'E', 'I', 4),
  ('Do you tend to think out loud when making decisions?', 'EI', 'E', 'I', 5),
  ('Do you prefer concrete facts over abstract possibilities?', 'SN', 'S', 'N', 6),
  ('Do practical details matter more to you than big-picture theories?', 'SN', 'S', 'N', 7),
  ('Do you trust experience more than a hunch?', 'SN', 'S', 'N', 8),
  ('Do you like instructions to be specific and step by step?', 'SN', 'S', 'N', 9),
  ('Do you notice small changes in your surroundings quickly?', 'SN', 'S', 'N', 10),
  ('When choices are hard, do you prioritize logic over feelings?', 'TF', 'T', 'F', 11),
  ('Is direct honesty usually kinder than softening the message?', 'TF', 'T', 'F', 12),
  ('Do you enjoy debating ideas even when people disagree?', 'TF', 'T', 'F', 13),
  ('Do you usually separate emotions from decisions?', 'TF', 'T', 'F', 14),
  ('Do you value fairness over making everyone comfortable?', 'TF', 'T', 'F', 15),
  ('Do you prefer plans and structure over spontaneity?', 'JP', 'J', 'P', 16),
  ('Do you like deciding early instead of keeping options open?', 'JP', 'J', 'P', 17),
  ('Do deadlines help you feel calm and focused?', 'JP', 'J', 'P', 18),
  ('Is a tidy schedule more relaxing than a flexible one?', 'JP', 'J', 'P', 19),
  ('Do you usually finish one thing before starting another?', 'JP', 'J', 'P', 20)
ON CONFLICT DO NOTHING;
