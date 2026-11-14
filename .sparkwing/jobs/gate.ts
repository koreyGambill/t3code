import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { definePipeline, memoKey } from "@sparkwing/sdk";

import {
  changedFiles,
  checkout,
  checkoutArgs,
  comparisonBase,
  logged,
  workingTree,
} from "../lib/checkout.ts";

// Two gates fit beside the daemon's machine reserve on 16 cores; check-changed spreads its
// steps over CHECK_CHANGED_CONCURRENCY workers within that.
const GATE_CORES = 6;
const CHECK_CHANGED_CONCURRENCY = "4";

definePipeline({
  name: "Gate",
  short: "vp run check:changed, admitted by cores instead of the checks lock",
  help: "The exit code is the verdict. Resubmitting an identical working tree against the same base returns the recorded pass.",
  args: [
    ...checkoutArgs,
    { name: "ref", type: "string", description: "Compare against the merge base with this ref" },
  ],
  plan(p) {
    p.job("pipelines", async (ctx) => {
      const co = checkout(ctx);
      if (!NodeFS.existsSync(NodePath.join(co.root, ".sparkwing/node_modules/.bin/tsc")))
        await logged(ctx, co, "pipelines-install", [
          "npm", "ci", "--prefix", ".sparkwing", "--ignore-scripts", "--no-audit", "--no-fund",
        ]);
      await logged(ctx, co, "pipelines-typecheck", ["npm", "--prefix", ".sparkwing", "run", "typecheck"]);
    })
      .inline()
      .cores(1)
      .skipIf((ctx) => {
        const co = checkout(ctx);
        const base = comparisonBase(co.root, ctx.args.ref || undefined);
        return !changedFiles(co.root, base).some((file) => file.startsWith(".sparkwing/"));
      });

    p.job("check-changed", async (ctx) => {
      const co = checkout(ctx);
      const ref = ctx.args.ref;
      const log = await logged(ctx, co, "check-changed", ["vp", "run", "check:changed", ...(ref ? [ref] : [])], {
        CHECK_CHANGED_CONCURRENCY,
      });
      return { log };
    })
      .inline()
      .cores(GATE_CORES)
      .memo((ctx) => {
        const co = checkout(ctx);
        return memoKey(
          "check-changed/v1",
          workingTree(co.root),
          comparisonBase(co.root, ctx.args.ref || undefined),
          co.nodeVersion,
          CHECK_CHANGED_CONCURRENCY,
        );
      });
  },
});
