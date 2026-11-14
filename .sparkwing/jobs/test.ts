import { definePipeline } from "@sparkwing/sdk";

import { checkout, checkoutArgs, logged } from "../lib/checkout.ts";

definePipeline({
  name: "Test",
  short: "vp test run on the named files, two workers, admitted by cores",
  args: [
    ...checkoutArgs,
    {
      name: "files",
      type: "[]string",
      required: true,
      description: "Comma-separated test files or directories, relative to the worktree",
    },
  ],
  plan(p) {
    p.job("test", async (ctx) => {
      const co = checkout(ctx);
      const files = (ctx.args.files ?? "").split(",").map((file) => file.trim()).filter(Boolean);
      if (files.length === 0) throw new Error("--files names no test files");
      await logged(ctx, co, "test", ["vp", "test", "run", "--maxWorkers=2", ...files]);
    })
      .inline()
      .cores(2);
  },
});
