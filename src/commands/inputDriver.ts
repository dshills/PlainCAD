import { interactionArguments, nativeInteraction } from "./interactionEvents";
export interface InputRequest {
  type: string;
  clientX: number;
  clientY: number;
  button: number;
  deltaX: number;
  deltaY: number;
  modifiers: string[];
}
declare global {
  interface Window {
    plaincadCommandInput?: (request: InputRequest) => Promise<void>;
  }
}
export function needsInputDriver(property: string) { return /^(on)?(pointer|mouse|wheel)/i.test(property); }
/** CLI input transport delivers native browser gestures into registered handlers. */
export function driveInteraction(target: EventTarget, property: string, value: unknown) {
  if (!window.plaincadCommandInput)
    throw new Error("Native gestures require a browser-input transport. Use the PlainCAD CLI input driver.");
  const args = interactionArguments(value), element = target instanceof Element ? target : document.querySelector(".viewer-canvas canvas") ?? document.documentElement, rect = element.getBoundingClientRect();
  if (args.pointerId !== undefined && args.pointerId !== 1 || args.pointerType !== undefined && args.pointerType !== "mouse")
    throw new Error("The CLI input driver supports native mouse gestures (pointer ID 1).");
  if (/pointercancel(capture)?$/i.test(property)) {
    target.dispatchEvent(nativeInteraction(target, property, args));
    return window.plaincadCommandInput({ type: "pointerup", clientX: Number(args.clientX ?? rect.left), clientY: Number(args.clientY ?? rect.top), button: Number(args.button ?? 0), deltaX: 0, deltaY: 0, modifiers: [] });
  }
  return window.plaincadCommandInput({ type: property.replace(/^on/, "").replace(/Capture$/, "").toLowerCase(), clientX: Number(args.clientX ?? rect.left + Number(args.x ?? 0.5) * rect.width), clientY: Number(args.clientY ?? rect.top + Number(args.y ?? 0.5) * rect.height), button: Number(args.button ?? 0), deltaX: Number(args.deltaX ?? 0), deltaY: Number(args.deltaY ?? 0), modifiers: [args.ctrlKey ? "Control" : "", args.metaKey ? "Meta" : "", args.shiftKey ? "Shift" : "", args.altKey ? "Alt" : ""].filter(Boolean) });
}
