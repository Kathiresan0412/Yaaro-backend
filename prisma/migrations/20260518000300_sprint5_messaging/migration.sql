-- Sprint 5 messaging support.
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'photo';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'gif';

ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "reactions" JSONB,
  ADD COLUMN IF NOT EXISTS "reported_at" TIMESTAMP(0),
  ADD COLUMN IF NOT EXISTS "reported_by_id" BIGINT,
  ADD COLUMN IF NOT EXISTS "report_reason" VARCHAR(120);
