import PixelImg from "@/components/game/PixelImg";
import { hudIconUrl } from "@/lib/ui/sprites";

type StatusBarsProps = {
  hearts: number;
  maxHearts: number;
  hunger: number;
  maxHunger: number;
  armorPoints: number;
};

const ICON_SIZE = 18;

type IconKind = "heart" | "hunger" | "armor";

/** Icon states for a 10-icon Minecraft bar: each icon covers 2 points. */
export function iconStates(value: number, max: number): Array<"full" | "half" | "container"> {
  const icons = Math.ceil(max / 2);
  return Array.from({ length: icons }, (_, i) => {
    if (value >= i * 2 + 2) return "full";
    if (value === i * 2 + 1) return "half";
    return "container";
  });
}

function IconRow({ kind, value, max, label, reversed }: { kind: IconKind; value: number; max: number; label: string; reversed?: boolean }) {
  const states = iconStates(value, max);
  return (
    <div
      className={reversed ? "status-icon-row reversed" : "status-icon-row"}
      role="meter"
      aria-label={`${label}: ${value}/${max}`}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      {states.map((state, i) => (
        <span key={`${kind}-${i}`} data-icon={`${kind}_${state}`}>
          <PixelImg src={hudIconUrl(`${kind}_${state}`)} alt="" size={ICON_SIZE} aria-hidden />
        </span>
      ))}
    </div>
  );
}

/**
 * The Minecraft status rows above the hotbar: hearts on the left, hunger on
 * the right (filling right-to-left), and an armor row over the hearts that
 * only appears once something is equipped.
 */
export default function StatusBars({ hearts, maxHearts, hunger, maxHunger, armorPoints }: StatusBarsProps) {
  return (
    <div className="status-bars">
      <div className="status-bars-left">
        {armorPoints > 0 && <IconRow kind="armor" value={armorPoints} max={20} label="Armor" />}
        <IconRow kind="heart" value={Math.max(0, Math.round(hearts))} max={maxHearts} label="Health" />
      </div>
      <div className="status-bars-right">
        <IconRow kind="hunger" value={Math.max(0, Math.round(hunger))} max={maxHunger} label="Hunger" reversed />
      </div>
    </div>
  );
}
