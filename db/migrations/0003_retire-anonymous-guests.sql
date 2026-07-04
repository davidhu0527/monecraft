-- The anonymous-guest layer is retired: online play is accounts-only. Guest
-- users were cookie-bound throwaway identities; delete them before dropping
-- the flag, and let the FKs cascade their sessions, accounts, worlds (and
-- those worlds' members/invites/save blobs), memberships, and invites.
-- Deploy order: ship the app build that no longer selects "is_anonymous"
-- FIRST, then run this migration (an old build would error on the missing
-- column; the new build simply ignores it until the migration runs).
DELETE FROM "user" WHERE "is_anonymous" IS TRUE;--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "is_anonymous";
