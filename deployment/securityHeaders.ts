// Apply this policy to HTML and every worker/module response. Development HMR
// deliberately uses Vite's development policy instead of the production policy.
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "script-src-attr 'none'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");
export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};
export function staticHostHeaders(): string {
  return `/*\n${Object.entries(SECURITY_HEADERS)
    .map(([name, value]) => `  ${name}: ${value}`)
    .join(
      "\n",
    )}\n\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n\n/index.html\n  Cache-Control: no-cache\n\n/\n  Cache-Control: no-cache\n`;
}
export function nginxSecurityHeaders(): string {
  return (
    Object.entries(SECURITY_HEADERS)
      .map(([name, value]) => `add_header ${name} "${value}" always;`)
      .join("\n") + "\n"
  );
}
