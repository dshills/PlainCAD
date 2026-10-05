// @vitest-environment node
import { expect, it } from "vitest";
import { AI_PROVIDERS } from "../ai/plan";
import { extractProviderPlan } from "../../server/aiProvider";
import { buildAiPlan } from "../ai/buildPlan";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { serializeProject } from "../persistence/exportProject";
import { importProjectText } from "../persistence/importProject";
import { aiAcceptanceCorpus } from "./fixtures/aiAcceptanceCorpus";

it.each(
  aiAcceptanceCorpus.flatMap((example) =>
    AI_PROVIDERS.map((provider) => ({
      id: `${provider}/${example.id}`,
      provider,
      example,
    })),
  ),
)(
  "decodes and persists the bounded recipe for $id",
  ({ provider, example }) => {
    const text = JSON.stringify({
      ...example.plan,
      steps: example.plan.steps.map((step) => JSON.stringify(step)),
    });
    const response =
      provider === "anthropic"
        ? { stop_reason: "end_turn", content: [{ type: "text", text }] }
        : provider === "openai"
          ? {
              status: "completed",
              output: [{ content: [{ type: "output_text", text }] }],
            }
          : {
              candidates: [
                { finishReason: "STOP", content: { parts: [{ text }] } },
              ],
            };
    const decoded = extractProviderPlan(provider, response);
    expect(decoded).toEqual(example.plan);
    const staged = buildAiPlan(createEmptyDocument(), decoded),
      restored = importProjectText(serializeProject(staged.document));
    expect(staged.bodyIds).toHaveLength(example.bodies);
    expect(restored.features.map((f) => f.id)).toEqual(
      staged.document.features.map((f) => f.id),
    );
    expect(Object.keys(restored.sketches).sort()).toEqual(
      Object.keys(staged.document.sketches).sort(),
    );
    expect(
      serializeProject(importProjectText(serializeProject(restored))),
    ).toBe(serializeProject(restored));
  },
);
