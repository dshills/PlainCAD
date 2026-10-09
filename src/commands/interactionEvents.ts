import { objectArguments } from "./protocol";
import type { JsonValue } from "./registry";
export const INTERACTION_INPUT = { type: "object", additionalProperties: false, properties: {
    value: { type: "string" }, checked: { type: "boolean" }, key: { type: "string" }, code: { type: "string" },
    x: { type: "number", description: "Fraction of the target width, 0–1" }, y: { type: "number", description: "Fraction of the target height, 0–1" },
    clientX: { type: "number" }, clientY: { type: "number" }, button: { type: "integer" }, buttons: { type: "integer" }, pointerId: { type: "integer" }, pointerType: { type: "string" },
    shiftKey: { type: "boolean" }, ctrlKey: { type: "boolean" }, metaKey: { type: "boolean" }, altKey: { type: "boolean" }, deltaX: { type: "number" }, deltaY: { type: "number" },
    data: { type: "object", description: "Drag-and-drop string data by MIME type" }, files: { type: "array", description: "Files as {name,type,text}; no local path access" },
  } } satisfies JsonValue;
const fields = Object.keys(INTERACTION_INPUT.properties);
export function interactionArguments(value: unknown) {
  const args = objectArguments(value, fields);
  for (const [key, entry] of Object.entries(args)) {
    if (["value", "key", "code", "pointerType"].includes(key) && (typeof entry !== "string" || entry.length > (key === "value" ? 1024 * 1024 : 100)))
      throw new Error(`Invalid ${key}.`);
    if (["checked", "shiftKey", "ctrlKey", "metaKey", "altKey"].includes(key) && typeof entry !== "boolean")
      throw new Error(`Invalid ${key}.`);
    if (["x", "y", "clientX", "clientY", "deltaX", "deltaY", "button", "buttons", "pointerId"].includes(key) && (typeof entry !== "number" || !Number.isFinite(entry) || Math.abs(entry) > 10000000))
      throw new Error(`Invalid ${key}.`);
    if (["x", "y"].includes(key) && ((entry as number) < 0 || (entry as number) > 1))
      throw new Error(`${key} must be between 0 and 1.`);
    if (["button", "buttons", "pointerId"].includes(key) && (!Number.isSafeInteger(entry) || Number(entry) < 0 || Number(entry) > (key === "button" ? 2 : key === "buttons" ? 31 : 1000000)))
      throw new Error(`Invalid ${key}.`);
  }
  return args;
}
export function unavailableElement(element?: Element | null) {
  if (!element?.isConnected)
    return "This interaction is no longer mounted.";
  if (element.matches(":disabled, [aria-disabled='true']") || element.closest("[inert], [hidden], [aria-hidden='true']"))
    return "This control is disabled or hidden.";
  let modal: Element | null = null;
  try {
    modal = document.querySelector("dialog:modal");
  }
  catch { /* jsdom has no native top layer. */ }
  modal ??= document.querySelector("dialog[open][aria-modal='true'], [role='dialog'][aria-modal='true']:not([hidden])");
  if (modal && !modal.contains(element))
    return "Finish the active dialog first.";
  if (["hidden", "collapse"].includes(getComputedStyle(element).visibility))
    return "This control is hidden.";
  let current: Element | null = element;
  while (current) {
    if (getComputedStyle(current).display === "none")
      return "This control is hidden.";
    current = current.parentElement;
  }
  return undefined;
}
export function elementLabel(element: Element | null, fallback: string) {
  if (!element)
    return fallback;
  const input = element as HTMLInputElement;
  return element.getAttribute("aria-label") || ("labels" in input ? [...input.labels ?? []].map(label => label.textContent?.trim()).join(" ") : "") || element.getAttribute("title") || element.textContent?.trim().slice(0, 180) || fallback;
}
export function elementState(element: Element | null): JsonValue {
  if (!element)
    return {};
  const input = element as HTMLInputElement, select = element as HTMLSelectElement;
  return { tag: element.tagName.toLowerCase(), ...(input.type ? { type: input.type } : {}), ...("value" in input && !["password", "file"].includes(input.type) ? { value: String(input.value).slice(0, 5000) } : {}), ...("checked" in input ? { checked: input.checked } : {}), ...(select.options ? { options: [...select.options].map(option => ({ value: option.value, label: option.label, disabled: option.disabled })) } : {}) };
}
export function nativeInteraction(element: EventTarget, property: string, value: unknown): Event {
  const args = interactionArguments(value), node = element instanceof Element ? element : document.documentElement, rect = node.getBoundingClientRect();
  const options = { bubbles: true, cancelable: true, composed: true, ...args, clientX: args.clientX ?? rect.left + Number(args.x ?? 0.5) * rect.width, clientY: args.clientY ?? rect.top + Number(args.y ?? 0.5) * rect.height };
  const name = property.replace(/^on/, "").replace(/Capture$/, "").toLowerCase().replace(/^doubleclick$/, "dblclick");
  if ("value" in args && (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) && node.readOnly)
    throw new Error("This field is read-only.");
  if ("value" in args && (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) && node.maxLength >= 0 && String(args.value).length > node.maxLength)
    throw new Error("Value exceeds this field's maximum length.");
  if ("value" in args && node instanceof HTMLSelectElement && ![...node.options].some(option => option.value === args.value && !option.disabled && !(option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled)))
    throw new Error("Choose an enabled option from this field's command state.");
  if ("value" in args && node instanceof HTMLInputElement && node.type === "file")
    throw new Error("File inputs accept files, not a value string.");
  if ("value" in args && !(node instanceof HTMLInputElement || node instanceof HTMLSelectElement || node instanceof HTMLTextAreaElement))
    throw new Error("Value is only valid for an editable field.");
  if ("checked" in args && !(node instanceof HTMLInputElement && ["checkbox", "radio"].includes(node.type)))
    throw new Error("Checked is only valid for a checkbox or radio field.");
  let event: Event;
  if (name.startsWith("key"))
    event = new KeyboardEvent(name, options as KeyboardEventInit);
  else if (name.includes("pointer"))
    event = new PointerEvent(name, { ...options, pointerId: Number(args.pointerId ?? 1), pointerType: String(args.pointerType ?? "mouse") } as PointerEventInit);
  else if (name === "wheel")
    event = new WheelEvent(name, options as WheelEventInit);
  else if (/^(click|dblclick|mouse|contextmenu)/.test(name))
    event = new MouseEvent(name, options as MouseEventInit);
  else
    event = new Event(name, options as EventInit);
  let suppliedFiles: FileList | undefined;
  if (args.data !== undefined || args.files !== undefined || /^(drag|drop)/.test(name)) {
    const transfer = new DataTransfer();
    if (args.data !== undefined) {
      if (!args.data || typeof args.data !== "object" || Array.isArray(args.data))
        throw new Error("Drag data must be a MIME-to-string object.");
      for (const [type, text] of Object.entries(args.data)) {
        if (typeof text !== "string")
          throw new Error("Drag data values must be strings.");
        transfer.setData(type, text);
      }
    }
    if (args.files !== undefined) {
      if (!Array.isArray(args.files) || args.files.length > 16)
        throw new Error("At most 16 files can be supplied.");
      for (const file of args.files) {
        const data = objectArguments(file, ["name", "type", "text"]);
        if (typeof data.name !== "string" || typeof data.text !== "string" || (data.type !== undefined && typeof data.type !== "string"))
          throw new Error("Files require name/type/text strings.");
        transfer.items.add(new File([data.text], data.name, { type: String(data.type ?? "application/json") }));
      }
    }
    Object.defineProperty(event, "dataTransfer", { value: transfer });
    if (args.files !== undefined)
      suppliedFiles = transfer.files;
  }
  // All DTO/event validation precedes DOM mutation, including drag/file data.
  if (suppliedFiles) {
    if (!(node instanceof HTMLInputElement && node.type === "file") && !/^(drag|drop)/.test(name))
      throw new Error("Files are valid only for a file input or drop action.");
    if (node instanceof HTMLInputElement && node.type === "file")
      node.files = suppliedFiles;
  }
  if ("value" in args) {
    const prototype = node instanceof HTMLInputElement ? HTMLInputElement.prototype : node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
    // Bypass React's own value accessor so its change plugin can observe the
    // actual DOM edit and run capture/ancestor callbacks as it does for typing.
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, args.value);
  }
  if ("checked" in args)
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")!.set!.call(node, args.checked);
  return event;
}
export function reactInteraction(element: Element | null, property: string, value: unknown) {
  if (!element)
    throw new Error("A mounted DOM control is required for scripted interaction.");
  const nativeEvent = nativeInteraction(element, property, value);
  return new Proxy(nativeEvent, { get(target, key) {
      if (key === "nativeEvent")
        return nativeEvent;
      if (key === "currentTarget" || key === "target")
        return element;
      if (key === "persist")
        return () => { };
      if (key === "isDefaultPrevented")
        return () => target.defaultPrevented;
      if (key === "isPropagationStopped")
        return () => target.cancelBubble;
      const entry = Reflect.get(target, key, target);
      return typeof entry === "function" ? entry.bind(target) : entry;
    } }) as Event & {
    nativeEvent: Event;
  };
}
