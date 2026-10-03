import type { ExpressionRef } from "../../cad/document/schema";

export function AuthoredUnitsNote({
  expressions,
}: {
  expressions: Array<[string, ExpressionRef]>;
}) {
  const captured = expressions.filter(
    ([, ref]) => ref.authoredUnit !== undefined,
  );
  if (!captured.length) return null;
  return (
    <p className="muted">
      Saved bare-number units:{" "}
      {captured
        .map(([label, ref]) => `${label} = ${ref.authoredUnit || "scalar"}`)
        .join("; ")}
      . Explicit unit tokens override these defaults.
    </p>
  );
}
