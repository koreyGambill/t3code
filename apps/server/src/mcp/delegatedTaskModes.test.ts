import { assert, describe, it } from "@effect/vitest";

import { taskPrompt, withChildPreamble } from "./delegatedTaskModes.ts";

describe("withChildPreamble", () => {
  it("puts the preamble before the task, marked with its source, and states that the task wins", () => {
    const task = withChildPreamble("Use the shared Xwing env.\nReport friction.", "Fix the bug.");
    assert.equal(
      task,
      '<child_preamble source="parent thread Workspace">\nUse the shared Xwing env.\nReport friction.\n</child_preamble>\nWhere the preamble and the task differ, follow the task.\n\nFix the bug.',
    );
    assert.isTrue(
      taskPrompt({ task, role: "review" }).startsWith(
        'Act as the review sub-agent for this task.\n\n<child_preamble source="parent thread Workspace">',
      ),
    );
  });

  it("leaves the task unchanged when the preamble is blank", () => {
    assert.equal(withChildPreamble("", "Fix the bug."), "Fix the bug.");
    assert.equal(withChildPreamble("  \n ", "Fix the bug."), "Fix the bug.");
  });
});
