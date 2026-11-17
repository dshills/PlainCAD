// Project files are fetched under connect-src 'self', including small examples.
const projectUrls = import.meta.glob<string>("../../../docs/examples/[0-9]*.pcaddoc", { query: "?url&no-inline", import: "default", eager: true });
const imageUrls = import.meta.glob<string>("../../../docs/examples/images/*.png", { query: "?url", import: "default", eager: true });
export interface GalleryExample { id: string; name: string; description: string; parts: number; features: number; complexity: string; parameter: string; projectUrl: string; thumbnail: string; plainSolidLimit?: string }
const rows = [
  ["01-cable-guide", "Cable guide mount", "Rounded foot, annular guide and mounting holes.", 2, 4, "Beginner", "foot_thickness: 5 → 6 mm"],
  ["02-spacer-stack", "Precision spacer stack", "Three annular parts with a shared bore.", 3, 3, "Beginner", "spacer_height: 20 → 24 mm"],
  ["03-angle-fixture", "Angle bracket fixture", "Joined bracket and horizontal alignment pins.", 3, 7, "Beginner", "web_height: 36 → 40 mm"],
  ["04-panel-standoffs", "Elevated instrument panel", "Drilled panel over four hollow supports.", 5, 7, "Intermediate", "post_height: 18 → 22 mm"],
  ["05-motor-flange", "Motor mounting flange", "Bearing boss, relief slots, shaft and fasteners.", 6, 16, "Intermediate", "flange_thickness: 8 → 10 mm"],
  ["06-flanged-valve", "Flanged valve cartridge", "Bored body, cover, plunger and gasket.", 8, 16, "Intermediate", "valve_height: 32 → 36 mm"],
  ["07-robot-gripper", "Parallel robot gripper", "Pocketed palm, slotted jaws and contact pads.", 11, 22, "Advanced", "jaw_span: 56 → 60 mm"],
  ["08-belt-drive", "Twin-pulley drive cassette", "Stepped pulleys, bearings and windowed cover.", 18, 29, "Advanced", "pulley_height: 10 → 12 mm"],
  ["09-heat-exchanger", "Sixteen-tube heat exchanger", "Bored headers, side-plane tubes and guard.", 28, 37, "Highly complex", "tube_length: 148 → 152 mm"],
  ["10-rotary-fixture", "Rotary machining fixture", "Turned hub, slotted platter and four clamps.", 40, 68, "Highly complex", "platter_thickness: 14 → 16 mm"],
  ["11-trapezoidal-lead-screw", "Trapezoidal lead screw and nut", "Right-hand, four-start thread with 2 mm pitch and 8 mm lead.", 2, 2, "Intermediate", "editing screw length in History"],
  ["12-acme-lead-screw", "Left-hand Acme lead screw and nut", "Two-start, ⅜-inch lead screw with 0.08-inch pitch and a linked nut.", 2, 2, "Intermediate", "editing handedness in History"],
  ["13-m6-threaded-pair", "M6 socket screw and tapped collar", "Metric M6 × 1 external and internal threads with a hex drive socket.", 2, 5, "Intermediate", "editing external thread length in History"],
  ["14-quarter-inch-unc", "Quarter-inch UNC screw and tapped block", "1/4-20 UNC socket screw and a rectangular block with a modeled internal thread.", 2, 5, "Intermediate", "editing internal thread length in History"],
] as const;
// Compatibility of these exact saved projects on the pinned PlainSolid kernel.
const plainSolidLimits: Partial<Record<typeof rows[number][0], string>> = {
  "03-angle-fixture": "The chamfer on the rounded bracket cannot rebuild in PlainSolid.",
  "05-motor-flange": "The flange's curved stock and boss union cannot rebuild in PlainSolid.",
  "06-flanged-valve": "The cartridge's curved union and side bore cannot rebuild in PlainSolid.",
  "07-robot-gripper": "The palm's actuator pocket cannot rebuild in PlainSolid.",
  "08-belt-drive": "The pulleys' stepped unions cannot rebuild in PlainSolid.",
  "09-heat-exchanger": "The headers' side-plane bores cannot rebuild in PlainSolid.",
};
export const GALLERY_EXAMPLES: GalleryExample[] = rows.map(([id, name, description, parts, features, complexity, parameter]) => ({
  id, name, description, parts, features, complexity, parameter, plainSolidLimit: plainSolidLimits[id],
  projectUrl: projectUrls[`../../../docs/examples/${id}.pcaddoc`], thumbnail: imageUrls[`../../../docs/examples/images/${id}.png`],
}));
