// Upstream's contracts at the commit named on the snapshot's first line.
import type * as HttpApi from "effect/http-api/HttpApi";
import type * as Rpc from "effect/rpc/Rpc";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import type * as Schema from "effect/Schema";

export declare const WsRpcGroup: RpcGroup.RpcGroup<Rpc.AnyWithProps>;
export declare const ExecutionEnvironmentDescriptor: Schema.Top;
export declare const EnvironmentHttpApi: HttpApi.Top;
