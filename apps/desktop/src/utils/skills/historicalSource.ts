import { getSessionEvents } from "@tracepilot/client";
import type { SkillInvocationRecord } from "@tracepilot/types";

export interface HistoricalSkillSource {
  content: string;
  invocation: SkillInvocationRecord;
}

/** Matches the indexer's fingerprint, including its newline normalization. */
async function fingerprint(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content.replace(/\r\n/g, "\n").trimEnd());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Recover only a verified invocation, never a same-named file from another install. */
export async function findHistoricalSkillSource(
  records: readonly SkillInvocationRecord[],
  isCurrent: () => boolean = () => true,
): Promise<HistoricalSkillSource | null> {
  // The detail endpoint supplies a bounded list, newest first. A missing log
  // must not prevent trying an earlier recorded copy.
  for (const invocation of records) {
    if (!isCurrent()) return null;
    if (invocation.origin !== "event" || !invocation.contentSha256) continue;
    try {
      const { events } = await getSessionEvents(invocation.sessionId, invocation.eventIndex, 1);
      const event = events[0];
      const data = event?.data;
      if (event?.eventType !== "skill.invoked" || !data || typeof data !== "object") continue;
      const { name, content } = data as { name?: unknown; content?: unknown };
      if (typeof name !== "string" || typeof content !== "string" || !content) continue;
      if (name.trim().toLowerCase() !== invocation.skillName.trim().toLowerCase()) continue;
      if ((await fingerprint(content)) !== invocation.contentSha256) continue;
      return isCurrent() ? { content, invocation } : null;
    } catch {
      // Archived/moved logs and stale index rows are expected. Keep trying
      // the remaining indexed invocations rather than displaying a guess.
    }
  }
  return null;
}
