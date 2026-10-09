# Modeling workflows

Open the bottom **Automation** dock, click **Record workflow**, make supported semantic CAD edits,
then **Stop recording**. Give the workflow a name and save it. Interface navigation,
camera movement, input keystrokes and generated UI command IDs are excluded.
Only successful `cad.*` modeling commands from the stable semantic catalog are
recorded. Unsupported tools are not inferred from clicks.

Select a saved workflow and open **Make an input adjustable**. Choose an explicit
step argument and give it a variable name. Its current primitive value becomes the
default, with a matching string, number or boolean type. Choose values and click
**Preview workflow**. The main model displays the staged native result; use the
shared plan's **Apply** or **Cancel** controls. Applying creates one Undo step.
Failure, cancellation or a stale project preserves the accepted project.

Earlier commands' created IDs are replaced with result references automatically.
References to pre-existing project objects remain tied to that project; use the
argument editor to parameterize them for a different project. Missing references
produce diagnostics, rather than guesses or silent remapping. Replacing a project
invalidates an in-progress recording. Record a shorter workflow if the 100-step
limit is reached.

Saved workflows stay in this browser's local storage, separate from CAD project
files. Download workflow JSON for backup/sharing and import it in another browser.
Imports receive a new local ID and cannot silently overwrite existing workflows.
Supplying workflow JSON to `macro.save` requires `overwrite: true` explicitly
when its ID already exists.
There are at most 30 saved workflows, 100 steps per workflow, 32 typed inputs and
256 KiB total library storage. Storage failures leave changes available for the
current session and show an export reminder. A damaged or incompatible library
is preserved in browser storage; subsequent workflows stay in memory until the
library is repaired, preventing an accidental overwrite. Imported JSON is bounded and validated
before use; workflows contain no JavaScript, callbacks or runtime geometry handles.
There is no automatic damaged-library repair UI yet. Download session-only
workflows before reloading or closing the tab. To recover a damaged library,
first back up the `plaincad.macros.v1` value in browser storage; correct that JSON
or remove only that key using browser developer tools, reload, then import your
valid downloaded workflows. Removing the key discards its stored library.

Stable commands are `macro.start`, `macro.stop`, `macro.list`, `macro.save`,
`macro.parameterize`, `macro.delete`, `macro.import`, `macro.export` and
`macro.preview`. Discover their schemas through `commands.list`. For example:
Use the current `session` from `runtime.snapshot` and the saved workflow ID from
`macro.list`; the IDs below illustrate the format and must be replaced with yours.

```json
{
  "command": "macro.preview",
  "session": 1,
  "arguments": {"macroId": "macro_rectangle", "values": {"width": "80mm"}}
}
```

The macro file has version `1`, an `id`, `name`, `variables` and `steps`. Variables
use `{ "name": "width", "type": "string", "defaultValue": "80mm" }` for a length expression. A step argument
uses `{ "$variable": "width" }` for substitution or
`{ "$result": { "step": 0, "path": ["id"] } }` to refer to an earlier
command's result. All substitutions are resolved by validated command plans.
Step indices are zero based; paths address earlier result object properties or
array indices. A step contains a stable `command` and its `arguments`, for example:

```json
{
  "version": 1,
  "id": "macro_rectangle",
  "name": "Adjustable rectangle",
  "variables": [{"name": "width", "type": "string", "defaultValue": "80mm"}],
  "steps": [
    {"command": "cad.sketch.create", "arguments": {"name": "Outline", "plane": "XY"}},
    {"command": "cad.sketch.rectangle", "arguments": {
      "sketchId": {"$result": {"step": 0, "path": ["id"]}},
      "width": {"$variable": "width"}, "height": "40mm"
    }}
  ]
}
```

Use number or boolean inputs when the command schema expects those primitive
types. CAD length expressions expect strings such as `80mm`.
