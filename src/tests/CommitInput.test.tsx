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
});
