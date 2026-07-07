# Releasing a version

Monecraft releases are cut **by hand** — there is no release automation. A release
is a single `chore(release): vX.Y.Z` commit on `main` plus a matching git tag.

## The invariant: three things stay in lockstep

```text
package.json "version"   ⇔   newest  git tag vX.Y.Z   ⇔   top dated ## [X.Y.Z] in CHANGELOG.md
```

If any of the three lags the others, something is wrong: the [menu version
badge](../components/menu/VersionBadge.tsx) reads `package.json`, the README release
badge reads the newest git tag, and the changelog is the human record. They drifted
once — `0.15.0` was tagged and written to the changelog but `package.json` was left
at `0.14.0` because the release commit only edited `CHANGELOG.md`. This checklist
exists so that can't happen again.

## Checklist

1. **Pick the version** `X.Y.Z` (semver). The accumulated `## [Unreleased]` entries
   tell you whether it's a patch, minor, or major.
2. **Bump `package.json`** `"version"` to `X.Y.Z`. ← _the easy step to forget._ The
   version badge reads this; if you skip it the deployed build shows the wrong
   version.
3. **Roll the changelog**: rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD`
   (today's date) and add a fresh, empty `## [Unreleased]` above it.
4. **Verify the gate is green** (the same list CI runs): `bun run lint`,
   `bun run typecheck`, `bun test`, `bun run format:check`, `bun run build` — plus
   `bun run test:e2e` if the release includes renderer/input/shell changes.
5. **Commit**: `chore(release): vX.Y.Z`, with a body summarizing the release's
   headline work (see the `v0.15.0` commit for the house style).
6. **Tag it**: `git tag vX.Y.Z`. The tag must match `package.json` exactly — the
   README release badge and the release history read it.
7. **Push**: `git push && git push --tags`. Pushing `main` triggers the Vercel
   production deploy; once it's live the menu badge reads `vX.Y.Z · <sha>`.

## After it's live

Confirm the version badge in the bottom-right of the menu on production reads
`vX.Y.Z · <sha>` — that's the end-to-end proof that `package.json`, the build, and
the deploy all agree.
