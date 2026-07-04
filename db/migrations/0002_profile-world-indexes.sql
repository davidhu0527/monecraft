CREATE INDEX "profiles_owner_idx" ON "profiles" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "worlds_profile_idx" ON "worlds" USING btree ("profile_id");