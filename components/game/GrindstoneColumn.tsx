import ItemIcon from "@/components/game/ItemIcon";
import { ENCHANTMENT_DEFS, enchantLevel } from "@/lib/game/enchantments";
import { canStripEnchantments, enchantRefund } from "@/lib/game/grindstone";
import { displayName } from "@/lib/game/items";
import type { InventorySlot } from "@/lib/game/types";

type GrindstoneColumnProps = {
  /** The selected hotbar item to disenchant (or undefined/empty). */
  item: InventorySlot | undefined;
  onStrip: () => void;
};

const ROMAN = ["", "I", "II", "III", "IV", "V"];

/**
 * The grindstone panel (replaces the recipe book while a grindstone is open):
 * strips every enchantment off the selected hotbar gear, refunding XP. Mirrors
 * the enchanting/anvil panels — it acts on whichever hotbar slot is selected.
 */
export default function GrindstoneColumn({ item, onStrip }: GrindstoneColumnProps) {
  const strippable = canStripEnchantments(item);

  if (!item || !strippable) {
    return (
      <div className="anvil-column">
        <div className="inventory-heading">Grindstone</div>
        <div className="enchanting-hint">Select an enchanted tool, weapon, or armor in the hotbar to remove its enchantments for XP.</div>
      </div>
    );
  }

  const refund = enchantRefund(item);

  return (
    <div className="anvil-column">
      <div className="inventory-heading">Grindstone</div>
      <div className="enchanting-item">
        <ItemIcon slot={item} size={32} />
        <span>{displayName(item)}</span>
      </div>
      <div className="enchanting-cost">Removing returns +{refund} XP</div>
      <div className="anvil-actions">
        <div className="grindstone-enchants">
          {item.enchantments?.map((e) => (
            <div key={e.id} className="grindstone-enchant">
              {ENCHANTMENT_DEFS[e.id].label}
              {enchantLevel(item, e.id) ? ` ${ROMAN[e.level]}` : ""}
            </div>
          ))}
        </div>
        <button className="anvil-action" onClick={onStrip} aria-label={`Remove enchantments — returns ${refund} XP`}>
          <span className="enchant-name">Remove enchantments</span>
          <span className="enchant-cost">+{refund} XP</span>
        </button>
      </div>
    </div>
  );
}
