# Built-in AI command planning

Open the existing AI dock and choose **Command agent**. Unlike the recipe modes,
this mode can propose creating and modifying project parameters, components,
sketch entities, dimensions and supported modeling features using the same typed
`cad.*` commands available to scripts and external agents.

Select Anthropic, OpenAI or Google and its configured model. Review the sharing
checkbox: the provider receives the current project's editable JSON, active
component, selection, native body identity/volume summaries, diagnostics, prompt
and recent conversation. Credentials and meshes are not included. Changing the
project, selection, component, provider or model requires fresh sharing consent.

Describe the intended changes and choose **Generate command preview**. Ambiguous
requests produce a clarification without edits. Answer in the same input to ask
for a revised plan. A complete plan lists each command and its arguments, along
with warnings about shared parameters or destructive edits. Every operation and
the final result are validated locally through OpenCascade. The proposed geometry
appears in the main viewport; the accepted document and Undo history are preserved
until you choose **Apply command plan**. Apply commits the whole plan as one Undo
step. Cancel, closing the mode, failure or a stale source preserves accepted CAD.

This is bounded planning rather than arbitrary code execution or an autonomous
background editor. The server supplies the trusted semantic command catalog;
provider responses cannot request imports, exports, UI actions, history changes,
capability tokens or arbitrary executable commands. New-object aliases connect
steps without invented IDs. Unsupported geometry or invalid dimensions produce
real diagnostics rather than successful unchanged geometry.

Current limits are twelve commands per proposal and 20 kB of complete project
context. Projects beyond that context budget receive a clear diagnostic; data is
not silently truncated. Use the stable command API or an external live agent for
larger projects. The existing conversation request/response and gateway resource
limits still apply. Local provider configuration is shared with the existing AI
modes. Static hosting does not include the optional AI gateway.
