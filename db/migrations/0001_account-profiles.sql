CREATE TABLE "profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"skin_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "worlds" ADD COLUMN "profile_id" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worlds" ADD CONSTRAINT "worlds_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Backfill: give every non-guest account a default profile (from its name +
-- skin) and hand its existing worlds to that profile, so nothing is orphaned
-- once the UI scopes online worlds by profile. Anonymous guests are skipped —
-- that layer is being retired and their throwaway worlds are not carried over.
INSERT INTO "profiles" ("id", "owner_id", "name", "skin_id", "created_at")
SELECT gen_random_uuid(), "id", "name", "skin_id", now() FROM "user" WHERE "is_anonymous" IS NOT TRUE;--> statement-breakpoint
UPDATE "worlds" w SET "profile_id" = p."id" FROM "profiles" p WHERE p."owner_id" = w."owner_id" AND w."profile_id" IS NULL;