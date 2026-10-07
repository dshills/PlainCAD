import type { CadDocument } from "./schema";
import type { CadBody } from "../worker/workerProtocol";
import { featureComponentId } from "./components";

/** Presentation identities only: native body IDs and authored feature names stay unchanged. */
export function bodyDisplayNames(
  document: CadDocument,
  bodies: readonly CadBody[],
): Record<string, string> {
  const owners = new Map(document.features.map((feature) => [
    `body:${feature.id}`, featureComponentId(document, feature),
  ]));
  const counts = new Map<string, number>();
  for (const body of bodies) {
    const owner = owners.get(body.id);
    if (owner) counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  const labels: Record<string, string> = Object.create(null);
  const used = new Set<string>();
  // Stable IDs determine duplicate suffixes, independent of current selection or body ordering.
  for (const body of [...bodies].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const owner = owners.get(body.id);
    const component = owner ? document.components[owner] : undefined;
    const bodyName = body.name.trim() || "Body";
    const base = component && owner && owner !== document.rootComponentId
      ? counts.get(owner) === 1 ? component.name : `${component.name} · ${bodyName}`
      : bodyName;
    let label = base;
    let suffix = 1;
    while (used.has(label.toLowerCase())) label = `${base}-${++suffix}`;
    used.add(label.toLowerCase());
    labels[body.id] = label;
  }
  return labels;
}
