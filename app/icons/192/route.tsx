import { ImageResponse } from "next/og";
import { AppIcon } from "@/lib/ui/appIcon";

export const dynamic = "force-static";

export function GET() {
  return new ImageResponse(<AppIcon />, { width: 192, height: 192 });
}
