-- Add firebase_uid column to users table for Firebase Auth integration
ALTER TABLE "users" ADD COLUMN "firebase_uid" VARCHAR(128);

-- Create unique index on firebase_uid
CREATE UNIQUE INDEX "users_firebase_uid_key" ON "users"("firebase_uid");

-- Create regular index for lookups
CREATE INDEX "users_firebase_uid_idx" ON "users"("firebase_uid");
