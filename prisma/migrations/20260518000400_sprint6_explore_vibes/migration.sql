CREATE TABLE "vibe_responses" (
  "id" BIGSERIAL PRIMARY KEY,
  "user_id" BIGINT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "question_id" VARCHAR(80) NOT NULL,
  "answer" VARCHAR(120) NOT NULL,
  "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "vibe_responses_user_id_question_id_key"
  ON "vibe_responses"("user_id", "question_id");

CREATE INDEX "vibe_responses_question_id_answer_idx"
  ON "vibe_responses"("question_id", "answer");

CREATE INDEX "vibe_responses_created_at_idx"
  ON "vibe_responses"("created_at");
