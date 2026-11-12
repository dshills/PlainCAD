# Local native STEP import

Choose **File → Import STEP solid** or search for it in the command palette.
Select a local `.step`/`.stp` file. PlainCAD shows a native preview of the new
solid at its original position alongside the current project. **Add STEP solid**
creates one component and its imported body as one Undo step. Cancel discards
the draft. Replacing the project or changing its current rebuild cancels pending
work and invalidates Apply.
The tool becomes available after a successful current native rebuild confirms
the reader and filesystem bindings, including on an empty project. Finish an
active face-picking or modeling task before starting or applying an import.

The first import scope accepts one ISO-10303-21 STEP root that resolves to one
closed native solid. Assemblies, compounds, open surfaces, references to
external files and guessed original parametric history are unsupported.
The native reader interprets STEP units in millimetres and retains coordinates
and orientation. BRep validity, positive exact volume and area, finite bounds,
one solid and tessellation limits must pass. Bounds are limited to ±100,000,000
mm. Imported solids can be moved as components, used as explicit native boolean
targets and exported to validated STEP/STL. Imported topology has no authored
face or edge roles for drawing or edge treatment.

Each plain ASCII source is limited to 512 KiB and 12,000 entity declarations.
The combined embedded source limit is 2 MiB per project; the existing portable
project and native resource limits still apply. Preview runs in the disposable
30-second native worker. The STEP reader's filesystem access is confined to
the task-owned source file. Native failures identify the imported feature and
never publish fallback geometry.

Schema 21 stores a bounded original STEP source string on each import feature.
The ordinary native rebuild reads it again after save/open; no external path,
kernel handle, mesh or preview proof is saved. Older project files migrate
without added import features. The built-in provider command agent does not
accept projects with STEP sources. Local commands can inspect and modify the
project without uploading imported data.

The shared JSON command `file.importStep` takes
`{ "file": { "name": "part.step", "text": "<STEP source>" } }` to stage a
preview. Omit the file to open the interactive picker. Use
`file.applyStepImport` to commit the latest valid preview or
`file.cancelStepImport` to discard it. All calls use the current session;
scripts cannot supply or reconstruct a preview proof.

The schema-21 regression fixture contains a generated rotated and translated
bored solid. Native tests check exact volume, unit conversion, failed source
cleanup and a subsequent native cut/re-export. The browser workflow also checks
preview/cancel, one-step Undo/Redo, save/open, signed STL volume and stale
preview rejection. A built-app case exercises the same portable import under CSP.
