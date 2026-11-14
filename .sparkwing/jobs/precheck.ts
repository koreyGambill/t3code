import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { type Context, definePipeline } from "@sparkwing/sdk";

import {
  CODE,
  changedFiles,
  checkout,
  checkoutArgs,
  comparisonBase,
  decideChanges,
  logged,
} from "../lib/checkout.ts";

interface Scope {
  readonly base: string;
  readonly present: string[];
  readonly code: string[];
  readonly affected: string[];
}

definePipeline({
  name: "Precheck",
  short: "Format, lint and typecheck only what this change touches",
  help: "Seconds-scale feedback before the gate: fmt --check and lint of changed files, typecheck of affected packages.",
  args: [
    ...checkoutArgs,
    { name: "ref", type: "string", description: "Compare against the merge base with this ref" },
  ],
  plan(p) {
    const job = p.job("precheck").inline().cores(2).failurePolicy("collect_all");
    const scope = job.step<Scope>("scope", (ctx) => {
      const co = checkout(ctx);
      const base = comparisonBase(co.root, ctx.args.ref || undefined);
      const files = changedFiles(co.root, base);
      const present = files.filter((file) => NodeFS.existsSync(NodePath.join(co.root, file)));
      const { affected } = decideChanges(co.root, files, false);
      ctx.log.info(`${files.length} changed files, ${affected.length} affected packages`, { base });
      return { base, present, code: present.filter((file) => CODE.test(file)), affected };
    });
    const read = (ctx: Context) => {
      const out = ctx.stepOutput(scope);
      if (!out) throw new Error("scope output is unavailable");
      return out;
    };
    job
      .step("format", async (ctx) => {
        const { present } = read(ctx);
        await logged(ctx, checkout(ctx), "format", [
          "vp", "fmt", "--check", "--no-error-on-unmatched-pattern", ...present,
        ]);
      })
      .needs(scope)
      .skipIf((ctx) => read(ctx).present.length === 0);
    job
      .step("lint", async (ctx) => {
        const { code } = read(ctx);
        await logged(ctx, checkout(ctx), "lint", [
          "vp", "lint", "--no-error-on-unmatched-pattern", ...code,
        ]);
      })
      .needs(scope)
      .skipIf((ctx) => read(ctx).code.length === 0);
    job
      .step("typecheck", async (ctx) => {
        const { affected } = read(ctx);
        await logged(ctx, checkout(ctx), "typecheck", [
          "vp", "run", "--cache", "--parallel", "--concurrency-limit", "2",
          ...affected.flatMap((name) => ["--filter", name]),
          "typecheck",
        ]);
      })
      .needs(scope)
      .skipIf((ctx) => read(ctx).affected.length === 0);
  },
});
