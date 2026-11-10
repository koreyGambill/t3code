import { describe, expect, it } from "vite-plus/test";
import { parseArtifactQuestions } from "./artifactQuestions.ts";

const question = {
  id: "mode",
  prompt: "Choose a mode",
  details: "One choice",
  options: [{ id: "safe", label: "Safe", description: "Checks input" }],
  recommendedOptionIds: ["safe"],
  multiSelect: false,
};
const block = (value: unknown) => `\`\`\`t3-question\n${JSON.stringify(value)}\n\`\`\``;

describe("artifact question blocks", () => {
  it("reads structured questions alongside ordinary Markdown", () => {
    expect(parseArtifactQuestions(`# Design\n\n${block(question)}\n\nText`)).toEqual([question]);
    expect(parseArtifactQuestions(block(question).replaceAll("\n", "\r\n"))).toEqual([question]);
    expect(parseArtifactQuestions("```json\n{}\n```")).toEqual([]);
  });
  it.each([
    block({ ...question, prompt: "" }),
    block({ ...question, recommendedOptionIds: ["missing"] }),
    block({ ...question, options: [...question.options, ...question.options] }),
    block({ ...question, recommendedOptionIds: ["safe", "safe"] }),
    `${block(question)}\n${block(question)}`,
    "```t3-question\n{}",
    "```t3-question\ninvalid json\n```",
  ])("rejects invalid questions: %s", (content) => {
    expect(() => parseArtifactQuestions(content)).toThrow();
  });
});
