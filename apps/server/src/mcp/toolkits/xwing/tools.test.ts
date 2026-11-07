import { expect, it } from "@effect/vitest";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { XwingToolkit } from "./tools.ts";

it("takes only an Xwing environment id from agents, never a checkout path", () => {
  const decode = Schema.decodeUnknownExit(
    XwingToolkit.tools.t3_xwing_environment_select.parametersSchema,
  );
  expect(Exit.isSuccess(decode({ threadId: "thread-1", xwingEnvironmentId: "0123abcd" }))).toBe(
    true,
  );
  expect(Exit.isFailure(decode({ threadId: "thread-1", xwingEnvironmentId: "../../etc" }))).toBe(
    true,
  );
  const forged = decode({
    threadId: "thread-1",
    xwingEnvironmentId: "0123abcd",
    worktreePath: "/etc",
  });
  if (!Exit.isSuccess(forged)) throw new Error("a valid selection was rejected");
  expect(forged.value).not.toHaveProperty("worktreePath");
});
