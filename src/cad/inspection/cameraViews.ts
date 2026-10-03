import type { CadDocument, CameraPose, NamedView } from "../document/schema";
import { createId } from "../document/ids";
export const DEFAULT_CAMERA_POSE: CameraPose = {
  cameraPosition: [120, -140, 110],
  cameraTarget: [0, 0, 0],
  cameraUp: [0, 0, 1],
};
export function cameraClipRange(distance: number, span: number) {
  const far = Math.max(distance * 100, distance + span * 4, 0.001);
  return { near: Math.max(distance / 1000, far / 1e6, 1e-6), far };
}
export function unusedViewName(document: CadDocument): string {
  const names = new Set(
    document.viewState?.namedViews?.map((view) =>
      view.name.trim().toLowerCase(),
    ) ?? [],
  );
  let index = 1;
  while (names.has(`view ${index}`)) index += 1;
  return `View ${index}`;
}
export const MAX_NAMED_VIEWS = 20;
export const STANDARD_VIEWS = ["top", "front", "right", "isometric"] as const;
export type StandardView = (typeof STANDARD_VIEWS)[number];
export const VIEW_DIRECTIONS: Record<
  StandardView,
  { direction: [number, number, number]; up: [number, number, number] }
> = {
  top: { direction: [0, 0, 1], up: [0, 1, 0] },
  front: { direction: [0, -1, 0], up: [0, 0, 1] },
  right: { direction: [1, 0, 0], up: [0, 0, 1] },
  isometric: { direction: [1, -1, 1], up: [0, 0, 1] },
};
function vector(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every(
      (v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e9,
    )
  );
}
export function validCameraPose(value: unknown): value is CameraPose {
  if (!value || typeof value !== "object") return false;
  const pose = value as Partial<CameraPose>;
  if (
    !vector(pose.cameraPosition) ||
    !vector(pose.cameraTarget) ||
    !vector(pose.cameraUp)
  )
    return false;
  const d = pose.cameraPosition.map((v, i) => v - pose.cameraTarget![i]),
    u = pose.cameraUp;
  const length = Math.hypot(...d),
    upLength = Math.hypot(...u);
  const cross = Math.hypot(
    d[1] * u[2] - d[2] * u[1],
    d[2] * u[0] - d[0] * u[2],
    d[0] * u[1] - d[1] * u[0],
  );
  return (
    length > 1e-6 &&
    Math.abs(upLength - 1) < 1e-6 &&
    cross / (length * upLength) > 1e-6
  );
}
export function saveNamedCamera(
  document: CadDocument,
  name: string,
  pose: CameraPose,
): CadDocument {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80)
    throw new Error("View name must contain 1–80 characters.");
  const views = document.viewState?.namedViews ?? [];
  if (
    views.some(
      (view) => view.name.trim().toLowerCase() === trimmed.toLowerCase(),
    )
  )
    throw new Error(
      "A view with this name already exists. Choose a different name.",
    );
  if (views.length >= MAX_NAMED_VIEWS)
    throw new Error(
      `A project supports at most ${MAX_NAMED_VIEWS} named views.`,
    );
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  const normalized = {
    cameraPosition: pose.cameraPosition.map(
      round,
    ) as CameraPose["cameraPosition"],
    cameraTarget: pose.cameraTarget.map(round) as CameraPose["cameraTarget"],
    cameraUp: pose.cameraUp.map(
      (v) => Math.round(v * 1e9) / 1e9,
    ) as CameraPose["cameraUp"],
  };
  if (!validCameraPose(normalized))
    throw new Error("Camera pose is invalid or too small to save.");
  const view: NamedView = {
    id: createId("view"),
    name: trimmed,
    ...normalized,
  };
  return {
    ...document,
    updatedAt: new Date().toISOString(),
    viewState: { ...document.viewState, namedViews: [...views, view] },
  };
}
export function removeNamedCamera(
  document: CadDocument,
  id: string,
): CadDocument {
  const views = document.viewState?.namedViews ?? [];
  if (!views.some((view) => view.id === id)) return document;
  return {
    ...document,
    updatedAt: new Date().toISOString(),
    viewState: {
      ...document.viewState,
      namedViews: views.filter((view) => view.id !== id),
    },
  };
}
export type SectionAxis = "X" | "Y" | "Z";
export function sectionPlane(
  axis: SectionAxis,
  offset: number,
  positive = true,
) {
  if (
    !["X", "Y", "Z"].includes(axis) ||
    !Number.isFinite(offset) ||
    Math.abs(offset) > 1e9
  )
    throw new Error("Section offset must be finite and within ±1e9 mm.");
  const sign = positive ? 1 : -1;
  const normal: [number, number, number] =
    axis === "X" ? [sign, 0, 0] : axis === "Y" ? [0, sign, 0] : [0, 0, sign];
  return { normal, constant: offset === 0 ? 0 : -sign * offset };
}
