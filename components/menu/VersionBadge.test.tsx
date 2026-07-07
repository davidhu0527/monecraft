import { afterEach, describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import VersionBadge from "@/components/menu/VersionBadge";

// The badge reads the build-time NEXT_PUBLIC_* constants. Next inlines them at
// build; under `bun test` they're plain runtime env reads, so we set them here.
const origVersion = process.env.NEXT_PUBLIC_APP_VERSION;
const origSha = process.env.NEXT_PUBLIC_COMMIT_SHA;

afterEach(() => {
  if (origVersion === undefined) delete process.env.NEXT_PUBLIC_APP_VERSION;
  else process.env.NEXT_PUBLIC_APP_VERSION = origVersion;
  if (origSha === undefined) delete process.env.NEXT_PUBLIC_COMMIT_SHA;
  else process.env.NEXT_PUBLIC_COMMIT_SHA = origSha;
});

describe("VersionBadge", () => {
  test("shows version + short SHA, linking to the commit when a SHA is present", () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "0.15.0";
    process.env.NEXT_PUBLIC_COMMIT_SHA = "3e24f3907e7bc5f8776a89d711812b12bd0d08f4";

    render(<VersionBadge />);
    const badge = screen.getByTestId("version-badge");

    expect(badge.textContent).toBe("v0.15.0 · 3e24f39");
    expect(badge.tagName).toBe("A");
    expect(badge.getAttribute("href")).toBe("https://github.com/hutusi/monecraft/commit/3e24f3907e7bc5f8776a89d711812b12bd0d08f4");
    expect(badge.getAttribute("rel")).toBe("noopener noreferrer");
  });

  test("falls back to 'dev' and renders no link when there's no SHA (local build)", () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "0.15.0";
    delete process.env.NEXT_PUBLIC_COMMIT_SHA;

    render(<VersionBadge />);
    const badge = screen.getByTestId("version-badge");

    expect(badge.textContent).toBe("v0.15.0 · dev");
    expect(badge.tagName).toBe("SPAN");
  });
});
