import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { definePipeline, memoKey } from "@sparkwing/sdk";

import {
  changedFiles,
  checkChangedInputs,
  checkout,
  checkoutArgs,
  comparisonBase,
  logged,
} from "../lib/checkout.ts";

// Two gates fit beside the daemon's machine reserve on 16 cores. check-changed weighs typecheck
// by its worker count, so a budget below 6 queued typecheck behind knip (+25 s measured).
const GATE_CORES = 6;
const CHECK_CHANGED_CONCURRENCY = String(GATE_CORES);

definePipeline({
  name: "Gate",
  short: "vp run check:changed, admitted by cores instead of the checks lock",
  help:
    "The exit code is the verdict. Resubmitting identical inputs against the same base returns the recorded pass " +
    "without a new log; a tree edited during the run fails instead of passing.",
  args: [
    ...checkoutArgs,
    { name: "ref", type: "string", description: "Compare against the merge base with this ref" },
  ],
  plan(p) {
    p.job("pipelines", async (ctx) => {
      const co = checkout(ctx);
      const base = comparisonBase(co.root, ctx.args.ref || undefined);
      if (
        !NodeFS.existsSync(NodePath.join(co.root, ".sparkwing/node_modules/.bin/tsc")) ||
        changedFiles(co.root, base).includes(".sparkwing/package-lock.json")
      )
        await logged(ctx, co, "pipelines-install", [
          "npm", "ci", "--prefix", ".sparkwing", "--ignore-scripts", "--no-audit", "--no-fund",
        ]);
      await logged(ctx, co, "pipelines-typecheck", ["npm", "--prefix", ".sparkwing", "run", "typecheck"]);
    })
      .inline()
      .cores(0.25)
      .skipIf((ctx) => {
        const co = checkout(ctx);
        const base = comparisonBase(co.root, ctx.args.ref || undefined);
        return !changedFiles(co.root, base).some((file) => file.startsWith(".sparkwing/"));
      });

    // The memo key is taken before check:changed reads the tree for minutes, so a pass only counts
    // when its inputs are unchanged afterwards; otherwise an edit made mid-run would be memoized.
    const keyFile = (evidence: string) => NodePath.join(evidence, ".check-changed-inputs");
    p.job("check-changed", async (ctx) => {
      const co = checkout(ctx);
      const ref = ctx.args.ref;
      const base = comparisonBase(co.root, ref || undefined);
      const before = NodeFS.existsSync(keyFile(co.evidence))
        ? NodeFS.readFileSync(keyFile(co.evidence), "utf8")
        : checkChangedInputs(co.root, base);
      const log = await logged(ctx, co, "check-changed", ["vp", "run", "check:changed", ...(ref ? [ref] : [])], {
        CHECK_CHANGED_CONCURRENCY,
      });
      if (checkChangedInputs(co.root, base) !== before)
        throw new Error("The worktree changed during the gate, so this pass is not recorded; rerun the gate.");
      return { log };
    })
      .inline()
      .cores(GATE_CORES)
      .memo((ctx) => {
        const co = checkout(ctx);
        const inputs = checkChangedInputs(co.root, comparisonBase(co.root, ctx.args.ref || undefined));
        NodeFS.writeFileSync(keyFile(co.evidence), inputs);
        return memoKey("check-changed/v2", inputs, co.nodeVersion, CHECK_CHANGED_CONCURRENCY);
      });
  },
});
