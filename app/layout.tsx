import "./base.css";
import "./hud.css";
import "./ui.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pixelFont } from "./fonts";

export const metadata: Metadata = {
  title: "Minecraft Clone",
  description: "Minecraft-like game built with Next.js + Three.js"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={pixelFont.variable}>
      <body>{children}</body>
    </html>
  );
}
