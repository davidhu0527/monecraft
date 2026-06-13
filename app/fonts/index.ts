import localFont from "next/font/local";

/**
 * Monocraft — an open-source pixel font modeled on the Minecraft typeface, the
 * closest faithful match to the real game's text. Self-hosted via next/font
 * from the committed woff2 (no runtime request, and no build-time network
 * fetch), exposed as the --mc-font CSS variable consumed by base.css. The
 * fallback keeps the old monospace stack so text renders if the font fails.
 *
 * This bundled font is the one deliberate exception to the zero-binary-asset
 * rule (see AGENTS.md). Monocraft is licensed under the SIL Open Font License
 * 1.1 — the full license is kept alongside the font in ./OFL.txt. Its coding
 * ligatures (-> => >= ...) are disabled in base.css so UI text stays literal.
 */
export const pixelFont = localFont({
  src: "./Monocraft.woff2",
  display: "swap",
  weight: "400",
  variable: "--mc-font",
  fallback: ["Lucida Console", "Monaco", "Courier New", "monospace"]
});
