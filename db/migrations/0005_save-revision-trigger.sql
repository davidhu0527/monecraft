-- Make the database own the save_revision increment.
--
-- 0004 split the cursor out of updated_at, but left the +1 to application code
-- (putSaveBlob and the game server's storeWorld). That is not deploy-safe: after
-- 0004 runs, an OLD web build still serving would update save_blob WITHOUT
-- bumping save_revision, so another device sees an unchanged revision and misses
-- the write — and an old first-upload could leave save_blob non-null at revision
-- 0, which a new client then treats as "never saved" and overwrites.
--
-- A BEFORE UPDATE trigger moves the increment onto the row, so EVERY writer — new
-- build, old build mid-deploy, the game server — bumps it correctly, and the web
-- and game-server deploys no longer have to be same-SHA for this column. It also
-- makes the "rename does not bump" rule structural rather than by-omission: a
-- rename changes name/updated_at but not save_blob, so IS DISTINCT FROM is false
-- and the ELSE pins the revision to its old value. IS DISTINCT FROM (not =) so a
-- first upload (NULL -> blob) counts as a change and bumps 0 -> 1. The ELSE makes
-- the column fully DB-owned: a metadata-only UPDATE can't carry a caller-supplied
-- save_revision past the trigger.
CREATE FUNCTION bump_save_revision() RETURNS trigger AS $$
BEGIN
  IF NEW.save_blob IS DISTINCT FROM OLD.save_blob THEN
    NEW.save_revision := OLD.save_revision + 1;
  ELSE
    NEW.save_revision := OLD.save_revision;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER worlds_bump_save_revision
  BEFORE UPDATE ON "worlds"
  FOR EACH ROW EXECUTE FUNCTION bump_save_revision();
