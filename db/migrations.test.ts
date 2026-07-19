import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";

/**
 * The committed migrations are what production actually runs — every other test
 * builds its schema from `db/ddl.ts` instead, so a migration can be wrong while
 * the whole suite stays green and only prod breaks. This exercises the real
 * path: apply them in order onto an empty database.
 */

const migrationFiles = (): string[] =>
  readdirSync("db/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort();

async function applyMigration(pg: PGlite, file: string): Promise<void> {
  for (const statement of readFileSync(`db/migrations/${file}`, "utf8").split("--> statement-breakpoint")) {
    if (statement.trim()) await pg.exec(statement);
  }
}

test("every committed migration applies in order onto an empty database", async () => {
  const pg = new PGlite();
  for (const file of migrationFiles()) await applyMigration(pg, file);
  await pg.close();
});

// The backfill is the one hand-written line in 0004 (the ALTER is generated), so
// it is the one that can be wrong.
test("0004 backfills a save revision onto worlds that already hold a blob", async () => {
  const pg = new PGlite();
  const files = migrationFiles();
  const target = files.find((f) => f.startsWith("0004"))!;
  for (const file of files.slice(0, files.indexOf(target))) await applyMigration(pg, file);

  await pg.exec(`INSERT INTO "user" (id, name, email) VALUES ('u1','u','u@e.com');`);
  await pg.exec(`
    INSERT INTO worlds (id, owner_id, kind, name, seed, worldgen_version, save_blob) VALUES
      ('saved',   'u1', 'sp-cloud', 'Saved',   1, 12, '\\x1f8b'::bytea),
      ('unsaved', 'u1', 'sp-cloud', 'Unsaved', 1, 12, NULL);
  `);

  await applyMigration(pg, target);

  // A world already holding a blob must not read as never-saved: revision 0 is
  // what putSaveBlob accepts a first upload against, so leaving it there would
  // let a device with no cursor clobber a real save.
  const rows = (await pg.query<{ id: string; save_revision: number }>("SELECT id, save_revision FROM worlds ORDER BY id")).rows;
  expect(rows).toEqual([
    { id: "saved", save_revision: 1 },
    { id: "unsaved", save_revision: 0 }
  ]);
  await pg.close();
});

// 0005 moves the save_revision increment onto a DB trigger so ANY writer bumps
// it — the whole point is that a build which doesn't set save_revision (an old
// web build mid-deploy) still gets a correct increment. The test therefore does
// OLD-STYLE updates (save_blob only, no save_revision) and checks the row.
test("0005 trigger bumps save_revision on any blob change, and only on a blob change", async () => {
  const pg = new PGlite();
  for (const file of migrationFiles()) await applyMigration(pg, file);

  await pg.exec(`INSERT INTO "user" (id, name, email) VALUES ('u1','u','u@e.com');`);
  await pg.exec(`INSERT INTO worlds (id, owner_id, kind, name, seed, worldgen_version) VALUES ('w','u1','sp-cloud','W',1,12);`);
  const revision = async () => (await pg.query<{ save_revision: number }>("SELECT save_revision FROM worlds WHERE id='w'")).rows[0].save_revision;
  expect(await revision()).toBe(0); // never saved

  // A first upload the OLD way: sets save_blob but not save_revision.
  await pg.exec(`UPDATE worlds SET save_blob = '\\x01'::bytea, updated_at = now() WHERE id='w';`);
  expect(await revision()).toBe(1); // NULL -> blob is a change (IS DISTINCT FROM), so 0 -> 1

  await pg.exec(`UPDATE worlds SET save_blob = '\\x02'::bytea WHERE id='w';`);
  expect(await revision()).toBe(2); // a different blob bumps

  // A rename touches name/updated_at but not save_blob → must NOT bump the cursor.
  await pg.exec(`UPDATE worlds SET name = 'Renamed', updated_at = now() WHERE id='w';`);
  expect(await revision()).toBe(2);

  // A byte-identical re-upload is a no-op — nothing changed, so no bump.
  await pg.exec(`UPDATE worlds SET save_blob = '\\x02'::bytea, updated_at = now() WHERE id='w';`);
  expect(await revision()).toBe(2);

  // The ELSE branch: a metadata update that TRIES to set save_revision itself
  // (no blob change) can't move it — the column is fully DB-owned, so a stray or
  // hostile write can't desync the cursor.
  await pg.exec(`UPDATE worlds SET name = 'X', save_revision = 999 WHERE id='w';`);
  expect(await revision()).toBe(2);

  await pg.close();
});
