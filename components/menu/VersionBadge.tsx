/**
 * A muted build-identity badge in the corner of the menu: the app version plus
 * the short commit SHA of the deployed build, so any deployed build is
 * identifiable at a glance. Both values are injected at build time by
 * `next.config.mjs` — `NEXT_PUBLIC_APP_VERSION` from package.json,
 * `NEXT_PUBLIC_COMMIT_SHA` from Vercel's `VERCEL_GIT_COMMIT_SHA`. Locally the SHA
 * is empty, so the badge reads "… · dev". With a SHA it links to the commit.
 */
export default function VersionBadge() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "";
  const fullSha = process.env.NEXT_PUBLIC_COMMIT_SHA ?? "";
  const shortSha = fullSha.slice(0, 7);

  const label = [version ? `v${version}` : null, shortSha || "dev"].filter(Boolean).join(" · ");

  if (fullSha) {
    return (
      <a
        className="menu-version"
        href={`https://github.com/hutusi/monecraft/commit/${fullSha}`}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="version-badge"
      >
        {label}
      </a>
    );
  }

  return (
    <span className="menu-version" data-testid="version-badge">
      {label}
    </span>
  );
}
