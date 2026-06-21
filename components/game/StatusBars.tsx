/* eslint-disable @eslint-react/no-array-index-key -- each status bar is a fixed-length, positional row of icons that never reorders, so the icon index is its stable identity */
import PixelImg from "@/components/game/PixelImg";
import { hudIconUrl } from "@/lib/ui/sprites";

type StatusBarsProps = {
  hearts: number;
  maxHearts: number;
  hunger: number;
  maxHunger: number;
  armorPoints: number;
  oxygen: number;
  maxOxygen: number;
  /** Hardcore world — draws the hearts in the withered dark-red variant. */
  hardcore: boolean;
};

const ICON_SIZE = 18;

type IconKind = "heart" | "hunger" | "armor" | "bubble";
/** Sprite prefix for an icon row; usually the kind, but hearts switch to the withered variant in hardcore. */
type IconSprite = IconKind | "heart_hardcore";

/** Icon states for a 10-icon Minecraft bar: each icon covers 2 points. */
export function iconStates(value: number, max: number): Array<"full" | "half" | "container"> {
  const icons = Math.ceil(max / 2);
  return Array.from({ length: icons }, (_, i) => {
    if (value >= i * 2 + 2) return "full";
    if (value === i * 2 + 1) return "half";
    return "container";
  });
}

function IconRow({
  kind,
  value,
  max,
  label,
  reversed,
  sprite
}: {
  kind: IconKind;
  value: number;
  max: number;
  label: string;
  reversed?: boolean;
  sprite?: IconSprite;
}) {
  const states = iconStates(value, max);
  const spriteKind = sprite ?? kind;
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
        <span key={`${kind}-${i}`} data-icon={`${spriteKind}_${state}`}>
          <PixelImg src={hudIconUrl(`${spriteKind}_${state}`)} alt="" size={ICON_SIZE} aria-hidden />
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
export default function StatusBars({ hearts, maxHearts, hunger, maxHunger, armorPoints, oxygen, maxOxygen, hardcore }: StatusBarsProps) {
  // Round up so the last sliver of air still shows a bubble until truly empty.
  const oxygenIcons = Math.ceil(Math.max(0, Math.min(oxygen, maxOxygen)));
  return (
    <div className="status-bars">
      <div className="status-bars-left">
        {armorPoints > 0 && <IconRow kind="armor" value={armorPoints} max={20} label="Armor" />}
        <IconRow kind="heart" value={Math.max(0, Math.round(hearts))} max={maxHearts} label="Health" sprite={hardcore ? "heart_hardcore" : "heart"} />
      </div>
      <div className="status-bars-right">
        {oxygen < maxOxygen && <IconRow kind="bubble" value={oxygenIcons} max={maxOxygen} label="Air" reversed />}
        <IconRow kind="hunger" value={Math.max(0, Math.round(hunger))} max={maxHunger} label="Hunger" reversed />
      </div>
    </div>
  );
}
