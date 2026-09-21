/**
 * Formatting helpers for the session-store request ledger.
 *
 * The exact-decimal arithmetic here exists because `totalNanoAiu` routinely
 * exceeds `Number.MAX_SAFE_INTEGER` and `costPerBatch` is routinely a decimal
 * binary floating point cannot hold: parsing either with `Number()` would
 * corrupt the very figure the drawer is there to explain. Every value is kept
 * as a scaled `bigint` and only turned into text at the edge.
 */

import type {
  BillingCheck,
  BillingItemsStatus,
  ReconciliationStatus,
  StoreAvailability,
  StoredRequest,
} from "@tracepilot/types";

/** Shown wherever the source recorded nothing. A recorded `0` is not this. */
export const NOT_RECORDED = "—";

/** A decimal held exactly: the value is `units / 10 ** scale`. */
export interface ExactDecimal {
  units: bigint;
  scale: number;
}

const DECIMAL_RE = /^[+-]?\d+(?:\.\d+)?$/;

/** Parse a recorded decimal string. Returns null for anything unparseable. */
export function parseExactDecimal(raw: string | null | undefined): ExactDecimal | null {
  if (raw == null) return null;
  const text = raw.trim();
  if (!DECIMAL_RE.test(text)) return null;
  const signed = text.startsWith("+") ? text.slice(1) : text;
  const dot = signed.indexOf(".");
  if (dot < 0) return { units: BigInt(signed), scale: 0 };
  const frac = signed.slice(dot + 1);
  return { units: BigInt(`${signed.slice(0, dot)}${frac}`), scale: frac.length };
}

function rescale(value: ExactDecimal, scale: number): bigint {
  return value.units * 10n ** BigInt(scale - value.scale);
}

/** Exact addition; neither operand is rounded. */
export function addExact(a: ExactDecimal, b: ExactDecimal): ExactDecimal {
  const scale = Math.max(a.scale, b.scale);
  return { units: rescale(a, scale) + rescale(b, scale), scale };
}

/** Divide by a power of ten by moving the point, never by dividing. */
export function shiftDecimal(value: ExactDecimal, places: number): ExactDecimal {
  return { units: value.units, scale: value.scale + places };
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Render with a fixed number of fraction digits, rounding half away from zero. */
export function toFixedExact(value: ExactDecimal, digits: number): string {
  const negative = value.units < 0n;
  let units = negative ? -value.units : value.units;
  if (digits < value.scale) {
    const divisor = 10n ** BigInt(value.scale - digits);
    const remainder = units % divisor;
    units /= divisor;
    if (remainder * 2n >= divisor) units += 1n;
  } else if (digits > value.scale) {
    units *= 10n ** BigInt(digits - value.scale);
  }
  const padded = units.toString().padStart(digits + 1, "0");
  const whole = groupThousands(padded.slice(0, padded.length - digits));
  const frac = digits > 0 ? padded.slice(padded.length - digits) : "";
  const body = frac ? `${whole}.${frac}` : whole;
  return negative && units !== 0n ? `-${body}` : body;
}

function integerDigits(value: ExactDecimal): number {
  const abs = value.units < 0n ? -value.units : value.units;
  const whole = abs / 10n ** BigInt(value.scale);
  return whole === 0n ? 0 : whole.toString().length;
}

/** Mirrors `formatAiCredits`' precision ladder, decided without `Number()`. */
function creditFractionDigits(value: ExactDecimal): number {
  const abs = value.units < 0n ? -value.units : value.units;
  if (abs === 0n) return 0;
  const digits = integerDigits(value);
  if (digits >= 4) return 0;
  if (digits === 3) return 1;
  if (digits >= 1) return 2;
  return abs * 1000n < 10n ** BigInt(value.scale) ? 6 : 3;
}

/** Nano AI units are AI credits scaled by 1e9. */
const NANO_AIU_PLACES = 9;

/** A bounded display value for an exact nano-AIU total. */
export function formatExactCredits(value: ExactDecimal | null): string {
  if (!value) return NOT_RECORDED;
  const credits = shiftDecimal(value, NANO_AIU_PLACES);
  const text = toFixedExact(credits, creditFractionDigits(credits)).replace(/(\.\d*?)0+$/, "$1");
  return `${text.endsWith(".") ? text.slice(0, -1) : text} AIC`;
}

/** Display credits for one recorded nano-AIU string. */
export function formatNanoAiu(raw: string | null | undefined): string {
  return formatExactCredits(parseExactDecimal(raw));
}

/** What a page of rows charged, and how much of the page is behind that sum. */
export interface CreditSum {
  total: ExactDecimal | null;
  /** Rows that recorded a usable charge. */
  counted: number;
  /** Rows with no recorded charge at all. */
  missing: number;
  /** Rows whose recorded charge could not be parsed; excluded from the sum. */
  unparsed: number;
}

export function sumNanoAiu(requests: readonly StoredRequest[]): CreditSum {
  let total: ExactDecimal | null = null;
  let counted = 0;
  let missing = 0;
  let unparsed = 0;
  for (const request of requests) {
    if (request.totalNanoAiu == null) {
      missing += 1;
      continue;
    }
    const parsed = parseExactDecimal(request.totalNanoAiu);
    if (!parsed) {
      unparsed += 1;
      continue;
    }
    total = total ? addExact(total, parsed) : parsed;
    counted += 1;
  }
  return { total, counted, missing, unparsed };
}

/** The exact recorded per-batch rate, shown verbatim in the drawer. */
export function formatCostPerBatch(raw: string | null): string {
  return raw == null || raw.trim() === "" ? NOT_RECORDED : raw;
}

/**
 * A counter cell. `recorded: false` marks the em-dash so callers can attach
 * the "not recorded" tooltip that keeps it distinct from a recorded zero.
 */
export interface CounterCell {
  text: string;
  recorded: boolean;
}

export function counterCell(value: number | null | undefined): CounterCell {
  if (value == null) return { text: NOT_RECORDED, recorded: false };
  return { text: value.toLocaleString("en-US"), recorded: true };
}

export function millisecondCell(value: number | null | undefined): CounterCell {
  if (value == null) return { text: NOT_RECORDED, recorded: false };
  const rounded = Math.round(value * 10) / 10;
  return {
    text: rounded >= 1000 ? `${(rounded / 1000).toFixed(2)}s` : `${rounded}ms`,
    recorded: true,
  };
}

export function textCell(value: string | null | undefined): CounterCell {
  if (value == null || value === "") return { text: NOT_RECORDED, recorded: false };
  return { text: value, recorded: true };
}

export const NOT_RECORDED_HINT = "The source did not record this value.";

export const AVAILABILITY_LABELS: Record<StoreAvailability, string> = {
  disabled: "Disabled",
  missing: "No session store found",
  ready: "Ready",
  busy: "Busy",
  unreadable: "Unreadable",
  incompatible: "Incompatible schema",
};

export const RECONCILIATION_LABELS: Record<ReconciliationStatus, string> = {
  unverified: "Not verified",
  reconciled: "Reconciled",
  scopeDifference: "Different accounting scope",
  partial: "Partially reconciled",
  mismatch: "Mismatch",
};

export function accountingScopeLabel(scope: string | null): string {
  if (scope === "allRequests") return "all recorded requests";
  if (scope === "excludingCompaction") return "requests excluding compaction";
  return "an unrecorded accounting scope";
}

export function reconciliationMetricLabel(metric: string): string {
  const labels: Record<string, string> = {
    requests: "request count",
    inputTokens: "input tokens",
    outputTokens: "output tokens",
    cacheReadTokens: "cache reads",
    nanoAiu: "AI credits",
  };
  return labels[metric] ?? metric;
}

export const BILLING_STATUS_LABELS: Record<BillingItemsStatus, string> = {
  complete: "Complete",
  absent: "Not recorded",
  partial: "Partial",
  invalid: "Invalid",
};

export const BILLING_CHECK_LABELS: Record<BillingCheck, string> = {
  exact: "Items reproduce the recorded charge",
  differs: "Items differ from the recorded charge",
  notComparable: "Items are not comparable to the charge",
  incomputable: "Charge could not be recomputed",
};

/** Only `exact` is a clean result; everything else deserves attention. */
export function billingCheckTone(check: BillingCheck): "success" | "warning" | "neutral" {
  if (check === "exact") return "success";
  return check === "differs" ? "warning" : "neutral";
}

/** A stable per-row key: row ids repeat across source generations. */
export function requestKey(request: StoredRequest): string {
  return `${request.generation}:${request.sourceRowId}`;
}

/** The label for an agent attribution, without implying a TracePilot turn. */
export function agentLabel(request: StoredRequest): string {
  return request.agentId ?? NOT_RECORDED;
}
