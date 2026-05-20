CREATE TABLE "analytics_events" (
  "id" BIGSERIAL PRIMARY KEY,
  "user_id" BIGINT NULL,
  "event_name" VARCHAR(80) NOT NULL,
  "properties" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "url" VARCHAR(500) NULL,
  "referrer" VARCHAR(500) NULL,
  "user_agent" VARCHAR(500) NULL,
  "created_at" TIMESTAMP(0) NOT NULL DEFAULT NOW(),
  CONSTRAINT "analytics_events_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "analytics_events_event_name_idx" ON "analytics_events"("event_name");
CREATE INDEX "analytics_events_user_id_idx" ON "analytics_events"("user_id");
CREATE INDEX "analytics_events_created_at_idx" ON "analytics_events"("created_at");
