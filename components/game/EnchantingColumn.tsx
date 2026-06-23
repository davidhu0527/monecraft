import ItemIcon from "@/components/game/ItemIcon";
import { ENCHANTMENT_DEFS, ENCHANTMENT_ORDER, canEnchant, enchantLevel } from "@/lib/game/enchantments";
import type { EnchantmentId, InventorySlot } from "@/lib/game/types";

const ROMAN = ["", "I", "II", "III", "IV", "V"];

type EnchantingColumnProps = {
  /** The selected hotbar item to enchant (or undefined/empty). */
  item: InventorySlot | undefined;
  xpLevel: number;
  cost: number;
  onEnchant: (id: EnchantmentId) => void;
};

const isEnchantableKind = (slot: InventorySlot | undefined): boolean =>
  !!slot?.id && slot.count > 0 && (slot.kind === "tool" || slot.kind === "weapon" || slot.kind === "armor");

/**
 * The enchanting-table panel (replaces the recipe book while a table is open):
 * the selected hotbar item and the enchantments it can take, each spending XP
 * levels. Buttons disable at max level or when you can't afford the cost.
 */
export default function EnchantingColumn({ item, xpLevel, cost, onEnchant }: EnchantingColumnProps) {
  const enchantable = isEnchantableKind(item);
  const applicable = enchantable && item?.kind ? ENCHANTMENT_ORDER.filter((id) => ENCHANTMENT_DEFS[id].kinds.includes(item.kind!)) : [];

  return (
    <div className="enchanting-column">
      <div className="inventory-heading">Enchanting</div>
      {!enchantable || !item ? (
        <div className="enchanting-hint">Select a tool, weapon, or armor in the hotbar to enchant it.</div>
      ) : (
        <>
          <div className="enchanting-item">
            <ItemIcon slot={item} size={32} />
            <span>{item.label}</span>
          </div>
          <div className="enchanting-cost">
            {cost} levels each · you have {xpLevel}
          </div>
          <div className="enchanting-list">
            {applicable.map((id) => {
              const def = ENCHANTMENT_DEFS[id];
              const level = enchantLevel(item, id);
              const maxed = level >= def.maxLevel;
              const enabled = canEnchant(item, id) && xpLevel >= cost;
              const status = maxed ? "max level" : xpLevel < cost ? "not enough XP" : `costs ${cost} levels`;
              return (
                <button
                  key={id}
                  className="enchant-entry"
                  onClick={() => onEnchant(id)}
                  disabled={!enabled}
                  aria-label={`${def.label}${level ? ` ${ROMAN[level]}` : ""} — ${status}`}
                >
                  <span className="enchant-name">
                    {def.label}
                    {level ? ` ${ROMAN[level]}` : ""}
                  </span>
                  <span className="enchant-cost">{maxed ? "MAX" : `${cost} lvl`}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
