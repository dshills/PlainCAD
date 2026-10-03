# Production deployment

Build with `npm ci` and `npm run build`. Serve `dist/` over HTTPS from a stable
origin. Project downloads and IndexedDB recovery stay on the user's device;
changing the origin changes access to that origin's recovery storage.

`deployment/securityHeaders.ts` is the policy source. The build emits:

- `dist/_headers` for static hosts that support this header-file format.
- `dist/nginx-security-headers.conf` for inclusion in an Nginx server block.

Apply the security headers to **all** responses, including JavaScript modules,
geometry/import/export worker entry points, WASM, HTML, and error responses.
A CSP meta tag alone does not protect the worker execution contexts. Workers
receive their own CSP from the worker script response.
[MDN worker CSP](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#content_security_policy)
explains that boundary.

The policy allows same-origin modules and workers, same-origin WASM/fetch, local
fonts, and image data URLs. It blocks inline scripts, JavaScript string evaluation,
remote fetches, embedded frames, forms navigating away, objects and base URL changes.
`wasm-unsafe-eval` permits WebAssembly compilation while JavaScript `eval` remains
blocked; it does not use `unsafe-eval`. See
[MDN script-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src#unsafe_webassembly_execution).
Inline **style attributes** are permitted for React and renderer dimensions;
inline style blocks are blocked. Do not loosen the script policy to fix a host
configuration error.

For Nginx, include the generated security header file at server scope, use
`try_files $uri $uri/ /index.html` only for page routes, and return 404 for missing
`/assets/` files. Serve `.wasm` as `application/wasm` and JavaScript modules/workers
as `application/javascript` or `text/javascript`. If a location defines its own
`add_header`, also include the security header file there: Nginx header inheritance
can otherwise omit parent security headers under the default inheritance rules.
See [Nginx add_header](https://nginx.org/en/docs/http/ngx_http_headers_module.html#add_header). Use `Cache-Control: no-cache` for HTML
and long immutable caching for hashed `/assets/` files. Keep the previous asset
set available during rollout so open tabs can finish lazy worker imports.

The development server uses port 5278 and HMR. The production preview uses port
5280 with strict port selection and the actual security response headers:

```sh
npm run build
npm run preview -- --host 127.0.0.1
npm run test:production
```

`npm run release:check` runs type checking, unit/component tests, the build, the
Chromium development acceptance suite, and a separate Chromium production suite.
The production test performs native parameter edits, STL, project save/open,
IndexedDB recovery, and native union under CSP; checks resource headers; and probes
blocked inline scripts, JavaScript evaluation and remote fetch. It reads recovery
storage to wait for a completed transaction and does not use development store hooks.
Violation events are observed in the document context; worker coverage checks
their response policies and successful native operations rather than collecting
worker-context violation events.

The preview proves the built application and policy in Chromium. Verify the
headers and MIME types on the final host after deployment; no external deployment
is performed by these checks. Browsers without `wasm-unsafe-eval` support may fail
kernel loading rather than receive a less restrictive JavaScript policy.

Configure HTTPS redirects and domain-appropriate HSTS on the final host. HSTS is
not emitted by the HTTP preview or the reusable CSP bundle because its lifetime
and subdomain scope belong to the host owner. Cross-origin isolation is not
required by the current single-threaded WASM instances.
