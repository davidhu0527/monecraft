import type { ReactNode } from "react";

type MenuScreenProps = {
  title: string;
  children: ReactNode;
};

/** The shared full-screen frame for the profile/world menus: logo, title, panel. */
export default function MenuScreen({ title, children }: MenuScreenProps) {
  return (
    <div className="menu-screen">
      <div className="menu-panel">
        <div className="menu-logo">Monecraft</div>
        <div className="menu-title">{title}</div>
        {children}
      </div>
    </div>
  );
}
