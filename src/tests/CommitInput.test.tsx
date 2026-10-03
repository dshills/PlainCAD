import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CommitInput } from "../ui/panels/CommitInput";

describe("committed input drafts", () => {
  it.each([false, true])(
    "preserves an external update while focused (edited: %s)",
    async (edited) => {
      const onCommit = vi.fn();
      const view = render(<CommitInput value="1mm" onCommit={onCommit} />);
      const input = screen.getByRole("textbox");
      await userEvent.click(input);
      if (edited) {
        await userEvent.clear(input);
        await userEvent.type(input, "2mm");
      }
      view.rerender(<CommitInput value="3mm" onCommit={onCommit} />);
      expect(input).toHaveValue("3mm");
      expect(input).not.toHaveAttribute("data-dirty");
      expect(input).not.toHaveAccessibleDescription();
      await userEvent.tab();
      expect(onCommit).not.toHaveBeenCalled();
    },
  );

  it("commits one edited draft on Enter and cancels another on Escape", async () => {
    const onCommit = vi.fn();
    render(<CommitInput value="1mm" onCommit={onCommit} />);
    const input = screen.getByRole("textbox");
    await userEvent.clear(input);
    await userEvent.type(input, "2mm{Enter}");
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("2mm");
    // A parent that rejects the edit retains its authoritative value.
    expect(input).toHaveValue("1mm");
    await userEvent.clear(input);
    await userEvent.type(input, "4mm{Escape}");
    expect(input).toHaveValue("1mm");
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
  it("displays the parent-normalized committed value", async () => {
    function Parent() {
      const [value, setValue] = useState("1mm");
      return (
        <CommitInput
          value={value}
          onCommit={(draft) => setValue(draft.replace("mm", " mm"))}
        />
      );
    }
    render(<Parent />);
    const input = screen.getByRole("textbox");
    await userEvent.clear(input);
    await userEvent.type(input, "2mm{Enter}");
    expect(input).toHaveValue("2 mm");
  });
  it("marks only changed drafts, describes commit/cancel and keeps the field name stable", async () => {
    const onCommit = vi.fn();
    render(
      <label>
        Distance
        <CommitInput value="1mm" onCommit={onCommit} />
      </label>,
    );
    const input = screen.getByRole("textbox", { name: "Distance" });
    expect(input).not.toHaveAttribute("data-dirty");
    await userEvent.clear(input);
    await userEvent.type(input, "2mm");
    expect(input).toHaveAttribute("data-dirty", "true");
    expect(input).toHaveAccessibleName("Distance");
    expect(screen.getByLabelText("Distance", { exact: true })).toBe(input);
    expect(input).toHaveAccessibleDescription(
      "Uncommitted changes — Enter or leave field to apply; Escape cancels.",
    );
    expect(onCommit).not.toHaveBeenCalled();
    await userEvent.clear(input);
    await userEvent.type(input, "1mm");
    expect(input).not.toHaveAttribute("data-dirty");
    expect(input).not.toHaveAccessibleDescription();
    await userEvent.clear(input);
    await userEvent.type(input, "3mm{Escape}");
    expect(input).not.toHaveAttribute("data-dirty");
    expect(input).toHaveValue("1mm");
    expect(onCommit).not.toHaveBeenCalled();
    await userEvent.clear(input);
    await userEvent.type(input, "4mm");
    await userEvent.tab();
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("4mm");
    expect(input).not.toHaveAttribute("data-dirty");
  });
  it("discards an external-value draft without reviving it when that value returns", async () => {
    const onCommit = vi.fn();
    const view = render(
      <label>
        Distance
        <CommitInput value="1mm" onCommit={onCommit} />
      </label>,
    );
    const input = screen.getByRole("textbox", { name: "Distance" });
    await userEvent.clear(input);
    await userEvent.type(input, "2mm");
    const descriptionId = input.getAttribute("aria-describedby")!;
    expect(document.getElementById(descriptionId)).toHaveTextContent(
      "Uncommitted changes",
    );
    view.rerender(
      <label>
        Distance
        <CommitInput value="3mm" onCommit={onCommit} />
      </label>,
    );
    view.rerender(
      <label>
        Distance
        <CommitInput value="1mm" onCommit={onCommit} />
      </label>,
    );
    expect(input).toHaveValue("1mm");
    expect(input).not.toHaveAttribute("aria-describedby");
    expect(document.getElementById(descriptionId)).toBeNull();
    await userEvent.tab();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
