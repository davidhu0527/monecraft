import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import StatusBars, { iconStates } from "@/components/game/StatusBars";
import { MAX_HEARTS, MAX_HUNGER, MAX_OXYGEN } from "@/lib/game/config";

function renderBars(overrides: Partial<Parameters<typeof StatusBars>[0]> = {}) {
  render(
    <StatusBars
      hearts={MAX_HEARTS}
      maxHearts={MAX_HEARTS}
      hunger={MAX_HUNGER}
      maxHunger={MAX_HUNGER}
      armorPoints={0}
      oxygen={MAX_OXYGEN}
      maxOxygen={MAX_OXYGEN}
      {...overrides}
    />
  );
}

describe("StatusBars", () => {
  test("exposes health and hunger as labelled meters", () => {
    renderBars({ hearts: 13, hunger: 15 });
    expect(screen.getByLabelText(`Health: 13/${MAX_HEARTS}`)).toBeTruthy();
    expect(screen.getByLabelText(`Hunger: 15/${MAX_HUNGER}`)).toBeTruthy();
  });

  test("renders ten icons per row with half icons at odd values", () => {
    renderBars({ hearts: 13 }); // 6 full + 1 half + 3 containers
    const row = screen.getByLabelText(`Health: 13/${MAX_HEARTS}`);
    const icons = [...row.querySelectorAll("[data-icon]")].map((el) => el.getAttribute("data-icon"));
    expect(icons).toHaveLength(10);
    expect(icons.slice(0, 6).every((icon) => icon === "heart_full")).toBe(true);
    expect(icons[6]).toBe("heart_half");
    expect(icons.slice(7).every((icon) => icon === "heart_container")).toBe(true);
  });

  test("iconStates covers full, half, and empty boundaries", () => {
    expect(iconStates(20, 20).every((state) => state === "full")).toBe(true);
    expect(iconStates(0, 20).every((state) => state === "container")).toBe(true);
    expect(iconStates(1, 20)[0]).toBe("half");
    expect(iconStates(2, 20)[0]).toBe("full");
  });

  test("the armor row only appears when armor is equipped", () => {
    renderBars({ armorPoints: 0 });
    expect(screen.queryByLabelText(/Armor:/)).toBeNull();
  });

  test("shows the armor meter when points are present", () => {
    renderBars({ armorPoints: 7 });
    expect(screen.getByLabelText("Armor: 7/20")).toBeTruthy();
  });

  test("the air meter is hidden at full breath and appears once it drops", () => {
    renderBars({ oxygen: MAX_OXYGEN });
    expect(screen.queryByLabelText(/Air:/)).toBeNull();
    renderBars({ oxygen: 4 });
    expect(screen.getByLabelText(`Air: 4/${MAX_OXYGEN}`)).toBeTruthy();
  });
});
