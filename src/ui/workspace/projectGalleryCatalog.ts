const projectUrls = import.meta.glob<string>("../../../docs/examples/[0-9]*.pcaddoc", { query: "?url", import: "default", eager: true });
const imageUrls = import.meta.glob<string>("../../../docs/examples/images/*.png", { query: "?url", import: "default", eager: true });
export interface GalleryExample { id: string; name: string; description: string; parts: number; features: number; complexity: string; parameter: string; projectUrl: string; thumbnail: string }
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
] as const;
export const GALLERY_EXAMPLES: GalleryExample[] = rows.map(([id, name, description, parts, features, complexity, parameter]) => ({ id, name, description, parts, features, complexity, parameter, projectUrl: projectUrls[`../../../docs/examples/${id}.pcaddoc`], thumbnail: imageUrls[`../../../docs/examples/images/${id}.png`] }));
