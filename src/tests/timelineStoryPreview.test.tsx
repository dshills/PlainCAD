import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBoxTemplate } from "../templates/templates";
import TimelineStoryPreview from "../ui/timeline/TimelineStoryPreview";
import type { TimelineStory } from "../ui/timeline/timelineStoryClient";

const load = vi.hoisted(() => vi.fn());
vi.mock("../ui/timeline/timelineStoryClient", () => ({ loadTimelineStory: load }));
const story: TimelineStory = { beforeImage: "data:image/png;base64,before", afterImage: "data:image/png;base64,after", beforeVolume: 0, afterVolume: 20, beforeSolids: 0, afterSolids: 1, changedBodies: 1, removedBodies: 0 };
afterEach(() => { vi.useRealTimers(); load.mockReset(); });

describe("timeline story lifecycle", () => {
  it("does not start a worker for a passing hover and aborts when closed", async () => {
    vi.useFakeTimers(); const document = createBoxTemplate();
    const view = render(<TimelineStoryPreview document={document} featureId={document.features[0].id} />);
    await act(async () => vi.advanceTimersByTime(200)); view.unmount();
    await act(async () => vi.advanceTimersByTime(500)); expect(load).not.toHaveBeenCalled();
    let signal: AbortSignal | undefined;
    load.mockImplementation((_document, _id, current) => { signal = current; return new Promise(() => {}); });
    const open = render(<TimelineStoryPreview document={document} featureId={document.features[0].id} />);
    await act(async () => vi.advanceTimersByTime(350)); expect(signal?.aborted).toBe(false);
    open.unmount(); expect(signal?.aborted).toBe(true);
  });
  it("discards late results on an immutable document edit and clears old proof immediately", async () => {
    vi.useFakeTimers(); const document = createBoxTemplate();
    let resolveOld!: (value: TimelineStory) => void;
    load.mockImplementationOnce(() => new Promise<TimelineStory>(resolve => { resolveOld = resolve; })).mockResolvedValue(story);
    const view = render(<TimelineStoryPreview document={document} featureId={document.features[0].id} />);
    await act(async () => vi.advanceTimersByTime(350));
    const changed = { ...document, updatedAt: "changed" };
    view.rerender(<TimelineStoryPreview document={changed} featureId={document.features[0].id} />);
    await act(async () => resolveOld({ ...story, afterVolume: 999 }));
    expect(screen.queryByText(/999/)).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(350));
    expect(screen.getByLabelText(`Build story: ${document.features[0].name}`)).toHaveAttribute("data-after-volume", "20");
    view.rerender(<TimelineStoryPreview document={{ ...changed }} featureId={document.features[0].id} />);
    expect(screen.getByLabelText(`Build story: ${document.features[0].name}`)).toHaveAttribute("data-native", "false");
  });
  it("reports native errors and never substitutes a successful image", async () => {
    vi.useFakeTimers(); load.mockRejectedValue(new Error("After: Repair the missing face."));
    const document = createBoxTemplate(); render(<TimelineStoryPreview document={document} featureId={document.features[0].id} />);
    await act(async () => vi.advanceTimersByTime(350));
    expect(screen.getByRole("status")).toHaveTextContent("Repair the missing face");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
