import type { ThreadWorkspace } from "@t3tools/contracts";

/** Revision at which each record entity or field last changed. */
export type WorkspaceStamps = Readonly<Record<string, number>>;
// Unit separator: ids and mark URLs may contain any printable character.
const FIELD = "\u001f";

const itemCollections = [
  "questions",
  "actionItems",
  "designDocuments",
  "agentWork",
  "verifications",
  "decisions",
  "contextItems",
] as const;

function recordValues(workspace: ThreadWorkspace): Map<string, string> {
  const values = new Map<string, string>();
  const put = (key: string, value: unknown) => values.set(key, JSON.stringify(value ?? null));
  const entity = (key: string, fields: Record<string, unknown>, skip: ReadonlyArray<string>) => {
    put(key, true);
    for (const [field, value] of Object.entries(fields))
      if (!skip.includes(field)) put(`${key}${FIELD}${field}`, value);
  };
  for (const group of workspace.groups) entity(`group:${group.id}`, group, ["id"]);
  for (const collection of itemCollections)
    for (const item of workspace[collection]) {
      entity(`item:${item.id}`, item, ["id", "ref"]);
      if (item.ref !== undefined) put(`ref:${item.ref}`, item.id);
    }
  for (const thread of workspace.relatedThreads)
    entity(`thread:${thread.threadId}`, thread, ["threadId"]);
  for (const mark of workspace.markAnnotations) entity(`mark:${mark.url}`, mark, ["url"]);
  put("summary", workspace.summaryNotes);
  put("childPreamble", workspace.childPreamble);
  put("designNotes", workspace.designNotes);
  for (const [id, answer] of Object.entries(workspace.userDraft.questionAnswers))
    put(`draft.answer:${id}`, answer);
  for (const [id, note] of Object.entries(workspace.userDraft.actionNotes))
    put(`draft.note:${id}`, note);
  return values;
}

export function changedKeys(before: ThreadWorkspace, after: ThreadWorkspace): string[] {
  const left = recordValues(before);
  const right = recordValues(after);
  return [...new Set([...left.keys(), ...right.keys()])].filter(
    (key) => left.get(key) !== right.get(key),
  );
}

/** Ids of items whose entity or fields appear in `keys`. */
export function changedItemIds(keys: ReadonlyArray<string>): Set<string> {
  return new Set(
    keys.flatMap((key) => {
      const owner = key.split(FIELD)[0]!;
      return owner.startsWith("item:") ? [owner.slice("item:".length)] : [];
    }),
  );
}

// A field counts as changed when it, or the entity holding it, changed after `base`.
function stampOf(stamps: WorkspaceStamps, key: string): number {
  const [owner, field] = key.split(FIELD);
  return Math.max(stamps[key] ?? 0, field === undefined ? 0 : (stamps[owner!] ?? 0));
}

export function entityChangedSince(stamps: WorkspaceStamps, key: string, base: number): boolean {
  return Object.entries(stamps).some(
    ([stamp, revision]) => revision > base && (stamp === key || stamp.startsWith(`${key}${FIELD}`)),
  );
}

export function conflictingKeys(
  stamps: WorkspaceStamps,
  keys: ReadonlyArray<string>,
  base: number,
): string[] {
  return keys.filter((key) => stampOf(stamps, key) > base);
}

export function restamp(
  stamps: WorkspaceStamps,
  keys: ReadonlyArray<string>,
  after: ThreadWorkspace,
  revision: number,
): Record<string, number> {
  const next: Record<string, number> = { ...stamps };
  const present = recordValues(after);
  for (const key of keys) {
    // Removed fields keep only their entity's tombstone, which still blocks stale edits.
    if (key.includes(FIELD) && !present.has(key)) delete next[key];
    else next[key] = revision;
  }
  return next;
}

export function describeConflict(workspace: ThreadWorkspace, keys: ReadonlyArray<string>): string {
  const items = new Map(
    itemCollections.flatMap((collection) =>
      workspace[collection].map((item) => [item.id, item.ref ?? item.id] as const),
    ),
  );
  const labels = [
    ...new Set(
      keys.map((key) => {
        const [owner, field] = key.split(FIELD);
        const [kind, ...rest] = owner!.split(":");
        const id = rest.join(":");
        const prefix = kind === "draft.answer" || kind === "draft.note" ? "your answer to " : "";
        return `${prefix}${items.get(id) ?? (rest.length ? id : kind)}${field ? ` ${field}` : ""}`;
      }),
    ),
  ];
  return `Not saved: ${labels.slice(0, 5).join(", ")}${labels.length > 5 ? ", …" : ""} changed after the revision you read. Reload and reapply those; other fields merge.`;
}
