import type { RebuildResult, RebuildWarning } from "../../cad/worker/workerProtocol";

/** Only the solver's known degree-of-freedom notice is optional drawing guidance. */
export function isOptionalSketchGuidance(warning: RebuildWarning): boolean {
  return warning.source === "sketch" && Boolean(warning.sourceId) &&
    warning.id === `sketch:${warning.sourceId}:dof`;
}

export function actionableIssueCount(result: RebuildResult | undefined): number {
  return (result?.errors.length ?? 0) +
    (result?.warnings.filter((warning) => !isOptionalSketchGuidance(warning)).length ?? 0);
}
