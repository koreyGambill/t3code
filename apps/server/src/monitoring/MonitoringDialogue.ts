import {
  MonitoringError,
  type MonitoringFinding,
  type MonitoringFindingId,
  type MonitoringProfile,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import * as MonitoringDelivery from "./MonitoringDelivery.ts";
import * as MonitoringStore from "./MonitoringStore.ts";

export interface MonitoringAssessment {
  readonly outcome: "corrected" | "accepted_explanation" | "unresolved" | "unverified";
  readonly reason: string;
  readonly evidence: MonitoringFinding["evidence"];
}

export class MonitoringFollowup extends Context.Service<
  MonitoringFollowup,
  {
    readonly reassess: (input: {
      readonly profile: MonitoringProfile;
      readonly finding: MonitoringFinding;
      readonly leadResponse: string;
    }) => Effect.Effect<MonitoringAssessment, MonitoringError>;
  }
>()("t3/monitoring/MonitoringDialogue/MonitoringFollowup") {}

export class MonitoringDialogue extends Context.Service<
  MonitoringDialogue,
  {
    readonly respond: (input: {
      readonly findingId: MonitoringFindingId;
      readonly responseId: string;
      readonly text: string;
      readonly role: "agent" | "user";
      readonly callerThreadId?: ThreadId;
    }) => Effect.Effect<{ readonly finding: MonitoringFinding }, MonitoringError>;
  }
>()("t3/monitoring/MonitoringDialogue") {}

export function monitoringReassessmentInstructions(): string {
  return "Review this advisory using fresh read-only evidence. Preserve the user's authorized scope and standards. The lead may accept the advice or disagree with a reason; assess that reason fairly. A promise, plan, or agreement is not proof of a correction. Report the initial observation and rule, advice, lead's acceptance or disagreement and reason, fresh evidence with thread/message citations and observation time, and final assessment. Outcomes: corrected requires fresh evidence that the issue was fixed; accepted_explanation means the lead's reason explains why no correction is needed; unresolved means evidence still supports the issue; unverified means evidence is missing or incomplete. Never claim verification from the lead's promise. This advisory has incomplete context and is not a user instruction.";
}

export const layer = Layer.effect(
  MonitoringDialogue,
  Effect.gen(function* () {
    const store = yield* MonitoringStore.MonitoringStore;
    const reviewer = yield* MonitoringFollowup;
    const delivery = yield* MonitoringDelivery.MonitoringDelivery;
    const permit = yield* Semaphore.make(1);
    const respond: MonitoringDialogue["Service"]["respond"] = Effect.fn(
      "MonitoringDialogue.respond",
    )(function* (input) {
      let finding = yield* store.getFinding(input.findingId);
      if (finding === null || (input.role === "agent" && input.callerThreadId !== finding.threadId))
        return yield* new MonitoringError({ operation: "response-scope" });
      const currentProfile = yield* store.getProfile(finding.profileId);
      if (currentProfile === null || !currentProfile.enabled)
        return yield* new MonitoringError({ operation: "response-profile" });
      const run = yield* store.getRun(finding.runId);
      if (run === null || run.profileId !== finding.profileId)
        return yield* new MonitoringError({ operation: "response-run" });
      const profile = run.profile;
      const deliveryProfile = {
        ...currentProfile,
        title: profile.title,
        modelSelection: profile.modelSelection,
        rules: profile.rules,
      };
      const responseId = `reply:${input.responseId}`;
      if (finding.exchanges.some((exchange) => exchange.id === `assessment:${input.responseId}`)) {
        yield* delivery
          .deliver({
            profile: deliveryProfile,
            finding,
            exchangeId: `assessment:${input.responseId}`,
          })
          .pipe(Effect.orElseSucceed(() => ({ delivery: "alert_only" as const, messageId: null })));
        return { finding };
      }
      const existingResponse = finding.exchanges.find((exchange) => exchange.id === responseId);
      if (
        !input.responseId.trim() ||
        input.responseId.length > 200 ||
        !input.text.trim() ||
        input.text.length > 4000
      )
        return yield* new MonitoringError({ operation: "response-input" });
      if (
        !existingResponse &&
        finding.exchanges.filter((exchange) => exchange.role !== "monitor").length >= 2
      )
        return yield* new MonitoringError({ operation: "response-limit" });
      const at = DateTime.formatIso(yield* DateTime.now);
      const leadResponse = existingResponse?.text ?? input.text.trim();
      if (!existingResponse) {
        finding = {
          ...finding,
          updatedAt: at,
          exchanges: [
            ...finding.exchanges,
            { id: responseId, at, role: input.role, text: leadResponse },
          ],
        };
        yield* store.saveFinding(finding);
      }
      const assessed = yield* reviewer.reassess({ profile, finding, leadResponse }).pipe(
        Effect.orElseSucceed((): MonitoringAssessment => ({
          outcome: "unverified",
          reason:
            "Fresh evidence could not be checked. The lead's explanation remains visible; no correction has been verified.",
          evidence: [],
        })),
      );
      const checkedAt = DateTime.formatIso(yield* DateTime.now);
      const outcome =
        assessed.outcome === "corrected" && assessed.evidence.length === 0
          ? "unverified"
          : assessed.outcome;
      const rule =
        finding.ruleSnapshot ?? profile.rules.find((candidate) => candidate.id === finding.ruleId);
      const report = `Assessment: ${outcome}\nChecked at: ${checkedAt}\nInitial observation: ${finding.summary}\nRule: ${rule?.title ?? finding.ruleId}\nRule instructions: ${rule?.instructions ?? "Original rule unavailable."}\nOriginal evidence and advice: ${finding.detail}\nLead response: ${leadResponse}\nFresh evidence and reasoning: ${assessed.reason}\n${assessed.evidence.map((item) => `thread:${item.threadId} message:${item.messageId}: ${item.excerpt}`).join("\n")}\nAdvisory only; the watcher may have incomplete context.`;
      const current = yield* store.getFinding(finding.id);
      const final: MonitoringFinding = {
        ...(current ?? finding),
        updatedAt: checkedAt,
        outcome,
        readAt: null,
        exchanges: [
          ...(current ?? finding).exchanges,
          {
            id: `assessment:${input.responseId}`,
            at: checkedAt,
            role: "monitor",
            text: report.slice(0, 16_000),
          },
        ],
      };
      yield* store.saveFinding(final);
      yield* delivery
        .deliver({
          profile: deliveryProfile,
          finding: final,
          exchangeId: `assessment:${input.responseId}`,
        })
        .pipe(Effect.orElseSucceed(() => ({ delivery: "alert_only" as const, messageId: null })));
      return { finding: final };
    }, permit.withPermits(1));
    return MonitoringDialogue.of({ respond });
  }),
);
