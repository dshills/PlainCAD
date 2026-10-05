import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { createBoxTemplate } from "../templates/templates";
import * as autosave from "../persistence/autosave";
import * as projectExports from "../persistence/exportProject";
import { serializeProject } from "../persistence/exportProject";
import { useCadStore } from "../state/useCadStore";
import { useFileJobs } from "../persistence/fileJobs";
import {
  cancelProjectDrop,
  saveAndReplaceDroppedProject,
  prepareProjectDrop,
  replaceWithDroppedProject,
  useProjectDrop,
} from "../ui/commands/projectDropCommand";
import { ProjectFileDrop } from "../ui/workspace/ProjectFileDrop";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { useGuidedHole } from "../ui/commands/guidedHoleCommand";

function projectFile(text: string, name = "test.pcaddoc") {
  const file = new File([text], name, { type: "application/json" });
  Object.defineProperty(file, "text", {
    configurable: true,
    value: async () => text,
  });
  return file;
}
beforeEach(() => {
  useFileJobs.getState().cancel();
  useProjectDrop.setState({ pending: undefined, saving: false });
  useSketchCanvas.setState({ active: undefined, selection: undefined });
  useGuidedHole.setState({ draft: undefined });
  useCadStore.getState().setDocument(createEmptyDocument());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useGuidedHole.setState({ draft: undefined });
  useSketchCanvas.setState({ active: undefined, selection: undefined });
  useCadStore.setState(useCadStore.getInitialState(), true);
});

it("opens validated projects from a blank workspace and keeps unsafe/unsupported files out of state", async () => {
  const document = createBoxTemplate();
  await prepareProjectDrop(projectFile(serializeProject(document), "BOX.JSON"));
  expect(useCadStore.getState().history.present.id).toBe(document.id);
  expect(useCadStore.getState().fileBusy).toBe(false);
  const before = useCadStore.getState().history.present;
  for (const [text, name] of [
    ["{bad json", "broken.pcaddoc"],
    [serializeProject(document), "model.stl"],
    ['{"schemaVersion":999,"__proto__":{}}', "unsafe.json"],
  ]) {
    await prepareProjectDrop(projectFile(text, name));
    expect(useCadStore.getState().history.present).toBe(before);
    expect(useCadStore.getState().fileError).toBeTruthy();
    expect(useProjectDrop.getState().pending).toBeUndefined();
  }
});

it("validates before asking to replace nonempty work; cancel and Escape retain the complete project and history", async () => {
  useCadStore.getState().setDocument(createBoxTemplate());
  const before = useCadStore.getState().history;
  render(
    <ProjectFileDrop>
      <button>Workspace</button>
    </ProjectFileDrop>,
  );
  const file = projectFile(serializeProject(createEmptyDocument("Incoming")));
  fireEvent.drop(screen.getByText("Workspace"), {
    dataTransfer: { types: ["Files"], files: [file] },
  });
  await screen.findByRole("dialog", { name: "Open dropped project" });
  expect(useCadStore.getState().history).toBe(before);
  expect(screen.getByText(/has been validated/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Keep current project" }));
  expect(useCadStore.getState().history).toBe(before);
  await act(() => prepareProjectDrop(file));
  fireEvent(
    screen.getByRole("dialog", { name: "Open dropped project" }),
    new Event("cancel", { bubbles: true, cancelable: true }),
  );
  expect(useProjectDrop.getState().pending).toBeUndefined();
  expect(useCadStore.getState().history).toBe(before);
});

it("only accepts one file, reports active tasks and prevents the browser navigating to a dropped file", () => {
  render(
    <ProjectFileDrop>
      <button>Workspace</button>
    </ProjectFileDrop>,
  );
  const target = screen.getByText("Workspace"),
    file = projectFile("{}");
  const transfer = {
    types: ["Files"],
    files: [file, file],
    dropEffect: "none",
  };
  fireEvent.dragOver(target, { dataTransfer: transfer });
  expect(screen.getByRole("status")).toHaveTextContent("Drop to open project");
  expect(fireEvent.drop(target, { dataTransfer: transfer })).toBe(false);
  expect(useCadStore.getState().fileError).toMatch(/exactly one/);
  expect(screen.queryByRole("status")).toBeNull();
  // The handler reads task state at drop time, even without a React rerender.
  useSketchCanvas.setState({
    active: {
      documentId: useCadStore.getState().history.present.id,
      session: useCadStore.getState().documentSession,
      sketchId: "draft",
    },
  });
  fireEvent.drop(target, { dataTransfer: { ...transfer, files: [file] } });
  expect(useCadStore.getState().fileError).toMatch(/Finish or cancel/);
});

it("keeps the project and guided Hole face draft when a project file is dropped", async () => {
  useCadStore.getState().setDocument(createBoxTemplate());
  useCadStore.setState({ fileBusy: false });
  render(
    <ProjectFileDrop>
      <button>Workspace</button>
    </ProjectFileDrop>,
  );
  const before = useCadStore.getState();
  // This regression exercises file protection, not native face discovery. A
  // runtime-only face-picker draft needs no geometry or mocked kernel handles.
  useGuidedHole.setState({
    draft: {
      kind: "guidedHole",
      document: before.history.present,
      result: {
        documentId: before.history.present.id,
        success: true,
        bodies: [],
        meshes: [],
        errors: [],
        warnings: [],
        durationMs: 0,
      },
      session: before.documentSession,
      componentId: before.activeComponentId,
      selection: before.selection.selectedIds[0],
      phase: "face",
      sketchId: "guided-drop-sketch",
      featureId: "guided-drop-hole",
    },
  });
  const draft = useGuidedHole.getState().draft;
  const file = projectFile(serializeProject(createEmptyDocument("Incoming")));
  const read = vi.spyOn(file, "text");
  // Set the draft after rendering: the drop handler must read current task state.
  expect(
    fireEvent.drop(screen.getByText("Workspace"), {
      dataTransfer: { types: ["Files"], files: [file] },
    }),
  ).toBe(false);
  await waitFor(() =>
    expect(useCadStore.getState().fileError).toMatch(
      /Finish or cancel.*modeling task.*dropped project/i,
    ),
  );
  expect(read).not.toHaveBeenCalled();
  expect(useCadStore.getState().history).toBe(before.history);
  expect(useCadStore.getState().documentSession).toBe(before.documentSession);
  expect(useCadStore.getState().fileBusy).toBe(false);
  expect(useGuidedHole.getState().draft).toBe(draft);
  expect(useProjectDrop.getState().pending).toBeUndefined();
  expect(
    screen.queryByRole("dialog", { name: "Open dropped project" }),
  ).not.toBeInTheDocument();
});

it("rejects a same-ID project replacement during asynchronous import and after validation", async () => {
  const previous = useCadStore.getState().history.present;
  let resolve!: (value: string) => void;
  const file = projectFile("{}");
  Object.defineProperty(file, "text", {
    configurable: true,
    value: () =>
      new Promise<string>((r) => {
        resolve = r;
      }),
  });
  const opening = prepareProjectDrop(file);
  useCadStore.getState().setDocument(structuredClone(previous));
  resolve(serializeProject(createBoxTemplate()));
  await opening;
  expect(useCadStore.getState().history.present.id).toBe(previous.id);
  expect(useCadStore.getState().fileError).toMatch(/Project changed/);
  useCadStore.getState().setDocument(createBoxTemplate());
  await prepareProjectDrop(
    projectFile(serializeProject(createEmptyDocument("Incoming"))),
  );
  const current = useCadStore.getState().history.present;
  useCadStore.getState().setDocument(structuredClone(current));
  replaceWithDroppedProject();
  expect(useCadStore.getState().history.present.id).toBe(current.id);
  expect(useCadStore.getState().fileError).toMatch(/Project changed/);
});

it("explicit replacement opens the validated document and clears pending state", async () => {
  useCadStore.getState().setDocument(createBoxTemplate());
  const incoming = createEmptyDocument("Incoming");
  render(
    <ProjectFileDrop>
      <span>Workspace</span>
    </ProjectFileDrop>,
  );
  await act(() => prepareProjectDrop(projectFile(serializeProject(incoming))));
  fireEvent.click(
    screen.getByRole("button", { name: "Replace without saving" }),
  );
  await waitFor(() =>
    expect(useCadStore.getState().history.present.id).toBe(incoming.id),
  );
  expect(useProjectDrop.getState().pending).toBeUndefined();
  expect(useCadStore.getState().history.past).toEqual([]);
});

it("does not replace work when the portable-copy download fails, and reports stale save attempts", async () => {
  useCadStore.getState().setDocument(createBoxTemplate());
  await prepareProjectDrop(
    projectFile(serializeProject(createEmptyDocument("Incoming"))),
  );
  const before = useCadStore.getState().history;
  vi.spyOn(projectExports, "downloadProject").mockImplementation(() => {
    throw new Error("Download failed");
  });
  await saveAndReplaceDroppedProject();
  expect(useCadStore.getState().history).toBe(before);
  expect(useProjectDrop.getState().pending).toBeDefined();
  expect(useProjectDrop.getState().saving).toBe(false);
  expect(useCadStore.getState().fileBusy).toBe(false);
  expect(useCadStore.getState().fileError).toBe("Download failed");
  useCadStore.getState().setDocument(structuredClone(before.present));
  await saveAndReplaceDroppedProject();
  expect(useCadStore.getState().fileError).toMatch(/Project changed/);
});

it("serializes save-and-open and refuses dismissal while its portable copy is being saved", async () => {
  useCadStore.getState().setDocument(createBoxTemplate());
  const incoming = createEmptyDocument("Incoming");
  await prepareProjectDrop(projectFile(serializeProject(incoming)));
  const pending = useProjectDrop.getState().pending;
  let complete!: () => void;
  const download = vi
    .spyOn(projectExports, "downloadProject")
    .mockImplementation(
      () =>
        new Promise<void>((r) => {
          complete = r;
        }),
    );
  vi.spyOn(autosave, "saveRecovery").mockResolvedValue(undefined);
  const saving = saveAndReplaceDroppedProject();
  expect(useProjectDrop.getState().saving).toBe(true);
  await saveAndReplaceDroppedProject();
  cancelProjectDrop();
  expect(useProjectDrop.getState().pending).toBe(pending);
  expect(download).toHaveBeenCalledTimes(1);
  complete();
  await saving;
  expect(useCadStore.getState().history.present.id).toBe(incoming.id);
  expect(useProjectDrop.getState()).toMatchObject({
    pending: undefined,
    saving: false,
  });
  expect(useCadStore.getState().fileBusy).toBe(false);
});
