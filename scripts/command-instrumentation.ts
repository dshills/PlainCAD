import ts from "typescript";
import { createHash } from "node:crypto";
import { relative, dirname, resolve } from "node:path";
import type { Plugin } from "vite";
import MagicString from "magic-string";
const INPUT_EVENTS = new Set(["click", "dblclick", "contextmenu", "keydown", "keyup", "pointerdown", "pointermove", "pointerup", "pointercancel", "pointerleave", "mousedown", "mousemove", "mouseup", "mouseleave", "dragstart", "dragend", "dragover", "dragenter", "dragleave", "drop", "focusin", "focusout", "blur", "wheel"]);
/** Source-based IDs, not DOM selectors. All production and test builds use this. */
export function commandInstrumentation(): Plugin {
  const root = resolve(import.meta.dirname, "..").replaceAll("\\", "/");
  return { name: "plaincad-command-instrumentation", enforce: "pre", transform(code, id) {
      const path = id.split("?")[0].replaceAll("\\", "/");
      if (!/\.[jt]sx?$/.test(path) || !path.startsWith(`${root}/src/`) || (path.includes("/commands/") && !path.includes("/ui/commands/")) || path.includes("/tests/"))
        return;
      if (!/\b(?:addEventListener|removeEventListener)\b|<[A-Za-z]/.test(code))
        return;
      const source = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const sourceName = relative(root, path).replaceAll("\\", "/"), edits: {
        at: number;
        text: string;
        order: number;
      }[] = [], replacements: {
        start: number;
        end: number;
        text: string;
      }[] = [];
      const counts = new Map<string, number>();
      let jsx = false, events = false;
      const site = (node: ts.Node, purpose: string, label: string) => {
        const normalized = `${purpose}:${node.getText(source).replace(/\s+/g, " ")}`, hash = createHash("sha256").update(normalized).digest("hex").slice(0, 12), base = `ui.${sourceName.replace(/^src\//, "").replace(/\.[jt]sx?$/, "").replaceAll("/", ".")}.${hash}`, occurrence = counts.get(base) ?? 0;
        counts.set(base, occurrence + 1);
        return { id: occurrence ? `${base}.${occurrence}` : base, source: sourceName, label: label.slice(0, 100) };
      };
      const visit = (node: ts.Node) => {
        if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
          const opening = ts.isJsxElement(node) ? node.openingElement : node, tag = opening.tagName.getText(source), attributes = opening.attributes.properties;
          const properties = attributes.filter((attr): attr is ts.JsxAttribute => ts.isJsxAttribute(attr) && /^on[A-Z]/.test(attr.name.getText(source))).map(attr => attr.name.getText(source));
          const implicit = tag === "button" || tag === "summary" || tag === "a" ? "onClick" : ["input", "select", "textarea"].includes(tag) ? "onChange" : undefined;
          if (implicit && !properties.includes(implicit))
            properties.push(implicit);
          if (properties.length || attributes.some(ts.isJsxSpreadAttribute)) {
            const labelAttribute = attributes.find((attr): attr is ts.JsxAttribute => ts.isJsxAttribute(attr) && ["aria-label", "label", "ariaLabel", "title"].includes(attr.name.getText(source)));
            const label = labelAttribute?.initializer && ts.isStringLiteral(labelAttribute.initializer) ? labelAttribute.initializer.text : tag;
            const data = { ...site(opening, "jsx", label), properties }, key = attributes.find((attr): attr is ts.JsxAttribute => ts.isJsxAttribute(attr) && attr.name.getText(source) === "key");
            const keyText = key ? ` ${key.getText(source)}` : "";
            edits.push({ at: node.getStart(source), text: `<PlainCadCommandHost${keyText} site={${JSON.stringify(data)}} element={`, order: 1 }, { at: node.end, text: "} />", order: -1 });
            jsx = true;
          }
        }
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ["addEventListener", "removeEventListener"].includes(node.expression.name.text) && node.arguments.length >= 2 && ts.isStringLiteral(node.arguments[0]) && INPUT_EVENTS.has(node.arguments[0].text)) {
          const add = node.expression.name.text === "addEventListener", target = node.expression.expression.getText(source);
          const metadata = site(node, "listener", `${sourceName.split("/").at(-1)} · ${node.arguments[0].getText(source)}`);
          const chain = (node: ts.Node): boolean => (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isCallExpression(node)) && (Boolean(node.questionDotToken) || chain(node.expression));
          if (chain(node.expression.expression))
            throw new Error(`Extract the earlier optional chain into a guarded EventTarget before registering an input listener in ${sourceName}.`);
          const optionalTarget = Boolean(node.expression.questionDotToken), optionalCall = Boolean(node.questionDotToken), optional = optionalTarget || optionalCall;
          const condition = [optionalTarget ? "plaincadTarget == null" : "", optionalCall ? `plaincadTarget.${node.expression.name.text} == null` : ""].filter(Boolean).join(" || ");
          // Replace only the call head and insert an argument-array boundary.
          // Nested listeners/JSX and spread arguments remain recursively visited.
          const head = `${optional ? `((plaincadTarget) => ${condition} ? undefined : ` : ""}${add ? "plaincadAddCommandListenerArgs" : "plaincadRemoveCommandListenerArgs"}(${optional ? "plaincadTarget" : target}, [`;
          replacements.push({ start: node.getStart(source), end: node.arguments[0].getStart(source), text: head });
          edits.push({ at: node.end - 1, text: `]${add ? `, ${JSON.stringify(metadata)}` : ""}`, order: 0 });
          if (optional)
            edits.push({ at: node.end, text: `)(${target})`, order: -1 });
          events = true;
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      if (!jsx && !events)
        return;
      for (const replacement of replacements) {
        if (edits.some(edit => edit.at > replacement.start && edit.at < replacement.end))
          throw new Error(`Command instrumentation cannot rewrite overlapping listeners in ${sourceName}. Extract that callback first.`);
      }
      const operations = [...edits.map(edit => ({ start: edit.at, end: edit.at, text: edit.text, order: edit.order })), ...replacements.map(edit => ({ ...edit, order: 0 }))].sort((a, b) => b.start - a.start || b.order - a.order);
      const output = new MagicString(code);
      for (const operation of operations) {
        if (operation.start === operation.end)
          output.prependLeft(operation.start, operation.text);
        else
          output.overwrite(operation.start, operation.end, operation.text);
      }
      const modulePath = (name: string) => { const importPath = relative(dirname(path), resolve(root, `src/commands/${name}`)).replaceAll("\\", "/"); return importPath.startsWith(".") ? importPath : `./${importPath}`; };
      let imports = "";
      if (jsx)
        imports += `import { CommandHost as PlainCadCommandHost } from ${JSON.stringify(modulePath("CommandHost"))};\n`;
      if (events)
        imports += `import { addCommandListenerArgs as plaincadAddCommandListenerArgs, removeCommandListenerArgs as plaincadRemoveCommandListenerArgs } from ${JSON.stringify(modulePath("nativeEvents"))};\n`;
      let importAt = code.startsWith("#!") ? code.indexOf("\n") + 1 : 0;
      for (const statement of source.statements) {
        if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression))
          break;
        importAt = statement.end;
      }
      output.appendLeft(importAt, `\n${imports}`);
      return { code: output.toString(), map: output.generateMap({ source: path, includeContent: true, hires: true }) };
    } };
}
