# Product photo studio

Render view opens a collapsible Photo studio panel over the existing viewport.
Choose a finish, backdrop and camera composition, then Download studio PNG.
The PNG captures the actual current native model, visible bodies, section and
camera at full resolution. It excludes the HTML studio controls and CAD editing
overlays. Existing rebuild and stale-document export checks still apply.

Original part colors preserve the existing Render appearance. Metallic
approximation uses neutral color, roughness 0.48 and metalness 0.65; it does not
simulate directional brush textures. Powder coat approximation retains each
part's color with roughness 0.85 and metalness 0. These are display presets for
all visible parts, not engineering material assignments or per-body finishes.

Backdrops are the current UI theme, neutral gray, warm paper or midnight.
Hero, Top, Front and Right use the existing standard CAD camera directions and
fit the currently visible bodies. Manual orbit/pan/zoom stays available. Studio
settings persist while switching Model/Render within a project session; opening
any project resets them. Model restores the original colors, lighting and theme
background. Saved named camera views remain the existing way to retain a pose.
Studio preferences never enter project JSON or Undo history.

Appearance changes reuse the existing native geometry buffers, materials and
four fixed studio lights. No texture downloads, shadow maps, extra render passes
or continuous animation are added. The demand renderer continues sleeping when
idle. Studio controls and detailed Views controls load lazily to keep the initial
JavaScript within the bundle budget.

Native acceptance is in `e2e/studio.spec.ts`; built-app CSP and PNG acceptance is
in `production-e2e/studio.spec.ts`. Existing Render acceptance continues covering
motion/full-resolution capture and STL/save/open geometry compatibility.
