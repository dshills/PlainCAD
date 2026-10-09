import { cloneElement, useCallback, useId, useLayoutEffect, useRef, type ReactElement, type Ref } from "react";
import { bindCommand, invokeScopedCommand, dispatchCommandInteraction, type CommandBinding, type CommandDescriptor } from "./registry";
import { INTERACTION_INPUT, elementLabel, elementState, reactInteraction, unavailableElement } from "./interactionEvents";
import { driveInteraction, needsInputDriver } from "./inputDriver";
export interface InteractionSite {
  id: string;
  source: string;
  label: string;
  properties: string[];
}
type Props = Record<string, unknown>;
function setRef(ref: Ref<unknown> | undefined, value: unknown) {
  if (typeof ref === "function")
    return ref(value);
  if (ref)
    ref.current = value;
}
/** Build instrumentation puts every interaction behind this same registry adapter. */
export function CommandHost({ element, site }: {
  element: ReactElement<Props>;
  site: InteractionSite;
}) {
  const target = useId(), node = useRef<Element | null>(null), native = typeof element.type === "string";
  const originalRef = element.props.ref as Ref<unknown> | undefined;
  const ref = useCallback((value: Element | null) => {
    node.current = value;
    const cleanup = setRef(originalRef, value);
    if (value && typeof cleanup === "function")
      return () => { node.current = null; cleanup(); };
  }, [originalRef]);
  const properties = [...new Set([...site.properties, ...Object.keys(element.props).filter(key => /^on[A-Z]/.test(key) && typeof element.props[key] === "function")])];
  const definitions = properties.map(property => {
    const handler = element.props[property] as ((...args: unknown[]) => unknown) | undefined;
    const descriptor: CommandDescriptor = { id: `${site.id}.${property}`, label: `${site.label} · ${property}`, source: site.source, kind: "interaction", input: native ? INTERACTION_INPUT : { type: "object", additionalProperties: false } };
    const binding: CommandBinding = {
      id: target,
      label: () => elementLabel(node.current, String(element.props["aria-label"] ?? element.props.ariaLabel ?? element.props.label ?? descriptor.label)),
      available: () => native ? unavailableElement(node.current) : "Use the corresponding mounted field or button command.",
      describe: () => ({ ...elementState(node.current) as object, property }),
      invoke: (args, remote) => {
        if (!remote)
          return handler?.(...args);
        if (!native)
          throw new Error("Use the corresponding mounted field or button command.");
        if (!node.current?.isConnected) throw new Error("This interaction is no longer mounted. Refresh command discovery.");
        if (needsInputDriver(property))
          return dispatchCommandInteraction(descriptor.id, target, () => driveInteraction(node.current!, property, args[0]));
        if (property === "onSubmit" && node.current instanceof HTMLFormElement) {
          reactInteraction(node.current, property, args[0]);
          const submit = [...node.current.elements].find(element => (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) && element.type === "submit" && !unavailableElement(element)) as HTMLButtonElement | HTMLInputElement | undefined;
          if (!submit)
            throw new Error("This form has no enabled submit action. Use its available button command.");
          if (!node.current.checkValidity())
            throw new Error("Complete the required form fields before submitting.");
          return dispatchCommandInteraction(descriptor.id, target, () => (node.current as HTMLFormElement).requestSubmit(submit));
        }
        // Deliver click/focus through React's event path, including capture and
        // ancestor guards. Calling only the leaf callback would skip those.
        const eventProperty = property.replace(/Capture$/, "");
        if (eventProperty === "onChange" || eventProperty === "onInput") {
          const control = node.current;
          const wasChecked = control instanceof HTMLInputElement ? control.checked : false;
          if (control instanceof HTMLInputElement && ["checkbox", "radio"].includes(control.type) && eventProperty === "onChange") {
            const checked = (args[0] as { checked?: boolean } | undefined)?.checked;
            if (typeof checked !== "boolean") throw new Error("Supply checked for a checkbox/radio change.");
            if (control.type === "radio" && !checked) throw new Error("Select another radio option rather than unchecking this one.");
          }
          const event = reactInteraction(control, property, args[0]);
          return dispatchCommandInteraction(descriptor.id, target, () => {
            if (control instanceof HTMLInputElement && ["checkbox", "radio"].includes(control.type) && eventProperty === "onChange") {
              const checked = (args[0] as { checked?: boolean }).checked;
              if (checked === undefined) throw new Error("Supply checked for a checkbox/radio change.");
              if (control.type === "radio" && !checked) throw new Error("Select another radio option rather than unchecking this one.");
              if (wasChecked === checked) return;
              Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")!.set!.call(control, control.type === "checkbox" ? !checked : false);
              control.click();
            } else if (control instanceof HTMLInputElement && control.type !== "file" || control instanceof HTMLTextAreaElement) control.dispatchEvent(new Event("input", { bubbles: true }));
            else control.dispatchEvent(event.nativeEvent);
          });
        }
        if (["onClick", "onDoubleClick", "onContextMenu", "onFocus", "onBlur", "onKeyDown", "onKeyUp"].includes(eventProperty)) {
          const event = reactInteraction(node.current, property, args[0]);
          const control = node.current as HTMLElement;
          if (eventProperty === "onFocus" || eventProperty === "onBlur") {
            const before = document.activeElement;
            if (eventProperty === "onFocus") {
              control.focus();
              if (document.activeElement !== control)
                throw new Error("This target cannot receive focus. Choose a focusable field or button.");
            }
            else
              control.blur();
            return { focused: document.activeElement === control, changed: before !== document.activeElement };
          }
          return dispatchCommandInteraction(descriptor.id, target, () => {
            if (eventProperty === "onClick" && Object.keys((args[0] ?? {}) as object).length === 0 && typeof control.click === "function") control.click();
            else control.dispatchEvent(event.nativeEvent);
          });
        }
        const event = reactInteraction(node.current, property, args[0]);
        if (handler)
          return handler(event);
        if (property === "onChange") {
          node.current?.dispatchEvent(event.nativeEvent);
          return;
        }
        throw new Error("This control has no scripted action handler.");
      },
    };
    return { property, descriptor, binding };
  });
  useLayoutEffect(() => {
    const releases = definitions.map(({ descriptor, binding }) => bindCommand(descriptor, binding));
    return () => { releases.forEach(release => release()); };
  });
  const props: Props = {};
  for (const { property, descriptor, binding } of definitions) {
    if (!native && typeof element.props[property] !== "function") continue;
    props[property] = (...args: unknown[]) => {
      // autoFocus and blur can fire during commit before layout registration.
      // Register that event's current handler temporarily through the same executor.
      return invokeScopedCommand(descriptor, binding, args);
    };
  }
  if (native) {
    props["data-command-site"] = site.id;
    props["data-command-target"] = target;
    props.ref = ref;
  }
  return cloneElement(element, props);
}
