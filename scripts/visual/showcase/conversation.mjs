// The hero session's conversation: exploration with two parallel explore
// agents, an implementation stretch, then a review turn where three
// background agents run in parallel and message each other.

import { HERO_SESSION_ID, MINUTE } from "./common.mjs";
import { reviewTurn } from "./review-turn.mjs";
import { heroAt } from "./sessions.mjs";
import { agent, call, readAgent, resetEvents, say } from "./turn-builders.mjs";

function explorationTurn() {
  const start = 0;
  const reasoning = say(
    "**Locating the payment seam**\n\nCheckout already routes card payments through a `PaymentProvider` interface. Before changing anything I need to know how providers are registered and where the app decides which payment methods a device supports. Those are independent questions, so two explore agents can answer them in parallel.",
  );
  const intent = call(
    "intent-explore",
    "report_intent",
    start + 0.2,
    4,
    { intent: "Exploring checkout payments" },
    "Intent logged",
  );
  const opening = say(
    "I'll map how checkout registers payment providers and where device capability checks live — two explore agents can do that in parallel.",
  );
  const registry = agent(
    "agent-registry",
    "explore",
    "Map payment provider registry",
    start + 0.5,
    48_000,
    "Find the PaymentProvider interface, every implementation, and how providers are registered and selected at checkout. Report file paths and the registration API.",
    {
      key: "registry",
      description: "Fast codebase exploration",
      model: "claude-haiku-4.5",
      tools: 9,
      tokens: 61_240,
      result:
        "`PaymentProvider` lives in `src/payments/types.ts`. Providers register through `registerProvider()` in `src/payments/registry.ts`; `StripeCardProvider` is the only implementation today.",
    },
  );
  const device = agent(
    "agent-device",
    "explore",
    "Find device capability checks",
    start + 0.5,
    36_000,
    "Find where checkout decides which payment methods the current browser supports (Payment Request API, canMakePayment, user-agent checks).",
    {
      key: "device",
      description: "Fast codebase exploration",
      model: "claude-haiku-4.5",
      tools: 6,
      tokens: 38_910,
      result:
        "Capability checks are centralised in `src/composables/useDeviceSupport.ts`, which already wraps `PaymentRequest.canMakePayment()`.",
    },
  );
  const children = [
    call(
      "reg-grep",
      "grep",
      start + 0.6,
      210,
      { pattern: "PaymentProvider", path: "src" },
      "src/payments/types.ts:12:export interface PaymentProvider {\nsrc/payments/registry.ts:4:import type { PaymentProvider } from './types';\nsrc/payments/providers/stripeCard.ts:9:export class StripeCardProvider implements PaymentProvider {",
      { parentToolCallId: "agent-registry", intentionSummary: "Find provider interface" },
    ),
    call(
      "dev-grep",
      "grep",
      start + 0.6,
      180,
      { pattern: "canMakePayment|PaymentRequest", path: "src" },
      "src/composables/useDeviceSupport.ts:18:  const request = new PaymentRequest(methods, details);\nsrc/composables/useDeviceSupport.ts:21:  return request.canMakePayment();",
      { parentToolCallId: "agent-device", intentionSummary: "Find Payment Request usage" },
    ),
    call(
      "reg-view",
      "view",
      start + 0.8,
      95,
      { path: "src/payments/registry.ts" },
      "1. import type { PaymentProvider } from './types';\n2. \n3. const providers = new Map<string, PaymentProvider>();\n4. \n5. export function registerProvider(provider: PaymentProvider) {\n6.   providers.set(provider.id, provider);\n7. }",
      { parentToolCallId: "agent-registry", intentionSummary: "Read provider registry" },
    ),
    call(
      "dev-view",
      "view",
      start + 0.9,
      88,
      { path: "src/composables/useDeviceSupport.ts" },
      "1. export function useDeviceSupport() {\n2.   const supported = ref<string[]>([]);",
      { parentToolCallId: "agent-device", intentionSummary: "Read device support composable" },
    ),
  ];
  const readRegistry = readAgent(
    "read-registry",
    start + 1.4,
    "registry",
    "explore",
    "Map payment provider registry",
    "claude-haiku-4.5",
    "48s",
    registry.resultContent,
  );
  const readDevice = readAgent(
    "read-device",
    start + 1.4,
    "device",
    "explore",
    "Find device capability checks",
    "claude-haiku-4.5",
    "36s",
    device.resultContent,
  );
  const plan = say(
    "Both answers line up well. The plan:\n\n1. Add an `ApplePayProvider` that implements `PaymentProvider` and validates merchants through the existing session endpoint.\n2. Register it behind the `applePay` feature flag.\n3. Extend `useDeviceSupport()` so the button only renders where `canMakePayment()` succeeds.\n4. Cover it with unit tests and a Playwright checkout scenario, leaving the Stripe card flow untouched.",
  );
  const todos = call(
    "todos-insert",
    "sql",
    start + 2,
    32,
    {
      description: "Create implementation todos",
      query:
        "INSERT INTO todos (id, title, status) VALUES ('provider', 'Implement ApplePayProvider', 'pending'), …",
    },
    "8 row(s) inserted.",
    { intentionSummary: "Create implementation todos" },
  );
  return {
    turnIndex: 0,
    eventIndex: 0,
    userMessage:
      "Add Apple Pay as a payment option in checkout. Use the existing PaymentProvider interface, only show it on supported devices, and keep the Stripe card flow untouched.",
    timestamp: heroAt(start),
    endTimestamp: heroAt(start + 2.2),
    durationMs: 2.2 * MINUTE,
    model: "claude-opus-5.5",
    isComplete: true,
    outputTokens: 3_840,
    reasoningTexts: [reasoning],
    assistantMessages: [opening, plan],
    toolCalls: [intent, registry, device, ...children, readRegistry, readDevice, todos],
    agentMessages: [
      {
        content: registry.arguments.prompt,
        recipientToolCallId: "agent-registry",
        senderAgentId: HERO_SESSION_ID,
        delivery: "idle",
        isLaunch: true,
        timestamp: registry.startedAt,
        eventIndex: registry.eventIndex + 1,
      },
      {
        content: device.arguments.prompt,
        recipientToolCallId: "agent-device",
        senderAgentId: HERO_SESSION_ID,
        delivery: "idle",
        isLaunch: true,
        timestamp: device.startedAt,
        eventIndex: device.eventIndex + 1,
      },
    ],
  };
}

// [user message, intent, assistant summary, [tool, path/command, intention, result]]
const implementation = [
  [
    "Looks good — start with the provider.",
    "Implementing Apple Pay provider",
    "Created `ApplePayProvider` with merchant validation through the existing session endpoint.",
    [
      [
        "create",
        "src/payments/providers/applePay.ts",
        "Add ApplePayProvider",
        "Created file src/payments/providers/applePay.ts with 128 lines",
      ],
      [
        "edit",
        "src/payments/types.ts",
        "Add wallet token type",
        "File src/payments/types.ts updated with changes.",
      ],
    ],
  ],
  [
    "Use the merchant ID from runtime config, not an env var.",
    "Reading runtime config",
    "The merchant ID now comes from `useRuntimeConfig().payments.applePayMerchantId`.",
    [
      [
        "view",
        "src/config/runtime.ts",
        "Read runtime config",
        "1. export const runtimeConfig = defineRuntimeConfig({",
      ],
      [
        "edit",
        "src/payments/providers/applePay.ts",
        "Use runtime merchant ID",
        "File src/payments/providers/applePay.ts updated with changes.",
      ],
    ],
  ],
  [
    "Register it behind the applePay flag.",
    "Registering provider",
    "Registered behind `flags.applePay`; the card provider is unchanged.",
    [
      [
        "edit",
        "src/payments/registry.ts",
        "Register behind feature flag",
        "File src/payments/registry.ts updated with changes.",
      ],
      [
        "powershell",
        "pnpm vitest run src/payments",
        "Run payment unit tests",
        "✓ src/payments/registry.test.ts (6 tests)\n✓ src/payments/providers/stripeCard.test.ts (14 tests)\n\nTest Files  2 passed (2)\n     Tests  20 passed (20)",
      ],
    ],
  ],
  [
    "Now the device check.",
    "Extending device support",
    "`useDeviceSupport()` now reports `apple-pay` when `canMakePayment()` succeeds.",
    [
      [
        "edit",
        "src/composables/useDeviceSupport.ts",
        "Detect Apple Pay support",
        "File src/composables/useDeviceSupport.ts updated with changes.",
      ],
    ],
  ],
  [
    "Show the button in PaymentMethods.vue.",
    "Updating checkout UI",
    "The Apple Pay button renders above the card form on supported devices.",
    [
      [
        "edit",
        "src/components/checkout/PaymentMethods.vue",
        "Render Apple Pay button",
        "File src/components/checkout/PaymentMethods.vue updated with changes.",
      ],
      [
        "view",
        "src/components/checkout/PaymentMethods.vue",
        "Check template",
        "42.   <ApplePayButton v-if=\"supports('apple-pay')\" @pay=\"payWith('apple-pay')\" />",
      ],
    ],
  ],
  [
    "Add unit tests for the provider.",
    "Writing provider tests",
    "Added 11 provider tests covering validation, cancellation and token mapping.",
    [
      [
        "create",
        "src/payments/providers/applePay.test.ts",
        "Add provider tests",
        "Created file src/payments/providers/applePay.test.ts with 164 lines",
      ],
      [
        "powershell",
        "pnpm vitest run src/payments",
        "Run payment unit tests",
        "Test Files  3 passed (3)\n     Tests  31 passed (31)",
      ],
    ],
  ],
  [
    "Typecheck everything.",
    "Typechecking",
    "Typecheck passes across the workspace.",
    [["powershell", "pnpm typecheck", "Run typecheck", "> vue-tsc --noEmit\nDone in 18.4s"]],
  ],
];
const wrapUp = [
  [
    "Fix the review finding.",
    "Fixing review finding",
    "The provider now aborts the merchant session when the sheet is dismissed.",
    [
      [
        "edit",
        "src/payments/providers/applePay.ts",
        "Abort session on cancel",
        "File src/payments/providers/applePay.ts updated with changes.",
      ],
      [
        "powershell",
        "pnpm vitest run src/payments",
        "Run payment unit tests",
        "Test Files  3 passed (3)\n     Tests  33 passed (33)",
      ],
    ],
  ],
  [
    "Run the full e2e suite once.",
    "Running end-to-end tests",
    "All 46 Playwright scenarios pass, including the new Apple Pay flow.",
    [
      [
        "powershell",
        "pnpm test:e2e",
        "Run Playwright suite",
        "Running 46 tests using 4 workers\n  46 passed (2.1m)",
      ],
    ],
  ],
  [
    "Open the PR.",
    "Opening pull request",
    "Pushed `feature/apple-pay` and opened a draft PR with the test plan.",
    [
      [
        "powershell",
        "git push -u origin feature/apple-pay",
        "Push branch",
        "branch 'feature/apple-pay' set up to track 'origin/feature/apple-pay'.",
      ],
      [
        "powershell",
        "gh pr create --draft --fill",
        "Open draft PR",
        "https://github.example/acme/checkout-web/pull/1482",
      ],
    ],
  ],
];

function simpleTurn(turnIndex, minute, [userMessage, intent, summary, tools]) {
  const turnStart = minute;
  const calls = [
    call(`intent-${turnIndex}`, "report_intent", minute, 4, { intent }, "Intent logged"),
  ];
  const assistant = say(summary);
  tools.forEach(([toolName, target, intention, result], index) => {
    const args =
      toolName === "powershell"
        ? { command: target, description: intention }
        : toolName === "edit"
          ? { path: target, old_str: "…", new_str: "…" }
          : { path: target };
    const duration = toolName === "powershell" ? 18_000 + index * 9_000 : 60 + index * 40;
    calls.push(
      call(`t${turnIndex}-${index}`, toolName, minute + 0.3 + index * 0.4, duration, args, result, {
        intentionSummary: intention,
      }),
    );
  });
  return {
    turnIndex,
    eventIndex: calls[0].eventIndex,
    userMessage,
    timestamp: heroAt(turnStart),
    endTimestamp: heroAt(turnStart + 2.6),
    durationMs: 2.6 * MINUTE,
    model: "claude-opus-5.5",
    isComplete: true,
    outputTokens: 900 + tools.length * 640,
    assistantMessages: [assistant],
    toolCalls: calls,
  };
}

function buildTurns() {
  resetEvents();
  const turns = [explorationTurn()];
  let minute = 4;
  for (const step of implementation) {
    turns.push(simpleTurn(turns.length, minute, step));
    minute += 3.4;
  }
  turns.push(reviewTurn(turns.length, minute));
  minute += 7;
  for (const step of wrapUp) {
    turns.push(simpleTurn(turns.length, minute, step));
    minute += 3.1;
  }
  return turns;
}

export const heroTurns = buildTurns();

export function heroToolResult(toolCallId) {
  for (const turn of heroTurns) {
    const match = turn.toolCalls.find((tc) => tc.toolCallId === toolCallId);
    if (match) return match.resultContent ?? null;
  }
  return null;
}
