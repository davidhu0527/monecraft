import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import ActiveEffects from "./ActiveEffects";

describe("ActiveEffects", () => {
  test("renders nothing when no effects are active", () => {
    const { container } = render(<ActiveEffects effects={[]} />);
    expect(container.firstChild).toBeNull();
  });

  test("shows one labelled chip per effect with an m:ss countdown", () => {
    render(
      <ActiveEffects
        effects={[
          { id: "speed", seconds: 65 },
          { id: "poison", seconds: 8 }
        ]}
      />
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("1:05")).toBeTruthy();
    expect(screen.getByText("0:08")).toBeTruthy();
    expect(screen.getByRole("listitem", { name: /Swiftness: 1:05/ })).toBeTruthy();
    expect(screen.getByRole("listitem", { name: /Poison: 0:08/ })).toBeTruthy();
  });
});
