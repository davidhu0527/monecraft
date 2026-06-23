import PixelImg from "@/components/game/PixelImg";
import { hudIconUrl } from "@/lib/ui/sprites";
import type { HudIconName } from "@/lib/ui/hudPixels";
import type { EffectId } from "@/lib/game/types";

type ActiveEffect = { id: EffectId; seconds: number };

type ActiveEffectsProps = {
  effects: ActiveEffect[];
};

const ICON_SIZE = 22;

const EFFECT_ICONS: Record<EffectId, HudIconName> = {
  speed: "effect_speed",
  strength: "effect_strength",
  regeneration: "effect_regeneration",
  fire_resistance: "effect_fire_resistance",
  water_breathing: "effect_water_breathing",
  poison: "effect_poison"
};

const EFFECT_LABELS: Record<EffectId, string> = {
  speed: "Swiftness",
  strength: "Strength",
  regeneration: "Regeneration",
  fire_resistance: "Fire Resistance",
  water_breathing: "Water Breathing",
  poison: "Poison"
};

/** Minecraft-style m:ss countdown (e.g. 2:05). */
function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

/**
 * The active status-effect readout: a stacked column of icon + countdown chips
 * in the top-left, opposite the minimap. Hidden entirely when nothing is active.
 */
export default function ActiveEffects({ effects }: ActiveEffectsProps) {
  if (effects.length === 0) return null;
  return (
    <div className="active-effects" role="list" aria-label="Active effects">
      {effects.map((effect) => (
        <div key={effect.id} className="active-effect" role="listitem" aria-label={`${EFFECT_LABELS[effect.id]}: ${formatDuration(effect.seconds)}`}>
          <PixelImg src={hudIconUrl(EFFECT_ICONS[effect.id])} alt="" size={ICON_SIZE} aria-hidden />
          <span className="active-effect-time">{formatDuration(effect.seconds)}</span>
        </div>
      ))}
    </div>
  );
}
