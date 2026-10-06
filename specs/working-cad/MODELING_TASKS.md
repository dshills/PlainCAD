# Consistent modeling tasks

Extrude, Revolve, Hole, Fillet and Chamfer share numbered Selection and Settings,
plain-language task guidance, native preview status and visible Cancel / Apply.
Essential profile, axis, target, centers and dimensions remain visible. Specialized
termination, name and reference controls use Advanced options in Workbench.
Full layout retains expanded controls. Lost/individual edge references expose
their explicit repair controls; a lost revolve line is visibly identified.

Changing settings still cancels superseded native workers. Apply remains guarded
by current document/session/component, validated native operation geometry and
the full downstream result for edits. Cancel changes no project history.
Drag tools use Fillet / Chamfer names consistently with the toolbar and dialogs.
This presentation change does not expand supported face/edge topology.

`src/tests/modelingTask.test.tsx` covers all five dialog surfaces, native Apply
gating, cancellation and lost-edge disclosure. Existing native operation acceptance
tests remain in the release gate; production Workbench tests exercise all five
editors through authored solid dimensions under CSP.
