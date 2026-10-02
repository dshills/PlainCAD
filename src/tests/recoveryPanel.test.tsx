import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { createBoxTemplate } from "../templates/templates";
import { useCadStore } from "../state/useCadStore";
import { RecoveryPanel } from "../ui/panels/RecoveryPanel";
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  load: vi.fn(),
  clear: vi.fn(),
  save: vi.fn(),
}));
vi.mock("../persistence/autosave", async (actual) => ({
  ...(await actual<any>()),
  listRecoveryRecords: mocks.list,
  removeRecovery: mocks.clear,
  saveRecovery: mocks.save,
}));
vi.mock("../persistence/importProject", () => ({
  importProjectFile: mocks.load,
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function setup() {
  vi.clearAllMocks();
  const recovered = createBoxTemplate();
  mocks.list.mockResolvedValue([
    {
      id: recovered.id,
      latest: {
        text: "snapshot",
        name: recovered.name,
        savedAt: 1,
        schemaVersion: 7,
      },
    },
  ]);
  mocks.save.mockResolvedValue(undefined);
  mocks.clear.mockResolvedValue(undefined);
  useCadStore.getState().setDocument(createEmptyDocument());
  render(<RecoveryPanel />);
  await screen.findByRole("button", {
    name: `Recover ${recovered.name}`,
  });
  return recovered;
}
describe("recovery safeguards", () => {
  it("flushes on page hide without awaiting the normal background-validation queue", async () => {
    await setup();
    fireEvent.click(
      screen.getByRole("button", { name: "Start without recovery" }),
    );
    act(() =>
      useCadStore
        .getState()
        .updateDocument((d) => ({ ...d, name: "Unsaved edit" })),
    );
    fireEvent(window, new Event("pagehide"));
    expect(mocks.save).toHaveBeenCalledWith(
      useCadStore.getState().history.present,
      false,
      { exitFlush: true },
    );
    await screen.findByText("Autosaved locally");
  });
  it("pauses autosave when initial recovery discovery fails", async () => {
    vi.clearAllMocks();
    mocks.list.mockRejectedValue(new Error("Cannot read snapshots"));
    useCadStore.getState().setDocument(createBoxTemplate());
    render(<RecoveryPanel />);
    await screen.findByText(/Cannot read snapshots/);
    fireEvent(window, new Event("pagehide"));
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("preserves edits made while a snapshot is loading", async () => {
    const recovered = await setup();
    let finish!: (doc: typeof recovered) => void;
    const loading = new Promise<typeof recovered>((resolve) => {
      finish = resolve;
    });
    mocks.load.mockReturnValue(loading);
    fireEvent.click(
      screen.getByRole("button", {
        name: `Recover ${recovered.name}`,
      }),
    );
    act(() =>
      useCadStore
        .getState()
        .updateDocument((d) => ({ ...d, name: "New work during recovery" })),
    );
    const edited = useCadStore.getState().history.present;
    await act(async () => finish(recovered));
    await screen.findByText(/Project changed during recovery/);
    expect(useCadStore.getState().history.present).toBe(edited);
  });
  it("requires explicit confirmation before clearing all snapshots", async () => {
    const recovered = await setup();
    mocks.load.mockRejectedValue(new Error("Corrupt snapshot"));
    fireEvent.click(
      screen.getByRole("button", {
        name: `Recover ${recovered.name}`,
      }),
    );
    await screen.findByText(/Corrupt snapshot/);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(
      screen.getByRole("button", { name: "Clear all autosaves" }),
    );
    expect(mocks.clear).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Clear all autosaves" }),
    );
    await waitFor(() => expect(mocks.clear).toHaveBeenCalledTimes(1));
  });
});
