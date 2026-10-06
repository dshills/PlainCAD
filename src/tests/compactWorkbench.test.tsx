import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCadStore } from "../state/useCadStore";
import { useWorkbenchState } from "../state/useWorkbenchState";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { WorkbenchBreadcrumb } from "../ui/workspace/WorkbenchBreadcrumb";

beforeEach(() => {
  useCadStore.setState(useCadStore.getInitialState(), true);
  useSketchCanvas.setState({ active: undefined });
  useWorkbenchState.setState({ leftOpen: true, rightOpen: true, mobileDock: "none" });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("compact docks start unselected and one deliberate toggle opens or closes the actual visible dock", () => {
  const history = useCadStore.getState().history;
  render(<WorkbenchBreadcrumb />);
  const parts = screen.getByRole("button", { name: "Parts" });
  const details = screen.getByRole("button", { name: "Toggle task dock" });
  expect(parts).toHaveAttribute("aria-expanded", "false");
  expect(details).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(parts);
  expect(parts).toHaveAttribute("aria-expanded", "true");
  expect(useWorkbenchState.getState()).toMatchObject({ leftOpen: true, mobileDock: "left" });
  fireEvent.click(details);
  expect(details).toHaveAttribute("aria-expanded", "true");
  expect(parts).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(details);
  expect(details).toHaveAttribute("aria-expanded", "false");
  expect(useWorkbenchState.getState()).toMatchObject({ leftOpen: true, rightOpen: true, mobileDock: "none" });
  expect(useCadStore.getState().history).toBe(history);
});
it("opening compact docks does not reopen a persisted closed desktop dock", () => {
  useWorkbenchState.setState({ leftOpen: false, rightOpen: false });
  render(<WorkbenchBreadcrumb />);
  fireEvent.click(screen.getByRole("button", { name: "Parts" }));
  expect(screen.getByRole("button", { name: "Parts" })).toHaveAttribute("aria-expanded", "true");
  expect(useWorkbenchState.getState().leftOpen).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Toggle task dock" }));
  expect(screen.getByRole("button", { name: "Toggle task dock" })).toHaveAttribute("aria-expanded", "true");
  expect(useWorkbenchState.getState().rightOpen).toBe(false);
});

it("desktop toggles continue to reflect persisted dock visibility", () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  render(<WorkbenchBreadcrumb />);
  const parts = screen.getByRole("button", { name: "Parts" });
  const details = screen.getByRole("button", { name: "Toggle task dock" });
  expect(parts).toHaveAttribute("aria-expanded", "true");
  expect(details).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(parts);
  expect(parts).toHaveAttribute("aria-expanded", "false");
  expect(details).toHaveAttribute("aria-expanded", "true");
});

it("desktop dock actions do not implicitly open a compact dock on resize", () => {
  let compact = false;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    get matches() { return compact; },
    addEventListener: (_name: string, callback: () => void) => { listeners.add(callback); },
    removeEventListener: (_name: string, callback: () => void) => { listeners.delete(callback); },
  })));
  render(<WorkbenchBreadcrumb />);
  const parts = screen.getByRole("button", { name: "Parts" });
  const details = screen.getByRole("button", { name: "Toggle task dock" });
  fireEvent.click(parts);
  fireEvent.click(parts);
  fireEvent.click(details);
  fireEvent.click(details);
  act(() => {
    useWorkbenchState.getState().showLeft("parameters");
    useWorkbenchState.getState().showRight("properties");
  });
  expect(useWorkbenchState.getState()).toMatchObject({ leftOpen: true, rightOpen: true, mobileDock: "none" });
  act(() => { compact = true; listeners.forEach((listener) => listener()); });
  expect(parts).toHaveAttribute("aria-expanded", "false");
  expect(details).toHaveAttribute("aria-expanded", "false");
});
