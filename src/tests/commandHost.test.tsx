import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { flushSync } from "react-dom";
import { CommandHost } from "../commands/CommandHost";
import { configureCommandRuntime, describeCommands, executeCommand } from "../commands/registry";
afterEach(() => { cleanup(); configureCommandRuntime(() => 0, invoke => invoke()); });
async function call(command: string, args: object = {}) {
  let response;
  await act(async () => { response = await executeCommand({ command, session: 0, arguments: args }); });
  return response;
}
describe("mounted command adapters", () => {
  it("preserves absent optional callbacks on custom components", () => {
    function Optional({ onClose }: { onClose?: () => void }) { return <div>{onClose ? "Can close" : "No close action"}</div>; }
    render(<CommandHost site={{ id: "test.optional", source: "test", label: "Optional", properties: ["onClose"] }} element={<Optional onClose={undefined} />} />);
    expect(screen.getByText("No close action")).toBeInTheDocument();
  });
  it("shares capture/bubbling, respects disabled/inert controls, and removes unmounted bindings", async () => {
    const clicked = vi.fn(), capture = vi.fn();
    const view = render(<div onClickCapture={capture}><CommandHost site={{ id: "test.button", source: "test", label: "Save", properties: ["onClick"] }} element={<button onClick={clicked}>Save</button>}/></div>);
    fireEvent.click(screen.getByRole("button"));
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(await call("test.button.onClick")).toMatchObject({ ok: true });
    expect(clicked).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenCalledTimes(2);
    screen.getByRole("button").setAttribute("disabled", "");
    expect(await call("test.button.onClick")).toMatchObject({ error: { code: "unavailable" } });
    screen.getByRole("button").removeAttribute("disabled");
    screen.getByRole("button").parentElement!.setAttribute("inert", "");
    expect(await call("test.button.onClick")).toMatchObject({ error: { code: "unavailable" } });
    view.unmount();
    expect(describeCommands().find(command => command.id === "test.button.onClick")?.bindings).toHaveLength(0);
  });
  it("flushes React field drafts between commands before committing on blur", async () => {
    configureCommandRuntime(() => 0, invoke => flushSync(invoke));
    const committed = vi.fn();
    function Draft() { const [value, setValue] = useState("5mm"); return <CommandHost site={{ id: "test.draft", source: "test", label: "Thickness", properties: ["onFocus", "onChange", "onBlur"] }} element={<input aria-label="Thickness" value={value} onFocus={() => { }} onChange={event => setValue(event.target.value)} onBlur={() => committed(value)}/>}/>; }
    render(<Draft />);
    await call("test.draft.onFocus");
    await call("test.draft.onChange", { value: "8mm" });
    await call("test.draft.onBlur");
    expect(committed).toHaveBeenCalledWith("8mm");
    expect(screen.getByLabelText("Thickness")).toHaveValue("8mm");
  });
  it("runs delegated field changes and checkbox state through native React events", async () => {
    configureCommandRuntime(() => 0, invoke => flushSync(invoke)); const parent = vi.fn();
    function Fields() { const [value, setValue] = useState("5mm"), [checked, setChecked] = useState(false); return <div onChange={parent}><CommandHost site={{ id: "test.bubbleInput", label: "Width", source: "test", properties: ["onChange"] }} element={<input aria-label="Width" value={value} onChange={event => setValue(event.target.value)} />} /><CommandHost site={{ id: "test.checkbox", label: "Enabled", source: "test", properties: ["onChange"] }} element={<input aria-label="Enabled" type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />} /></div>; }
    render(<Fields />); expect(await call("test.bubbleInput.onChange", { value: "8mm" })).toMatchObject({ ok: true, value: { invoked: true } }); expect(await call("test.checkbox.onChange", { checked: true })).toMatchObject({ ok: true, value: { invoked: true } }); expect(screen.getByLabelText("Width")).toHaveValue("8mm"); expect(screen.getByLabelText("Enabled")).toBeChecked(); expect(parent).toHaveBeenCalledTimes(2);
  });
  it("cannot bypass a disabled submit button or forge a custom callback's preview proof", async () => {
    const submit = vi.fn();
    render(<CommandHost site={{ id: "test.form", source: "test", label: "Apply", properties: ["onSubmit"] }} element={<form onSubmit={event => { event.preventDefault(); submit(); }}><button type="submit" disabled>Apply</button></form>}/>);
    expect(await call("test.form.onSubmit")).toMatchObject({ error: { code: "command_failed" } });
    expect(submit).not.toHaveBeenCalled();
    function Custom() { return <button>Apply</button>; }
    render(<CommandHost site={{ id: "test.custom", source: "test", label: "Apply", properties: ["onApply"] }} element={<Custom />}/>);
    expect(await call("test.custom.onApply", { proof: {} })).toMatchObject({ error: { code: "unavailable" } });
  });
  it("rejects read-only values and disabled/unknown select options", async () => {
    const changed = vi.fn();
    render(<><CommandHost site={{ id: "test.readOnly", source: "test", label: "Locked", properties: ["onChange"] }} element={<input readOnly value="fixed" onChange={changed}/>}/><CommandHost site={{ id: "test.select", source: "test", label: "Plane", properties: ["onChange"] }} element={<select onChange={changed}><option value="XY">XY</option><option value="XZ" disabled>XZ</option></select>}/></>);
    expect(await call("test.readOnly.onChange", { value: "changed" })).toMatchObject({ error: { code: "command_failed" } });
    for (const value of ["XZ", "unknown"])
      expect(await call("test.select.onChange", { value })).toMatchObject({ error: { code: "command_failed" } });
    expect(changed).not.toHaveBeenCalled();
  });
  it("dispatches SVG picks and capture commands through the same event path", async () => {
    const picked = vi.fn(), captured = vi.fn();
    render(<svg><CommandHost site={{ id: "test.svg", source: "test", label: "Point", properties: ["onClick", "onClickCapture"] }} element={<circle aria-label="Point" onClick={picked} onClickCapture={captured}/>}/></svg>);
    expect(await call("test.svg.onClick")).toMatchObject({ ok: true });
    expect(picked).toHaveBeenCalledTimes(1);
    expect(captured).toHaveBeenCalledTimes(1);
    expect(await call("test.svg.onClickCapture")).toMatchObject({ ok: true });
    expect(picked).toHaveBeenCalledTimes(2);
    expect(captured).toHaveBeenCalledTimes(2);
  });
  it("cleans callback refs and bindings with React 19 ref cleanups", () => {
    const release = vi.fn(), ref = vi.fn(() => release);
    const view = render(<CommandHost site={{ id: "test.ref", source: "test", label: "Save", properties: ["onClick"] }} element={<button ref={ref}>Save</button>}/>);
    expect(ref).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(release).toHaveBeenCalledTimes(1);
    expect(describeCommands().find(command => command.id === "test.ref.onClick")?.bindings).toHaveLength(0);
  });
});
