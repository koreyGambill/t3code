import {
  DevelopmentEnvironmentCheckoutChoice,
  DevelopmentEnvironmentSelectCheckoutResult,
  OrchestrationV2DevelopmentEnvironmentUsage,
  OrchestratorMcpEnvironmentTarget,
  OrchestratorMcpFailure,
  ProjectId,
  ThreadId,
  XwingEnvironmentId,
} from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as DevelopmentEnvironments from "../../../developmentEnvironments/DevelopmentEnvironments.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    DevelopmentEnvironments.DevelopmentEnvironments,
    SecureRandom.SecureRandom,
  ],
};

const XwingEnvironmentListTool = Tool.make("t3_xwing_environment_list", {
  ...shared,
  description:
    "List active Xwing environments with a checkout of a project (default: yours). Launch in one with `t3_thread_launch` `workspaceStrategy: {type: 'xwing_environment', xwingEnvironmentId}`.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    projectId: Schema.optional(ProjectId),
  }),
  success: Schema.Array(DevelopmentEnvironmentCheckoutChoice),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const XwingEnvironmentThreadsTool = Tool.make("t3_xwing_environment_threads", {
  ...shared,
  description:
    "List every thread that has worked in one Xwing environment, including archived and settled ones, newest first. `current` marks threads still there.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    xwingEnvironmentId: XwingEnvironmentId,
  }),
  success: Schema.Array(OrchestrationV2DevelopmentEnvironmentUsage),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const XwingEnvironmentSelectTool = Tool.make("t3_xwing_environment_select", {
  ...shared,
  description:
    "Move another stopped thread into an Xwing environment's checkout of its project. Fails while it runs; ends its sessions and idle terminals in the old checkout. Not for your own thread.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    threadId: ThreadId,
    xwingEnvironmentId: XwingEnvironmentId,
  }),
  success: DevelopmentEnvironmentSelectCheckoutResult,
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true);

export const XwingToolkit = Toolkit.make(
  XwingEnvironmentListTool,
  XwingEnvironmentThreadsTool,
  XwingEnvironmentSelectTool,
);
