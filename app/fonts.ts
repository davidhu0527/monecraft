import { Pixelify_Sans } from "next/font/google";

/**
 * Authentic Minecraft-style pixel font. Pixelify Sans is a true pixel typeface
 * that stays legible at the 10-15px HUD sizes (where Silkscreen muddies and
 * VT323 reads more "DOS" than Minecraft). next/font self-hosts the woff2 at
 * build time — no runtime Google request — and exposes it as the --mc-font CSS
 * variable consumed by base.css. The fallback keeps the old monospace stack so
 * text still renders before the font loads or if it fails to fetch.
 *
 * This bundled font file is the one deliberate exception to the project's
 * zero-binary-asset rule (see AGENTS.md).
 */
export const pixelFont = Pixelify_Sans({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
  variable: "--mc-font",
  fallback: ["Lucida Console", "Monaco", "Courier New", "monospace"]
});
