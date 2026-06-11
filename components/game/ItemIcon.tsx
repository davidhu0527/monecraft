import { itemIconUrl } from "@/lib/ui/sprites";
import type { InventorySlot } from "@/lib/game/types";

type ItemIconProps = {
  slot: InventorySlot;
  /** Rendered icon size in CSS pixels (integer multiple of 16 stays crisp). */
  size?: number;
};

/**
 * A slot's pixel-art icon with the Minecraft-style count overlay and
 * durability bar. Renders nothing for empty slots so the slot well shows.
 */
export default function ItemIcon({ slot, size = 32 }: ItemIconProps) {
  if (!slot.id || slot.count <= 0) return null;

  const durabilityRatio =
    slot.maxDurability && slot.durability !== undefined ? Math.max(0, Math.min(1, slot.durability / slot.maxDurability)) : null;
  // Green at full, red when nearly broken — only shown once worn.
  const durabilityHue = durabilityRatio !== null ? Math.round(durabilityRatio * 120) : 0;

  return (
    <span className="item-icon" style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny generated data URL; next/image cannot optimize it */}
      <img src={itemIconUrl(slot.id)} alt={slot.label} draggable={false} width={size} height={size} />
      {durabilityRatio !== null && durabilityRatio < 1 && (
        <span className="item-icon-durability">
          <span
            className="item-icon-durability-fill"
            style={{ width: `${Math.round(durabilityRatio * 100)}%`, background: `hsl(${durabilityHue}, 90%, 45%)` }}
          />
        </span>
      )}
      {slot.count > 1 && <span className="item-icon-count">{slot.count}</span>}
    </span>
  );
}
