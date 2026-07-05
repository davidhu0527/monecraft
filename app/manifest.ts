import type { MetadataRoute } from "next";

// theme/background match the menu gate's gradient (menu.css .menu-screen) —
// the first frame every visitor sees, so the install splash blends into it.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Monecraft",
    short_name: "Monecraft",
    description: "A Minecraft-inspired voxel game that runs entirely in your browser.",
    id: "/",
    start_url: "/",
    display: "standalone",
    orientation: "landscape",
    theme_color: "#2a2d3a",
    background_color: "#15171f",
    // File-convention icons (app/icon.tsx) don't auto-wire into the manifest,
    // so the installable sizes are explicit route handlers under /icons.
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  };
}
