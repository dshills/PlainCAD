import { parseRelativeDimension, relativeDimensionValue } from "./relativeDimension";
import { validateAiPlan, type AiEditContext, type AiPlan } from "./plan";

export type AiScope = "create" | "edit" | "feature";
export type AiIntent = {
  target?: string;
  clarification?: string;
  choices?: AiEditContext["parameters"];
  context?: AiEditContext;
  prompt: string;
  localPlan?: AiPlan;
};

/** Resolve only bounded dimension edits. Unclear references never choose a field implicitly. */
export function resolveAiIntent(
  scope: AiScope,
  prompt: string,
  context?: AiEditContext,
  chosenTarget?: string,
): AiIntent {
  const text = prompt.trim();
  const relative = parseRelativeDimension(text);
  const chosenReference = relative && /^(?:it|this|that)$/i.test(relative.target);
  const thickness = /\b(thick|thicker|thinner|thickness)\b/i.test(text);
  const referringEdit =
    /\b(this|it|that)\b/i.test(text) &&
    /\b(change|set|increase|decrease|resize|thick|thicker|thinner|larger|smaller|wider|narrower|taller|shorter|longer)\b/i.test(
      text,
    );
  if (scope === "create") {
    return {
      prompt: text,
      ...(relative || (referringEdit &&
      /^(?:please\s+|can you\s+|could you\s+)?(?:make|change|set|increase|decrease|resize)\s+(?:this|it|that)\b/i.test(
        text,
      ))
        ? {
            clarification:
              "To change an existing part, choose This part or Selected feature first.",
          }
        : {}),
    };
  }
  if (!context) return { prompt: text };
  const parameters = context.parameters;
  const mentions = (name: string) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      `(?:^|[^A-Za-z0-9_])${escaped}(?=$|[^A-Za-z0-9_])`,
      "i",
    ).test(text);
  };
  const friendlyName = (name: string) => name.replace(/^ai_\d+_/, "");
  const named = parameters.filter(
    (p) => chosenReference ? false : relative
      ? [p.name, friendlyName(p.name)].some((name) => name.toLowerCase() === relative.target.toLowerCase())
      : mentions(p.name) || mentions(friendlyName(p.name)),
  );
  const explicitMultiple =
    named.length > 1 &&
    (new Set(named.map((p) => friendlyName(p.name))).size === named.length ||
      named.every((p) => mentions(p.name)));
  let target =
    chosenTarget && parameters.some((p) => p.name === chosenTarget)
      ? chosenTarget
      : undefined;
  if (relative && target && named.length > 0 && !named.some((parameter) => parameter.name === target)) {
    return { prompt: text, clarification: `This request names ${relative.target}, but ${target} is selected. Choose the requested dimension first.`, choices: parameters };
  }
  if (relative && target && !chosenReference && !named.length && !/^(?:thick|thickness)$/i.test(relative.target)) {
    return { prompt: text, clarification: `The requested dimension ${relative.target} is unavailable in this scope. Choose an editable dimension first.`, choices: parameters };
  }
  if (relative && target && !named.length && /^(?:thick|thickness)$/i.test(relative.target)) {
    const allowed = scope === "feature" && context.feature?.type === "extrude"
      ? parameters.filter((parameter) => parameter.name === "distance")
      : parameters.filter((parameter) => /(?:^|_)thickness(?:_\d+)?$/i.test(parameter.name));
    if (!allowed.some((parameter) => parameter.name === target))
      return { prompt: text, clarification: "Thickness needs a matching editable length dimension. Choose the extrusion distance, or name the dimension to change explicitly.", choices: allowed };
  }
  if (!target && relative && named.length > 1) {
    return { prompt: text, clarification: "Which dimension should change? Choose an editable dimension, or select the feature you mean.", choices: parameters };
  }
  if (!target && explicitMultiple) return { prompt: text, context };
  if (!target && named.length === 1) target = named[0].name;
  if (!target && thickness) {
    const candidates =
      scope === "feature" && context.feature?.type === "extrude"
        ? parameters.filter((p) => p.name === "distance")
        : parameters.filter((p) => /(?:^|_)thickness(?:_\d+)?$/i.test(p.name));
    if (candidates.length === 1) target = candidates[0].name;
  }
  if (!target && (relative || thickness || referringEdit || named.length > 1)) {
    return {
      prompt: text,
      clarification:
        "Which dimension should change? Choose an editable dimension, or select the feature you mean.",
      choices: parameters,
    };
  }
  if (!target) return { prompt: text, context };
  const parameter = parameters.find((p) => p.name === target)!;
  const scopedContext = { ...context, parameters: [parameter] };
  const resolvedPrompt = `${text}\nEdit only ${parameter.name} of ${context.feature?.name ?? context.componentName}; its current value is ${parameter.value}${parameter.unit}.`;
  if (relative) {
    try {
      if (/^(?:thick|thickness)$/i.test(relative.target) && parameter.unit !== "mm")
        throw new Error("Thickness needs a length dimension. Choose an editable length first.");
      const value = relativeDimensionValue(relative, parameter);
      const localPlan = validateAiPlan({ name: context.feature?.name ?? context.componentName,
        summary: `Change ${parameter.name} from ${parameter.value}${parameter.unit} to ${value}${parameter.unit}.`,
        warnings: [], parameters: [{ name: parameter.name, value, unit: parameter.unit }], steps: [] });
      return { target, context: scopedContext, prompt: resolvedPrompt, localPlan };
    } catch (failure) {
      return { target, context: scopedContext, prompt: resolvedPrompt,
        clarification: failure instanceof Error ? failure.message : `Enter a valid change for ${target}.` };
    }
  }
  // Absolute assignments remain separate from the exact relative grammar;
  // general language and compound requests stay with the provider.
  const mixedRelative = /\b(?:halve|double|half|twice)\b/i.test(text) &&
    !/^(?:(?:please|can you|could you)\s+)?(?:set|change|resize|make)\s+(?:the\s+)?[A-Za-z_]\w*\s+to\b/i.test(text);
  const numeric = mixedRelative || /\b(and|or|then|by)\b/i.test(text)
    ? null
    : text.match(
        /\bto\s+([+-]?(?:\d+\.?\d*|\.\d+))\s*(mm|deg)\s*(?:please)?[.!]?\s*$/i,
      );
  if (numeric && numeric[2].toLowerCase() !== parameter.unit) {
    return {
      target,
      context: scopedContext,
      prompt: resolvedPrompt,
      clarification: `Use ${parameter.unit} for ${parameter.name}.`,
    };
  }
  const requestedValue = numeric ? Number(numeric[1]) : undefined;
  if (
    !chosenTarget &&
    requestedValue !== undefined &&
    requestedValue > 0 &&
    Number.isFinite(requestedValue)
  ) {
    // Only an explicit leading directive determines direction. Later/negated
    // descriptions and an explicitly chosen target must not override an exact value.
    const directive = text
      .match(
        /^(?:(?:please|can you|could you)\s+)?(?:(?:make|resize)\s+(?:this|it|that|[A-Za-z_]\w*)\s+)?(thicker|larger|wider|taller|longer|thinner|smaller|narrower|shorter|increase|decrease)\b/i,
      )?.[1]
      ?.toLowerCase();
    const increase =
      directive &&
      /^(thicker|larger|increase|wider|taller|longer)$/.test(directive);
    const decrease =
      directive &&
      /^(thinner|smaller|decrease|narrower|shorter)$/.test(directive);
    if (
      (increase && requestedValue < parameter.value) ||
      (decrease && requestedValue > parameter.value)
    ) {
      return {
        target,
        context: scopedContext,
        prompt: resolvedPrompt,
        clarification: `${parameter.name} is currently ${parameter.value}${parameter.unit}; ${requestedValue}${parameter.unit} moves it in the opposite direction. Revise the value, or use “set ${parameter.name} to ${requestedValue}${parameter.unit}” for that exact size.`,
      };
    }
  }
  let localPlan: AiPlan | undefined;
  try {
    localPlan = numeric
      ? validateAiPlan({
          name: context.feature?.name ?? context.componentName,
          summary: `Change ${parameter.name} from ${parameter.value}${parameter.unit} to ${numeric[1]}${parameter.unit}.`,
          warnings: [],
          parameters: [
            {
              name: parameter.name,
              value: Number(numeric[1]),
              unit: parameter.unit,
            },
          ],
          steps: [],
        })
      : undefined;
  } catch (failure) {
    return {
      target,
      context: scopedContext,
      prompt: resolvedPrompt,
      clarification:
        failure instanceof Error
          ? failure.message
          : `Enter a valid value for ${target}.`,
    };
  }
  return { target, context: scopedContext, prompt: resolvedPrompt, localPlan };
}

/** Providers cannot expand a locally resolved request to unrelated dimensions. */
export function assertAiIntentPlan(intent: AiIntent, plan: AiPlan): void {
  if (
    intent.target &&
    (plan.steps.length || plan.parameters.some((p) => p.name !== intent.target))
  )
    throw new Error(
      `This request can change only ${intent.target}. Describe other dimension changes separately.`,
    );
}
