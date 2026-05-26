import { CadDocument } from "../cad/document/schema";

export const orderedParameters = (document: CadDocument) =>
  Object.values(document.parameters).sort((a, b) => a.name.localeCompare(b.name));

export const orderedSketches = (document: CadDocument) =>
  Object.values(document.sketches).sort((a, b) => a.name.localeCompare(b.name));

export const orderedFeatures = (document: CadDocument) => document.features;
