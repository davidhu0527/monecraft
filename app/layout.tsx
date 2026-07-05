import "./base.css";
import "./hud.css";
import "./ui.css";
import "./menu.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import { pixelFont } from "./fonts";

export const metadata: Metadata = {
  title: "Monecraft",
  description: "Minecraft-like game built with Next.js + Three.js"
};

export const viewport: Viewport = {
  themeColor: "#2a2d3a"
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
