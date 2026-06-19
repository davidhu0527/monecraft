import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import BossHealthBar from "./BossHealthBar";

describe("BossHealthBar", () => {
  test("stays hidden without a living boss", () => {
    const { container } = render(<BossHealthBar boss={null} />);
    expect(container.firstChild).toBeNull();
  });

  test("shows distance and rotates the direction pointer", () => {
    render(<BossHealthBar boss={{ hpPercent: 0.75, bearingDegrees: 90, distanceBlocks: 42 }} />);

    expect(screen.getByText("42 blocks")).toBeTruthy();
    expect(screen.getByRole("status").getAttribute("aria-label")).toContain("bearing 90 degrees");
    expect(document.querySelector<HTMLElement>(".boss-pointer")?.style.transform).toBe("rotate(90deg)");
    expect(document.querySelector<HTMLElement>(".boss-bar-fill")?.style.width).toBe("75%");
  });
});
