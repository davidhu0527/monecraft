import "./base.css";
import "./hud.css";
import "./ui.css";
import "./menu.css";
import "./touch.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import { pixelFont } from "./fonts";

export const metadata: Metadata = {
  title: "Monecraft",
  description: "Minecraft-like game built with Next.js + Three.js"
};

export const viewport: Viewport = {
  themeColor: "#2a2d3a",
  width: "device-width",
  initialScale: 1,
  // A game surface: pinch/double-tap zoom would fight the touch controls
  // (iOS also needs the touch-action CSS in base.css — it ignores this alone).
  userScalable: false,
  // Extend under notches; safe-area-inset vars pad the HUD back out.
  viewportFit: "cover",
  // The soft keyboard (chat, anvil rename) resizes the layout instead of
  // covering the input.
  interactiveWidget: "resizes-content"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={pixelFont.variable}>
      <body>
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}
