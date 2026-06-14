import { describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CreateWorldForm from "@/components/menu/CreateWorldForm";

describe("CreateWorldForm", () => {
  test("submits the entered name and seed", async () => {
    const user = userEvent.setup();
    const onCreate = mock();
    render(<CreateWorldForm onCreate={onCreate} onCancel={mock()} />);

    await user.type(screen.getByLabelText("World name"), "Survival");
    await user.type(screen.getByLabelText("World seed"), "42");
    await user.click(screen.getByRole("button", { name: "Create World" }));

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith("Survival", "42");
  });

  test("a blank seed is allowed (random world)", async () => {
    const user = userEvent.setup();
    const onCreate = mock();
    render(<CreateWorldForm onCreate={onCreate} onCancel={mock()} />);

    await user.type(screen.getByLabelText("World name"), "Random");
    await user.click(screen.getByRole("button", { name: "Create World" }));

    expect(onCreate).toHaveBeenCalledWith("Random", "");
  });

  test("cancel fires its callback", async () => {
    const user = userEvent.setup();
    const onCancel = mock();
    render(<CreateWorldForm onCreate={mock()} onCancel={onCancel} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
