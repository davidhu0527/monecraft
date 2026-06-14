/* eslint-disable @eslint-react/no-array-index-key -- the hotbar is a fixed-length, positional array of slots that never reorders, so the slot index is its stable identity */
import ItemIcon from "@/components/game/ItemIcon";
import { itemTooltipFor, useItemTooltip } from "@/components/game/ItemTooltip";
import type { InventorySlot } from "@/lib/game/types";

type HotbarProps = {
  inventory: InventorySlot[];
  selectedSlot: number;
  hotbarSlots: number;
  onSelectSlot: (index: number) => void;
};

/**
 * The Minecraft hotbar: 9 dark translucent slots with a white outline on the
 * selection and the selected item's name fading in above the bar. The name is
 * keyed on the selection so every change remounts it and replays the CSS
 * fade-in/fade-out animation — no timers or state.
 */
export default function Hotbar({ inventory, selectedSlot, hotbarSlots, onSelectSlot }: HotbarProps) {
  const visible = inventory.slice(0, hotbarSlots);
  const selected = visible[selectedSlot];
  const selectedLabel = selected?.id && selected.count > 0 ? selected.label : "";
  const { tooltip, bind } = useItemTooltip();

  return (
    <div className="hotbar-area">
      {selectedLabel && (
        <div key={`${selectedSlot}:${selectedLabel}`} className="hotbar-item-name">
          {selectedLabel}
        </div>
      )}
      <div className="hotbar" data-testid="hotbar">
        {visible.map((slot, idx) => (
          <button
            key={`hotbar-${idx}`}
            className={idx === selectedSlot ? "hotbar-slot active" : "hotbar-slot"}
            onClick={() => onSelectSlot(idx)}
            aria-label={slot.id && slot.count > 0 ? `Slot ${idx + 1}: ${slot.label}` : `Slot ${idx + 1}: empty`}
            {...bind(itemTooltipFor(slot))}
          >
            <ItemIcon slot={slot} size={32} />
          </button>
        ))}
      </div>
      {tooltip}
    </div>
  );
}
