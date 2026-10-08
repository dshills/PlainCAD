import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION } from "../cad/document/schema";
import { captureConfiguration, configurationDocument, deleteConfiguration, editConfigurationExpression } from "../cad/document/productConfigurations";
import { renameParameter } from "../cad/parameters/expressionBindings";
import { evaluateParameters } from "../cad/parameters/expressionEvaluator";
import { importProjectText } from "../persistence/projectCodec";
import { serializeProject } from "../persistence/exportProject";
import { validateDocument } from "../cad/document/validate";
const load = () => importProjectText(readFileSync("src/persistence/fixtures/schema-v20.pcaddoc", "utf8"));
it("migrates earlier schemas without changing native inputs and round-trips configuration identities", () => {
  const legacy = JSON.parse(readFileSync("src/persistence/fixtures/schema-v19.pcaddoc", "utf8")); legacy.configurations = [{ name: "unknown legacy metadata" }];
  const migrated = importProjectText(JSON.stringify(legacy)); expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION); expect(migrated.configurations).toBeUndefined(); expect(migrated.features.map(feature => feature.id)).toEqual(legacy.features.map((feature: { id: string }) => feature.id));
  const document = load(); expect(serializeProject(importProjectText(serializeProject(document)))).toBe(serializeProject(document)); expect(configurationDocument(document, "configuration-large").parameters.width.expression).toBe("30mm"); expect(document.parameters.width.expression).toBe("20mm");
});
it("preserves derived expressions and stable bindings through parameter rename", () => {
  let document = load(); document = { ...document, parameters: { ...document.parameters, double: { id: "double-parameter", name: "double", expression: "width * 2", value: 40, unit: "mm" } } };
  document = captureConfiguration(document, "Derived"); const id = document.configurations!.at(-1)!.id;
  document = renameParameter(document, document.parameters.width.id, "span"); document = editConfigurationExpression(document, id, document.parameters.span.id, "30mm");
  const candidate = configurationDocument(document, id); expect(candidate.parameters.double.expression).toBe("span * 2"); expect(evaluateParameters(candidate.parameters).values.double.value).toBe(60);
  expect(document.parameters.span.expression).toBe("20mm");
});
it("reports deleted and newly locked targets while inactive variants remain loadable", () => {
  const document = load(), removed = { ...document, parameters: {} };
  expect(validateDocument(removed, "storage")).toEqual([]); expect(() => configurationDocument(removed, "configuration-large")).toThrow(/deleted parameter/);
  const locked = { ...document, parameters: { width: { ...document.parameters.width, locked: true } } }; expect(() => configurationDocument(locked, "configuration-large")).toThrow(/locked/);
});
it("diagnoses invalid inactive expressions on Apply and preserves new parameter inheritance", () => {
  let document = load(); document = { ...document, parameters: { ...document.parameters, added: { id: "added-parameter", name: "added", expression: "7mm", value: 7, unit: "mm" } } };
  expect(configurationDocument(document, "configuration-small").parameters.added.expression).toBe("7mm");
  document = editConfigurationExpression(document, "configuration-large", document.parameters.width.id, "unknown + 1mm");
  expect(importProjectText(serializeProject(document)).configurations).toHaveLength(2); expect(() => configurationDocument(document, "configuration-large")).toThrow(/unknown/i);
  expect(configurationDocument(document, "configuration-small").parameters.width.expression).toBe("20mm");
});
it("enforces unique names, parameter scopes and resource limits; supports immutable recapture/delete", () => {
  const document = load(); expect(() => captureConfiguration(document, " small ")).toThrow(/unique/);
  const updated = captureConfiguration(document, "Renamed", "configuration-small"); expect(updated.configurations![1].id).toBe("configuration-small"); expect(document.configurations![0].name).toBe("Small"); expect(deleteConfiguration(updated, "configuration-small").configurations).toHaveLength(1);
  expect(() => importProjectText(JSON.stringify({ ...document, configurations: Array.from({ length: 17 }, (_, index) => ({ ...document.configurations![0], id: `configuration-${index}`, name: `Variant ${index}` })) }))).toThrow(/16/);
  expect(() => editConfigurationExpression(document, "configuration-small", document.parameters.width.id, "1".repeat(1025))).toThrow(/resource/);
  const bad = structuredClone(document); bad.configurations![0].parameters.push(bad.configurations![0].parameters[0]); expect(() => importProjectText(JSON.stringify(bad))).toThrow(/duplicated/);
});
it("replaces expression metadata rather than inheriting stale live bindings or units", () => {
  const document = load(); const changed = { ...document, parameters: { width: { ...document.parameters.width, expression: "other * 2", authoredUnit: "cm", parameterRefs: { other: "other-parameter" } }, other: { id: "other-parameter", name: "other", expression: "3mm", value: 3, unit: "mm" } } };
  const candidate = configurationDocument(changed, "configuration-small"); expect(candidate.parameters.width.expression).toBe("20mm"); expect(candidate.parameters.width.parameterRefs).toBeUndefined(); expect(candidate.parameters.width.authoredUnit).toBe(""); expect(evaluateParameters(candidate.parameters).values.width.value).toBe(20);
});
it("uses the parameter dimension as the default for unitless edits while explicit units retain their meaning", () => {
  const document = { ...load(), unitSettings: { length: "cm" as const, angle: "deg" as const } };
  const scalar = configurationDocument(editConfigurationExpression(document, "configuration-large", document.parameters.width.id, "3"), "configuration-large");
  expect(evaluateParameters(scalar.parameters).values.width).toMatchObject({ dimension: "length", value: 30 });
  const angle = configurationDocument(editConfigurationExpression(document, "configuration-large", document.parameters.width.id, "90deg"), "configuration-large");
  expect(evaluateParameters(angle.parameters).values.width.dimension).toBe("angle"); expect(evaluateParameters(angle.parameters).values.width.value).toBeCloseTo(Math.PI / 2);
});
it("keeps captured projects within the import byte limit and diagnoses unavailable defaults", () => {
  const document = load();
  expect(() => captureConfiguration({ ...document, parameters: { width: { ...document.parameters.width, locked: true } } }, "Locked")).toThrow(/No unlocked/);
  expect(() => captureConfiguration({ ...document, metadata: { padding: "x".repeat(5 * 1024 * 1024) } }, "Large project")).toThrow(/5 MiB/);
  expect(() => editConfigurationExpression({ ...document, parameters: { width: { ...document.parameters.width, expression: "missing" } } }, "configuration-large", document.parameters.width.id, "3")).toThrow(/active parameter/);
});
