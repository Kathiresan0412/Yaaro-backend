-- AlterTable
ALTER TABLE "users" ADD COLUMN     "password_hash" VARCHAR(255),
ADD COLUMN     "password_updated_at" TIMESTAMP(0);
