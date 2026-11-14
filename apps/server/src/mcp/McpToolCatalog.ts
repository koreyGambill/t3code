import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

export interface CatalogTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
}

/** The tools `/mcp` advertises, readable outside the MCP server's own layer scope. */
export class McpToolCatalog extends Context.Service<
  McpToolCatalog,
  {
    readonly attach: (tools: () => ReadonlyArray<CatalogTool>) => Effect.Effect<void>;
    /** Empty until the MCP server has registered its tools. */
    readonly list: Effect.Effect<ReadonlyArray<CatalogTool>>;
  }
>()("t3/mcp/McpToolCatalog") {}

export const layer = Layer.effect(
  McpToolCatalog,
  Effect.gen(function* () {
    const source = yield* Ref.make<() => ReadonlyArray<CatalogTool>>(() => []);
    return McpToolCatalog.of({
      attach: Effect.fn("McpToolCatalog.attach")((tools) => Ref.set(source, tools)),
      list: Effect.map(Ref.get(source), (tools) => tools()),
    });
  }),
);
