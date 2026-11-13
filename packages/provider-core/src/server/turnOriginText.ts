import type { EnvironmentId, TurnOrigin } from "@t3tools/contracts";
import { numberedTurnOrigins } from "@t3tools/shared/messageReactions";
import { escapeXmlAttribute } from "@t3tools/shared/xml";

export function renderTurnOriginText(
  origin: TurnOrigin,
  text: string,
  receivingEnvironmentId: EnvironmentId | null,
  index = 1,
): string {
  if (numberedTurnOrigins([{ origin, text }]).length === 0) return text;
  const event =
    origin.kind === "thread"
      ? origin.event === "message"
        ? undefined
        : origin.event
      : origin.kind === "subagent"
        ? origin.event
        : origin.kind === "scheduled-task" || origin.kind === "wake"
          ? "fired"
          : undefined;
  const title =
    origin.kind === "system"
      ? origin.event
      : origin.kind === "wake"
        ? origin.detail
        : "title" in origin
          ? origin.title
          : undefined;
  const sender = origin.kind === "thread" || origin.kind === "subagent" ? origin : undefined;
  const attributes = {
    n: String(index),
    from: origin.kind,
    event,
    title,
    thread: sender?.threadId,
    environment:
      sender?.environmentId === receivingEnvironmentId ? undefined : sender?.environmentId,
    reply: origin.kind === "thread" ? origin.reply : undefined,
  };
  const header = Object.entries(attributes)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(
      ([key, value]) => `${key}="${escapeXmlAttribute(value).replace(/[\r\n\u2028\u2029]/g, " ")}"`,
    )
    .join(" ");
  const statement = sender === undefined ? "T3 Code, not the user." : "An agent, not the user.";
  return `<t3_origin ${header}>${statement}</t3_origin>\n\n${text}`;
}

export function withTurnOriginPrefix(
  text: string,
  origin: TurnOrigin | undefined,
  wrap: (body: string) => string,
): string {
  if (origin === undefined || origin.kind === "user" || !text.startsWith("<t3_origin "))
    return wrap(text);
  const boundary = text.indexOf("</t3_origin>\n\n");
  if (boundary === -1) return wrap(text);
  const bodyStart = boundary + "</t3_origin>\n\n".length;
  return text.slice(0, bodyStart) + wrap(text.slice(bodyStart));
}
