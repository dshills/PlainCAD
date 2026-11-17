// Project files are fetched under connect-src 'self', including small examples.
const projectUrls = import.meta.glob<string>("../../../docs/examples/*.pcaddoc", { query: "?url&no-inline", import: "default", eager: true });
const imageUrls = import.meta.glob<string>("../../../docs/examples/images/*.png", { query: "?url", import: "default", eager: true });
export const GALLERY_COLLECTIONS = ["Fixtures", "Enclosures", "Motion", "Hardware", "Shop tools"] as const;
export const GALLERY_DIFFICULTIES = ["Beginner", "Intermediate", "Advanced", "Highly complex"] as const;
type Collection = typeof GALLERY_COLLECTIONS[number];
type Difficulty = typeof GALLERY_DIFFICULTIES[number];

export interface GalleryExample { id: string; name: string; description: string; parts: number; features: number; collection: Collection; complexity: Difficulty; parameter: string; projectUrl: string; thumbnail: string }
const rows = [
  ["01-cable-guide", "Cable guide mount", "Rounded foot, annular guide and mounting holes.", 2, 4, "Fixtures", "Beginner", "changing foot_thickness from 5 to 6 mm"],
  ["02-spacer-stack", "Precision spacer stack", "Three annular parts with a shared bore.", 3, 3, "Hardware", "Beginner", "changing spacer_height from 20 to 24 mm"],
  ["03-angle-fixture", "Angle bracket fixture", "Joined bracket and horizontal alignment pins.", 3, 7, "Fixtures", "Beginner", "changing web_height from 36 to 40 mm"],
  ["04-panel-standoffs", "Elevated instrument panel", "Drilled panel over four hollow supports.", 5, 7, "Enclosures", "Intermediate", "changing post_height from 18 to 22 mm"],
  ["05-motor-flange", "Motor mounting flange", "Bearing boss, relief slots, shaft and fasteners.", 6, 16, "Motion", "Intermediate", "changing flange_thickness from 8 to 10 mm"],
  ["06-flanged-valve", "Flanged valve cartridge", "Bored body, cover, plunger and gasket.", 8, 16, "Hardware", "Intermediate", "changing valve_height from 32 to 36 mm"],
  ["07-robot-gripper", "Parallel robot gripper concept", "Pocketed palm, slotted jaws and contact pads.", 11, 22, "Motion", "Advanced", "changing jaw_span from 56 to 60 mm"],
  ["08-belt-drive", "Twin-pulley drive cassette", "Stepped pulleys, bearings and windowed cover.", 18, 29, "Motion", "Advanced", "changing pulley_height from 10 to 12 mm"],
  ["09-heat-exchanger", "Sixteen-tube heat exchanger", "Bored headers, side-plane tubes and guard.", 28, 37, "Hardware", "Highly complex", "changing tube_length from 148 to 152 mm"],
  ["10-rotary-fixture", "Rotary machining fixture concept", "Turned hub, slotted platter and four clamps.", 40, 68, "Fixtures", "Highly complex", "changing platter_thickness from 14 to 16 mm"],
  ["11-trapezoidal-lead-screw", "Trapezoidal lead screw and nut", "Right-hand, four-start thread with 2 mm pitch and 8 mm lead.", 2, 2, "Hardware", "Intermediate", "editing screw length in History"],
  ["12-acme-lead-screw", "Left-hand Acme lead screw and nut", "Two-start, ⅜-inch lead screw with 0.08-inch pitch and a linked nut.", 2, 2, "Hardware", "Intermediate", "editing handedness in History"],
  ["13-m6-threaded-pair", "M6 socket screw and tapped collar", "Metric M6 × 1 external and internal threads with a hex drive socket.", 2, 5, "Hardware", "Intermediate", "editing external thread length in History"],
  ["14-quarter-inch-unc", "Quarter-inch UNC screw and tapped block", "1/4-20 UNC socket screw and a rectangular block with a modeled internal thread.", 2, 5, "Hardware", "Intermediate", "editing internal thread length in History"],
  ["15-bench-stop", "Slotted bench stop", "A low fence with two mounting slots for locating work on a bench.", 1, 1, "Fixtures", "Beginner", "changing stop_height from 13 to 18 mm"],
  ["16-drill-guide", "Five-bore drill guide", "Five parallel guide bores in a thick block with a clipped nose.", 1, 2, "Fixtures", "Beginner", "changing guide_depth from 18 to 23 mm"],
  ["17-shelf-gusset", "Triangular shelf gusset", "A side-plane triangular brace with a lightening window and square mounting holes.", 1, 1, "Fixtures", "Beginner", "changing gusset_width from 8 to 12 mm"],
  ["18-switch-panel", "Dual-switch faceplate", "Two rectangular switch openings and four corner mounting holes in a clipped faceplate.", 1, 1, "Enclosures", "Beginner", "changing panel_thickness from 4 to 6 mm"],
  ["19-step-gauge", "Four-step setup gauge", "A stepped reference block extruded from its side profile.", 1, 1, "Fixtures", "Beginner", "changing gauge_width from 20 to 26 mm"],
  ["20-pulley-blank", "Flanged pulley blank", "A revolved wheel with two flanges, a central bore, and square shoulders.", 1, 1, "Motion", "Intermediate", "changing belt_width from 17 to 22 mm"],
  ["21-hose-reducer", "Tapered hose reducer", "A hollow turned reducer with two lips and a tapered wall.", 1, 1, "Shop tools", "Intermediate", "changing outlet_length from 16 to 22 mm"],
  ["22-spool-and-axle", "Cable spool and axle", "A turned reel beside its shouldered axle, laid out for inspection.", 3, 3, "Motion", "Intermediate", "changing spool_width from 22 to 30 mm"],
  ["23-vent-grille", "Louver-slot grille", "Six through-slots in a vent plate with a shared pitch parameter.", 1, 1, "Enclosures", "Intermediate", "changing slot_pitch from 11 to 12 mm"],
  ["24-soft-jaws", "Vise soft-jaw pair", "Matched jaws with relief steps and rectangular mounting slots on the front faces.", 2, 2, "Fixtures", "Intermediate", "changing jaw_depth from 14 to 19 mm"],
  ["25-bit-stand", "Hex-bit stand", "A faceted rack with eight hexagonal sockets and a separate bottom plate.", 2, 2, "Shop tools", "Intermediate", "changing socket_depth from 12 to 15 mm"],
  ["26-parts-tray", "Open parts tray", "An open rectangular tray with an editable uniform floor and wall thickness.", 1, 2, "Shop tools", "Beginner", "changing wall_thickness from 3 to 4 mm"],
  ["27-controller-case", "Controller enclosure and lid", "A shell-modeled case and separate lid with connector windows.", 2, 3, "Enclosures", "Intermediate", "changing case_wall from 2.5 to 3.5 mm"],
  ["28-din-mount", "DIN rail adapter bracket", "A hook and lower relief built into the side profile of a compact bracket.", 1, 1, "Fixtures", "Intermediate", "changing adapter_width from 26 to 34 mm"],
  ["29-pedal-platform", "Open pedal platform", "A faceted pedal blank with a central axle rib and four lightening windows.", 1, 1, "Motion", "Intermediate", "changing platform_depth from 11 to 15 mm"],
  ["30-lab-rack", "Eight-position sample rack", "Two drilled decks spaced by four posts with one shared clearance parameter.", 6, 8, "Shop tools", "Advanced", "changing rack_clearance from 28 to 36 mm"],
  ["31-reel-stand", "Reel stand assembly", "Side plates, spindle, and base model a multi-part stand with linked width.", 4, 4, "Motion", "Advanced", "changing stand_width from 48 to 56 mm"],
  ["32-bending-die", "Bench bending die set", "A V-block and matching wedge punch on an offset blank plate.", 3, 3, "Fixtures", "Advanced", "changing die_length from 34 to 42 mm"],
  ["orbit-drive-housing", "ORBIT drive housing", "A recessed drive housing with a bearing bore, counterbores, and relief slots.", 1, 16, "Enclosures", "Advanced", "changing bore_diameter from 40 to 38 mm"],
] as const satisfies ReadonlyArray<readonly [string, string, string, number, number, Collection, Difficulty, string]>;
export const GALLERY_EXAMPLES: GalleryExample[] = rows.map(([id, name, description, parts, features, collection, complexity, parameter]) => ({
  id, name, description, parts, features, collection, complexity, parameter,
  projectUrl: projectUrls[`../../../docs/examples/${id}.pcaddoc`], thumbnail: imageUrls[`../../../docs/examples/images/${id}.png`],
}));
