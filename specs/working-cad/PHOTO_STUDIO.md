# Product photo studio

Render view opens a collapsible Photo studio panel over the existing viewport.
Choose a finish, backdrop, lighting and camera composition, then select
**Download studio PNG**.
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

Softbox, Rim highlights and Warm workshop create local HDR lighting from broad
sources. Adjust light rotation to place reflections and exposure to set the
model brightness. Neutral tone mapping preserves detail in bright highlights.
The chosen environment supplies reflections while the backdrop stays a solid
color. Studio lighting is generated on demand and requires no texture downloads.

Ambient occlusion and ground shadows are enabled in Render and can be toggled
independently. Occlusion uses a half-resolution normals and depth pass, capped at
720 pixels on the long side, to shade nearby surfaces. Ground shadows project the
visible solids onto the XY plane just below the visible model and blur the result
in a 256-pixel buffer. The ground shadow cache follows geometry, placement,
visibility and clipping. Both effects wait for orbit to settle and apply to
studio PNGs. They leave Model view and project data untouched.

Lighting changes reuse existing native mesh buffers and request a frame only when
needed. The viewer stops drawing once idle. Studio controls and the environment
generator load lazily.

Native acceptance is in `e2e/studio.spec.ts`; built-app CSP and PNG acceptance is
in `production-e2e/studio.spec.ts`. Existing Render acceptance continues covering
motion/full-resolution capture and STL/save/open geometry compatibility.
