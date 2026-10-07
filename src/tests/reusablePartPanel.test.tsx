import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ReusablePartPanel } from "../ui/panels/ReusablePartPanel";
import { beginInsertProject, cancelInsertProject, useReusablePart } from "../ui/commands/reusablePartCommand";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { createBoxTemplate } from "../templates/templates";
import { serializeProject } from "../persistence/exportProject";
import { useCadStore } from "../state/useCadStore";
import { useFileJobs } from "../persistence/fileJobs";
import { useTargetScopeCapture } from "../ui/commands/targetScopeCaptureCommand";
import { useInspectionState } from "../state/inspectionState";
function sourceFile(text: string) {
  const file = new File([text], "box.pcaddoc", { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => text });
  return file;
}
beforeEach(() => { useTargetScopeCapture.setState({ busy: false }); useFileJobs.getState().cancel(); cancelInsertProject(); useInspectionState.setState({ picking: false }); useCadStore.getState().setDocument(createEmptyDocument("Keep me")); });
afterEach(() => { useTargetScopeCapture.setState({ busy: false }); cleanup(); cancelInsertProject(); useFileJobs.getState().cancel(); useCadStore.setState(useCadStore.getInitialState(), true); });
it("shows explicit file/scope/shared-origin controls and waits for Apply to insert; cancel keeps the project", async () => {
  beginInsertProject(); render(<ReusablePartPanel />);
  const target = useCadStore.getState().history.present;
  expect(screen.getByRole("dialog", { name: "Insert reusable part" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Insert components" })).toBeDisabled();
  const source = createBoxTemplate();
  fireEvent.change(screen.getByLabelText("Source project"), { target: { files: [sourceFile(serializeProject(source))] } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Insert components" })).toBeEnabled());
  expect(screen.getByLabelText("Insert scope")).toHaveValue("");
  expect(screen.getByText(/Parts may overlap/)).toBeVisible();
  expect(useCadStore.getState().history.present).toBe(target);
  fireEvent.click(screen.getByRole("button", { name: "Cancel insertion" }));
  expect(screen.queryByRole("dialog")).toBeNull(); expect(useCadStore.getState().history.present).toBe(target);
  act(() => beginInsertProject());
  fireEvent.change(screen.getByLabelText("Source project"), { target: { files: [sourceFile(serializeProject(source))] } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Insert components" })).toBeEnabled());
  fireEvent.change(screen.getByLabelText("Insert scope"), { target: { value: source.rootComponentId } });
  fireEvent.click(screen.getByRole("button", { name: "Insert components" }));
  expect(screen.queryByRole("dialog")).toBeNull(); expect(useCadStore.getState().history.present.id).toBe(target.id);
  expect(useCadStore.getState().history.present.features).toHaveLength(1); expect(useCadStore.getState().history.past).toHaveLength(1);
});
it("shows unsafe import errors and disables applying a stale source", async () => {
  beginInsertProject(); render(<ReusablePartPanel />);
  fireEvent.change(screen.getByLabelText("Source project"), { target: { files: [sourceFile('{"__proto__":{}}')] } });
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("unsafe key"));
  expect(screen.getByRole("button", { name: "Insert components" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Source project"), { target: { files: [sourceFile(serializeProject(createBoxTemplate()))] } });
  await waitFor(() => expect(useReusablePart.getState().frame?.source).toBeDefined());
  act(() => useCadStore.getState().updateDocument((d) => ({ ...d, name: "Changed" })));
  expect(screen.getByRole("alert")).toHaveTextContent("current project changed"); expect(screen.getByRole("button", { name: "Insert components" })).toBeDisabled();
});

it("reactively disables staged insertion while another task owns the model and restores controls afterward", async () => {
  beginInsertProject(); render(<ReusablePartPanel />);
  fireEvent.change(screen.getByLabelText("Source project"), { target: { files: [sourceFile(serializeProject(createBoxTemplate()))] } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Insert components" })).toBeEnabled());
  const project = useCadStore.getState().history.present;
  act(() => useTargetScopeCapture.setState({ busy: true }));
  expect(useCadStore.getState().history.present).toBe(project);
  expect(screen.getByRole("button", { name: "Insert components" })).toBeDisabled();
  expect(screen.getByLabelText("Source project")).toBeDisabled();
  act(() => useTargetScopeCapture.setState({ busy: false }));
  expect(screen.getByRole("button", { name: "Insert components" })).toBeEnabled();
  act(() => useInspectionState.setState({ picking: true }));
  expect(screen.getByRole("button", { name: "Insert components" })).toBeDisabled();
  act(() => useInspectionState.setState({ picking: false }));
  expect(screen.getByRole("button", { name: "Insert components" })).toBeEnabled();
});
