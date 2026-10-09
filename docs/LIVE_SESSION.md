# Work with an agent in the open project

Live access connects an external script or agent to the browser tab you already
have open. Unlike `npm run cad`, it does not launch a separate Chromium browser.
The agent sees the same document, selection, diagnostics and Undo history as you.
The browser executes requests through the canonical command registry; the local
server only relays bounded JSON.

## Connect

1. Run the local development server (`npm run dev`) or local production preview
   (`npm run build && npm run preview -- --host 127.0.0.1`). Static hosting does
   not provide a live relay.
2. Open the bottom **Automation** dock and click **Connect live agent** yourself.
   Remote commands cannot initiate this connection or copy its capability.
3. Click **Copy agent capability**. Give it privately to the process that will
   run your agent by setting its `PLAINCAD_LIVE_TOKEN` environment variable.
   Do not put it in command arguments, project files, URLs, committed scripts or
   public logs. A capability grants access to inspect and edit this connected tab.
4. Send JSON requests with `npm run cad:live --` (or `node scripts/plaincad-live.mjs`). Use `--url` to select
   the local application origin or `--script commands.json` for a JSON array.
   Without `--script`, read one JSON request per line from stdin.
5. Click **Disconnect live agent** when finished. Leaving the page also disconnects; the connection stays
   active when you collapse or switch the automation dock. Tokens expire when browser polling stops; a new
   connection gets new tokens.

The capability stays in browser and server memory. It is not displayed in the DOM,
project JSON, localStorage or public connection discovery. Copying uses the system
clipboard only after your explicit click. The relay supports one connected tab;
disconnect it before connecting another.

## Inspect, then act with the inspected session

First send:

```json
{"command":"runtime.snapshot"}
```

The response includes `value.session`, the current document and selection, rebuild
errors and current native BRep assertions. Discover command schemas with:

```json
{"command":"commands.list"}
```

Use the returned session explicitly for subsequent operations, for example:

```json
{"command":"parameter.update","session":7,"arguments":{"parameterId":"thickness-parameter","patch":{"expression":"8mm"}}}
{"command":"runtime.awaitNative","session":7,"arguments":{"timeoutMs":60000}}
{"command":"history.undo","session":7}
```

Replace `7` and the parameter ID with the inspected values. The CLI never silently
refreshes a stale session or retries a failed mutation. Import/open can change the
session; inspect again before proceeding. Undo and normal UI edits share the same
history. Registry availability, current task ownership, selection validation,
project sessions and geometry checks apply exactly as they do to other command
callers. See [COMMANDS.md](COMMANDS.md) for command descriptions and JSON limits.

Downloads initiated through a live request are downloads in the connected browser,
using that browser's normal download settings. The relay does not read arbitrary
files or transfer downloaded bytes. `runtime.artifacts` reports initiation metadata.
Mouse gestures needing the Chromium input driver remain unavailable through this
HTTP-only connection; use stable modeling commands or non-gesture mounted controls.

## Transport and failure semantics

The optional relay is `/api/live/*`, restricted to loopback peers, loopback Host
names, and the local origin. It denies cross-site requests and emits no permissive
CORS headers. Browser polling/results use a separate secret from the agent token.
`GET /api/live/status` reports only connection presence and its nonsecret ID.
`POST /api/live/execute` requires `Authorization: Bearer <capability>` and a JSON
registry request. No endpoint accepts JavaScript, shell commands or arbitrary
filesystem paths.

Requests are limited to 6 MiB, depth 64, four agent body readers, two reserved browser body readers and four queued
or delivered commands. Browser result bodies are limited to 16 MiB. Body reads time
out after ten seconds, polls after twenty, and execution waits after sixty-five seconds. Idle browser capabilities expire after
ninety seconds, allowing a full execution wait and the next poll.
Browser gateway requests also have local deadlines: ten seconds for connect and
result delivery, thirty seconds for long polls, and three seconds for teardown.
Disconnect aborts outstanding requests; late responses cannot update a replacement
connection's state. A failed response-body read is covered by the same deadline.
The browser processes one delivered command at a time. Long commands can time out
at the caller while the browser is still finishing them. Timeout and disconnect
responses include `delivered` and `retry:false`: inspect the project before retrying.

Disconnect prevents queued requests from being dispatched and revokes tokens. A
command already delivered may have changed the project or may finish after the
caller disconnects. Disconnect is not an Undo action. Use shared Undo after inspecting
accepted changes. Requests are not automatically retried after connection failure.
The local server keeps no request/document/provider logs or durable relay history.
