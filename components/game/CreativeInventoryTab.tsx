import { Fragment, useMemo, useState } from "react";
import ItemIcon from "@/components/game/ItemIcon";
import { itemTooltipFor, useItemTooltip } from "@/components/game/ItemTooltip";
import { createSlot, ITEM_DEFS } from "@/lib/game/items";
import type { ItemKind } from "@/lib/game/types";

/** Palette sections, in display order — every item kind is covered. */
const KIND_SECTIONS: ReadonlyArray<{ kind: ItemKind; label: string }> = [
  { kind: "block", label: "Blocks" },
  { kind: "tool", label: "Tools" },
  { kind: "vehicle", label: "Vehicles" },
  { kind: "weapon", label: "Weapons" },
  { kind: "armor", label: "Armor" },
  { kind: "food", label: "Food" },
  { kind: "material", label: "Materials" }
];

/**
 * The Creative item palette — every item in the game, grouped by kind with a
 * search box. Clicking one pulls a full stack into the inventory (the engine
 * gates the give to Creative). Replaces the recipe book while in Creative mode.
 */
export default function CreativeInventoryTab({ onGiveItem }: { onGiveItem: (itemId: string) => void }) {
  const [query, setQuery] = useState("");
  const { tooltip, bind } = useItemTooltip();

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = ITEM_DEFS.filter((def) => !q || def.label.toLowerCase().includes(q) || def.id.includes(q));
    return KIND_SECTIONS.map((section) => ({ ...section, items: matches.filter((def) => def.kind === section.kind) })).filter(
      (section) => section.items.length > 0
    );
  }, [query]);

  return (
    <div className="recipe-book creative-palette">
      <div className="inventory-heading">Creative</div>
      <input
        className="creative-search"
        type="text"
        placeholder="Search items…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="Search creative items"
      />
      <div className="recipe-list creative-list">
        {groups.length === 0 ? <div className="creative-empty">No items match “{query}”.</div> : null}
        {groups.map((group) => (
          <Fragment key={group.kind}>
            <div className="recipe-category" role="presentation">
              {group.label}
            </div>
            <div className="inv-grid creative-grid" data-testid={`creative-${group.kind}`}>
              {group.items.map((def) => (
                <button
                  key={def.id}
                  className="inv-slot"
                  onClick={() => onGiveItem(def.id)}
                  {...bind(itemTooltipFor(createSlot(def.id, 1)))}
                  aria-label={`Give ${def.label}`}
                >
                  <ItemIcon slot={createSlot(def.id, 1)} size={32} />
                </button>
              ))}
            </div>
          </Fragment>
        ))}
      </div>
      {tooltip}
    </div>
  );
}
