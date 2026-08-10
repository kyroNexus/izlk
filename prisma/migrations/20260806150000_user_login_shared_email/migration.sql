-- A shared department mailbox is allowed, but each employee must sign in with
-- their own unique login to preserve their role, notifications and audit trail.
ALTER TABLE "User" ADD COLUMN "login" TEXT;

UPDATE "User"
SET "login" = "email"
WHERE "login" IS NULL;

ALTER TABLE "User" ALTER COLUMN "login" SET NOT NULL;

CREATE UNIQUE INDEX "User_login_key" ON "User"("login");
DROP INDEX "User_email_key";
