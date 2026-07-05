import { ImageResponse } from "next/og";
import { AppIcon } from "@/lib/ui/appIcon";

export const dynamic = "force-static";

// Maskable icons get cropped to arbitrary shapes; keep the art inside the
// safe zone on a full-bleed menu-gate background. The scale must land the art
// on a multiple of the 8-cell grid (512 * 0.625 = 320 → 40px cells) or the
// fractional cell edges antialias into visible seams.
export function GET() {
  return new ImageResponse(<AppIcon scale={0.625} background="#15171f" />, { width: 512, height: 512 });
}
