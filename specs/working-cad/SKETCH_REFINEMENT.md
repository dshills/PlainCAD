# Bounded local sketch refinement

Open a sketch and the AI drawer to refine existing geometry. The sketch-specific
composer understands these exact requests locally:

- `make this rectangle 60 x 40 mm` (also `resize selected rectangle ...`).
- `make selected lines horizontal`.
- `make selected lines vertical`.

Lengths accept positive decimal values with mm, cm or in units. Bare lengths use
the project's authored length unit. With multiple profiles, select edges or
corner points of exactly one closed, axis-aligned rectangle. Rotated rectangles,
nested regions and arbitrary natural-language sketch changes are diagnosed.
Requests are capped at 1,000 characters and sketches at 512 entities; line
relations refine at most 32 selected lines per request. No provider request is sent for this workflow, including unsupported prompts.

Preview stages an immutable document, solves its constraints and rebuilds all
features in the native worker. Review lists the proposed dimensions/relations,
shows solved sketch geometry, and shows native downstream meshes/volume when
features exist. A bare sketch explicitly reports solve/profile validation and
states that no solid was modeled. Apply is enabled only for a successful current
preview; it commits one undoable edit. Cancel leaves the project unchanged.

Existing sketch entities, features and driving dimension IDs remain stable.
Missing horizontal/vertical relations and driving lengths are added. Successful
changes activate driving solves for legacy validate-mode sketches; an already
present relation never changes solve mode. Solved unbound point coordinates and
circle radii become explicit millimeter seeds so Undo restores geometry even
when the worker has a more recent solve seed. Parameter-bound expressions stay
intact. Existing
literal side-length dimensions are updated together so opposite sides preserve
rectangle intent. Parameter-bound coordinates/dimensions and other touching
driving dimensions require explicit ordinary parameter/dimension edits; this
workflow never silently replaces their bindings. Conflicting fixed or other
constraints fail before Apply rather than being removed automatically.

A runtime base-revision identity and private worker-result proof bind every
proposal to its captured document and exact staged plan. Apply rejects a
result from another proposal even when both documents have the same durable ID.
Project/session/component/sketch and selection identity guards discard stale
previews. Pending pointer gestures are canceled before capture and Apply; the
shared transient task guard blocks competing document changes while a proposal
is pending. Changing a selection invalidates the old proposal. Closing the AI
drawer or canceling aborts the request and disposes its worker through the
existing preview lifecycle. Chat and preview meshes are not project data. The normal AI drawer composer
state remains mounted in its parent while sketch controls replace its visible
body; prompts and conversation persist. A pending component-generation preview
is canceled on entering a sketch so it cannot compete with sketch editing.

Regression coverage includes stable IDs, exact solved width/height, constraint
conflicts, shared-binding preservation, unsupported requests, Cancel/one Undo,
same-ID replacement and late replies. Browser acceptance imports an authored
24 × 16 × 8 extrusion, previews/refines it to 60 × 40 × 8 with native volume
19,200 mm³, and verifies save/open and STL. Mocked unit worker results establish
control-flow behavior; real native geometry is established by browser checks.
