export interface WorkspaceMark {
  readonly url: string;
  readonly service: string;
  readonly timestamp: string;
  readonly description: string;
}

export function collectWorkspaceMarks(
  messages: ReadonlyArray<{ readonly text: string; readonly createdAt: string }>,
): WorkspaceMark[] {
  const seen = new Set<string>();
  const result: WorkspaceMark[] = [];
  for (const message of [...messages].sort(
    (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
  )) {
    for (const match of message.text.matchAll(/https?:\/\/[^\s<>"`]+/g)) {
      const candidate = match[0].replace(/[.,;!?]+$/, "").replace(/\)+$/, (suffix) => {
        const opens = (match[0].match(/\(/g) ?? []).length;
        const closes = (match[0].match(/\)/g) ?? []).length;
        return suffix.slice(0, Math.max(0, suffix.length - (closes - opens)));
      });
      let url: URL;
      try {
        url = new URL(candidate);
      } catch {
        continue;
      }
      if (seen.has(url.href)) continue;
      seen.add(url.href);
      const host = url.hostname.toLowerCase();
      const service = /(^|\.)slack\.com$/.test(host)
        ? "Slack"
        : /(^|\.)(notion\.so|notion\.site)$/.test(host)
          ? "Notion"
          : /(^|\.)github\.com$/.test(host)
            ? "GitHub"
            : /(^|\.)linear\.app$/.test(host)
              ? "Linear"
              : "Other";
      result.push({ url: url.href, service, timestamp: message.createdAt, description: "" });
    }
  }
  return result;
}
