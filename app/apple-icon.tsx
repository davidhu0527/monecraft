import { ImageResponse } from "next/og";
import { AppIcon } from "@/lib/ui/appIcon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS rounds the corners itself and dislikes transparency, so the art sits on
// the menu-gate background color. 180 * 0.8 = 144 keeps the cells on whole
// pixels (see the maskable route for the seam artifact this avoids).
export default function AppleIcon() {
  return new ImageResponse(<AppIcon scale={0.8} background="#15171f" />, size);
}
