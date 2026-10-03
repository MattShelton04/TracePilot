// The hero's review turn: code-review, e2e and Safari agents run in
// parallel; the main agent steers one and the reviewer messages a peer.

import { HERO_SESSION_ID, MINUTE } from "./common.mjs";
import { heroAt } from "./sessions.mjs";
import { AGENT_IDS, agent, call, readAgent, say } from "./turn-builders.mjs";

export function reviewTurn(turnIndex, minute) {
  const intent = call(
    "intent-review",
    "report_intent",
    minute,
    4,
    { intent: "Reviewing changes" },
    "Intent logged",
  );
  const opening = say(
    "I'll run a code review, write end-to-end coverage, and check Safari support in parallel.",
  );
  const review = agent(
    "agent-review",
    "code-review",
    "Review Apple Pay provider",
    minute + 0.2,
    252_000,
    "Review the diff on feature/apple-pay. Only report real bugs, security issues or logic errors.",
    {
      key: "review",
      description: "High signal-to-noise code review",
      model: "gpt-6-sol",
      tools: 23,
      tokens: 412_800,
      result:
        "One issue: dismissing the payment sheet leaves the merchant session open, so a retry within 30 s fails validation.",
    },
  );
  const e2e = agent(
    "agent-e2e",
    "general-purpose",
    "Write Playwright Apple Pay coverage",
    minute + 0.2,
    318_000,
    "Add a Playwright scenario that stubs ApplePaySession and completes checkout with the new provider.",
    {
      key: "e2e",
      description: "Full-capability agent",
      model: "claude-sonnet-5",
      tools: 31,
      tokens: 528_400,
      result:
        "Added `e2e/checkout/apple-pay.spec.ts` covering success, cancellation and declined payment.",
    },
  );
  const safari = agent(
    "agent-safari",
    "explore",
    "Check Safari payment support",
    minute + 0.2,
    64_000,
    "Confirm which Safari versions support the Payment Request API path we use and whether a polyfill is needed.",
    {
      key: "safari",
      description: "Fast codebase exploration",
      model: "claude-haiku-4.5",
      tools: 7,
      tokens: 44_120,
      result:
        "Safari 16.4+ supports the path; no polyfill needed. The browserslist already excludes older versions.",
    },
  );
  const steer = call(
    "write-e2e",
    "write_agent",
    minute + 1.5,
    900,
    {
      agent_id: AGENT_IDS.e2e,
      message: "Also cover the declined-payment path — the review agent is checking cancellation.",
    },
    `Message delivered to 1 agent.\n- ${AGENT_IDS.e2e}, delivered, task_status=running`,
  );
  const peer = call(
    "write-peer",
    "write_agent",
    minute + 3.1,
    700,
    {
      agent_id: AGENT_IDS.e2e,
      message:
        "Found a cancel bug: the merchant session stays open after the sheet is dismissed. Please assert a retry works after cancelling.",
    },
    `Message delivered to 1 agent.\n- ${AGENT_IDS.e2e}, delivered, task_status=running`,
    { parentToolCallId: "agent-review" },
  );
  const children = [
    call(
      "rev-diff",
      "powershell",
      minute + 0.4,
      2_100,
      { command: "git diff main...feature/apple-pay --stat", description: "Inspect the diff" },
      " src/payments/providers/applePay.ts      | 141 ++++++++\n src/payments/registry.ts               |   9 +-\n src/composables/useDeviceSupport.ts    |  22 ++-\n src/components/checkout/PaymentMethods.vue | 18 +-\n 6 files changed, 352 insertions(+), 11 deletions(-)",
      { parentToolCallId: "agent-review", intentionSummary: "Inspect the diff" },
    ),
    call(
      "e2e-create",
      "create",
      minute + 1.1,
      120,
      { path: "e2e/checkout/apple-pay.spec.ts" },
      "Created file e2e/checkout/apple-pay.spec.ts with 96 lines",
      { parentToolCallId: "agent-e2e", intentionSummary: "Add Apple Pay scenario" },
    ),
    call(
      "saf-grep",
      "grep",
      minute + 0.5,
      160,
      { pattern: "safari|ios_saf", path: ".browserslistrc" },
      "last 2 Safari versions\nios_saf >= 16.4",
      { parentToolCallId: "agent-safari", intentionSummary: "Check browser targets" },
    ),
    call(
      "e2e-run",
      "powershell",
      minute + 4.2,
      41_000,
      {
        command: "pnpm playwright test e2e/checkout/apple-pay.spec.ts",
        description: "Run new scenario",
      },
      "Running 4 tests using 2 workers\n  4 passed (38.2s)",
      { parentToolCallId: "agent-e2e", intentionSummary: "Run new scenario" },
    ),
  ];
  const reads = [
    readAgent(
      "read-safari",
      minute + 1.3,
      "safari",
      "explore",
      "Check Safari payment support",
      "claude-haiku-4.5",
      "64s",
      safari.resultContent,
    ),
    readAgent(
      "read-review",
      minute + 4.4,
      "review",
      "code-review",
      "Review Apple Pay provider",
      "gpt-6-sol",
      "4m 12s",
      review.resultContent,
    ),
    readAgent(
      "read-e2e",
      minute + 5.4,
      "e2e",
      "general-purpose",
      "Write Playwright Apple Pay coverage",
      "claude-sonnet-5",
      "5m 18s",
      e2e.resultContent,
    ),
  ];
  const closing = say(
    "Review found one real issue (an open merchant session after cancelling) and the new Playwright scenario now covers it. Safari 16.4+ needs no polyfill. I'll fix the finding next.",
  );
  const launches = [review, e2e, safari].map((tc) => ({
    content: tc.arguments.prompt,
    recipientToolCallId: tc.toolCallId,
    senderAgentId: HERO_SESSION_ID,
    delivery: "idle",
    isLaunch: true,
    timestamp: tc.startedAt,
    eventIndex: tc.eventIndex + 1,
  }));
  return {
    turnIndex,
    eventIndex: intent.eventIndex,
    userMessage: "Before we open the PR, get a proper review and e2e coverage.",
    timestamp: heroAt(minute),
    endTimestamp: heroAt(minute + 5.8),
    durationMs: 5.8 * MINUTE,
    model: "claude-opus-5.5",
    isComplete: true,
    outputTokens: 5_210,
    assistantMessages: [opening, closing],
    toolCalls: [intent, review, e2e, safari, ...children, steer, peer, ...reads],
    agentMessages: [
      ...launches,
      {
        content: steer.arguments.message,
        recipientToolCallId: "agent-e2e",
        senderAgentId: HERO_SESSION_ID,
        delivery: "queued",
        isLaunch: false,
        timestamp: steer.completedAt,
        eventIndex: steer.eventIndex + 1,
      },
      {
        content: peer.arguments.message,
        recipientToolCallId: "agent-e2e",
        senderAgentId: AGENT_IDS.review,
        senderToolCallId: "agent-review",
        delivery: "queued",
        isLaunch: false,
        timestamp: peer.completedAt,
        eventIndex: peer.eventIndex + 1,
      },
    ],
  };
}
