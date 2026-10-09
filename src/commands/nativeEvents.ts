import { bindCommand, invokeCommand, dispatchCommandInteraction, type CommandBinding, type CommandDescriptor } from "./registry";
import { INTERACTION_INPUT, elementLabel, elementState, nativeInteraction, unavailableElement } from "./interactionEvents";
import { driveInteraction, needsInputDriver } from "./inputDriver";
interface Listener {
  type: string;
  original: EventListenerOrEventListenerObject;
  capture: boolean;
  wrapped: EventListener;
  release(): void;
  removeAbort?: () => void;
}
const listeners = new WeakMap<EventTarget, Listener[]>();
const collected = new FinalizationRegistry<() => void>(release => release());
let sequence = 0;
export function addCommandListenerArgs(target: EventTarget, args: unknown[], site: {
  id: string;
  source: string;
  label: string;
}) {
  addCommandListener(target, args[0] as string, args[1] as EventListenerOrEventListenerObject, args[2] as boolean | AddEventListenerOptions | undefined, site);
}
export function removeCommandListenerArgs(target: EventTarget, args: unknown[]) {
  removeCommandListener(target, args[0] as string, args[1] as EventListenerOrEventListenerObject, args[2] as boolean | EventListenerOptions | undefined);
}
// Registry closures must not own the element or its callback. The native
// listener and WeakMap keep the callback alive while its target is alive.
function listenerBinding(targetRef: WeakRef<EventTarget>, handlerRef: WeakRef<EventListenerOrEventListenerObject>, descriptor: CommandDescriptor, id: string, type: string): CommandBinding {
  return {
    id,
    label: () => { const target = targetRef.deref(); return elementLabel(target instanceof Element ? target : null, descriptor.label); },
    available: () => { const target = targetRef.deref(); return !target ? "This interaction is no longer mounted." : target instanceof Element ? unavailableElement(target) : undefined; },
    describe: () => { const target = targetRef.deref(); return { ...elementState(target instanceof Element ? target : null) as object, property: type }; },
    invoke(args, remote) {
      const target = targetRef.deref(), original = handlerRef.deref();
      if (!target || !original)
        throw new Error("This interaction is no longer mounted.");
      if (!remote)
        return typeof original === "function" ? original.call(target, args[0] as Event) : original.handleEvent(args[0] as Event);
      if (needsInputDriver(type))
        return dispatchCommandInteraction(descriptor.id, id, () => driveInteraction(target, type, args[0]));
      const eventTarget = /^key/.test(type) && (target === window || target === document) ? document.activeElement ?? target : target;
      return dispatchCommandInteraction(descriptor.id, id, () => eventTarget.dispatchEvent(nativeInteraction(eventTarget, type, args[0])));
    },
  };
}
export function addCommandListener(target: EventTarget, type: string, original: EventListenerOrEventListenerObject | null, options: boolean | AddEventListenerOptions | null | undefined, site: {
  id: string;
  source: string;
  label: string;
}) {
  options ??= undefined;
  if (!original || typeof options === "object" && options.signal?.aborted)
    return;
  const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
  const once = typeof options === "object" && Boolean(options.once);
  const existing = listeners.get(target) ?? [];
  if (existing.some(entry => entry.type === type && entry.original === original && entry.capture === capture))
    return;
  const id = `listener:${++sequence}`;
  const descriptor: CommandDescriptor = { ...site, id: `${site.id}.${type}`, kind: "interaction", input: INTERACTION_INPUT };
  const release = bindCommand(descriptor, listenerBinding(new WeakRef(target), new WeakRef(original), descriptor, id, type));
  const entry: Listener = {
    type, original, capture, release,
    wrapped: event => {
      try {
        invokeCommand(descriptor.id, id, [event]);
      }
      finally {
        if (once)
          removeCommandListener(target, type, original, capture);
      }
    },
  };
  existing.push(entry);
  listeners.set(target, existing);
  collected.register(target, release, entry);
  try {
    target.addEventListener(type, entry.wrapped, options);
    if (typeof options === "object" && options.signal) {
      const signal = options.signal, abort = () => removeCommandListener(target, type, original, options);
      signal.addEventListener("abort", abort, { once: true });
      entry.removeAbort = () => signal.removeEventListener("abort", abort);
    }
  }
  catch (error) {
    removeCommandListener(target, type, original, options);
    throw error;
  }
}
export function removeCommandListener(target: EventTarget, type: string, original: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions | null) {
  options ??= undefined;
  const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
  const entries = listeners.get(target) ?? [], index = entries.findIndex(entry => entry.type === type && entry.original === original && entry.capture === capture);
  if (index < 0) {
    target.removeEventListener(type, original, options);
    return;
  }
  const [entry] = entries.splice(index, 1);
  target.removeEventListener(type, entry.wrapped, options);
  entry.removeAbort?.();
  entry.release();
  collected.unregister(entry);
  if (!entries.length)
    listeners.delete(target);
}
