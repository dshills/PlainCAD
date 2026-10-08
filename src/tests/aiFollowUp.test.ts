import { describe, expect, it } from "vitest";
import { resolveAiFollowUp } from "../ai/followUp";
import { AI_LIMITS } from "../ai/plan";

describe("bounded conversational repair", () => {
  it("keeps the original request and actual diagnostic in a short repair", () => {
    const resolved = resolveAiFollowUp("please fix that", { prompt: "Make a bracket with a 4mm wall", diagnostic: "Fillet radius exceeds the selected edge." });
    expect(resolved.clarification).toBeUndefined();
    expect(resolved.prompt).toContain("Make a bracket with a 4mm wall");
    expect(resolved.prompt).toContain("Fillet radius exceeds the selected edge.");
    expect(resolved.prompt).toContain("revise the full proposal");
  });
  it("asks which issue without a failure from the current context", () => {
    expect(resolveAiFollowUp("fix that").clarification).toContain("Which issue");
    expect(resolveAiFollowUp("repair this", { prompt: "", diagnostic: "Failed" }).clarification).toContain("Which issue");
  });
  it("keeps compound or ordinary modeling requests unchanged", () => {
    for (const text of ["fix that and double width", "make the wall 4mm", "don't fix that", "if it fails, fix that"])
      expect(resolveAiFollowUp(text, { prompt: "Old", diagnostic: "Failed" })).toEqual({ prompt: text });
  });
  it("bounds Unicode diagnostics without splitting a code point", () => {
    const result = resolveAiFollowUp("fix the preview", { prompt: "Make a part", diagnostic: "🔧".repeat(501) });
    expect(result.prompt).toContain("🔧".repeat(500) + "…");
    expect(result.prompt).not.toContain("\ufffd");
  });
  it("requires shortening instead of dropping original intent to fit the request", () => {
    const result = resolveAiFollowUp("fix that", { prompt: "a".repeat(AI_LIMITS.promptCharacters), diagnostic: "Native rebuild failed." });
    expect(result.clarification).toContain("too long");
    expect(result.prompt).toBe("fix that");
  });
});
