import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LiveSessionPanel } from "../ui/panels/LiveSessionPanel";
import { registerLiveSessionCommands, useLiveSessionState } from "../commands/liveSession";
const clipboard = vi.hoisted(() => ({ copy: vi.fn() }));
vi.mock("../commands/liveSession", async importOriginal => ({ ...await importOriginal<typeof import("../commands/liveSession")>(), copyLiveCapability: clipboard.copy }));
beforeEach(() => {
  registerLiveSessionCommands();
  useLiveSessionState.setState({ status: "connected", connectionId: "connection-a", completed: 0, error: undefined });
  clipboard.copy.mockReset();
  clipboard.copy.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); useLiveSessionState.setState(useLiveSessionState.getInitialState(), true); });
it("removes the copied-capability notice when the user disconnects", async () => {
  render(<LiveSessionPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Copy agent capability" }));
  await screen.findByText("Capability copied. Pass it privately in PLAINCAD_LIVE_TOKEN.");
  fireEvent.click(screen.getByRole("button", { name: "Disconnect live agent" }));
  await screen.findByRole("button", { name: "Connect live agent" });
  expect(screen.queryByText(/Capability copied/)).not.toBeInTheDocument();
});
it("removes the copied-capability notice on transport expiry", async () => {
  render(<LiveSessionPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Copy agent capability" }));
  await screen.findByText(/Capability copied/);
  act(() => useLiveSessionState.setState({ status: "disconnected", connectionId: undefined, error: "Connection expired." }));
  expect(screen.queryByText(/Capability copied/)).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Connection expired.");
});
it("ignores a clipboard completion from an older connection", async () => {
  let resolve: () => void = () => {};
  clipboard.copy.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
  render(<LiveSessionPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Copy agent capability" }));
  act(() => useLiveSessionState.setState({ connectionId: "connection-b" }));
  await act(async () => resolve());
  expect(screen.queryByText(/Capability copied/)).not.toBeInTheDocument();
});
it("announces a clipboard failure as an alert without claiming a copied capability", async () => {
  clipboard.copy.mockRejectedValue(new Error("Clipboard permission denied."));
  render(<LiveSessionPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Copy agent capability" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Clipboard permission denied.");
  expect(screen.queryByText(/Capability copied/)).not.toBeInTheDocument();
});
