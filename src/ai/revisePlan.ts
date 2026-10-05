import { validateAiPlan, type AiPlan } from "./plan";

/** Local numeric proposal editing cannot change units, operations or parameter names. */
export function reviseAiParameters(
  plan: AiPlan,
  values: Record<string, string>,
): AiPlan {
  if (
    Object.keys(values).some(
      (name) => !plan.parameters.some((p) => p.name === name),
    )
  )
    throw new Error("Proposal contains an unknown parameter edit.");
  return validateAiPlan({
    ...plan,
    summary:
      "Proposal dimensions adjusted locally. Review the dimensions and native preview.",
    parameters: plan.parameters.map((p) => {
      const source = values[p.name]?.trim();
      if (
        !source ||
        !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(source) ||
        !Number.isFinite(Number(source))
      )
        throw new Error(
          `Enter a finite numeric value for ${p.name} (${p.unit}).`,
        );
      return { ...p, value: Number(source) };
    }),
  });
}
