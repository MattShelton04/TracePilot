// Configuration wire fields are generated from Rust. Keep only UI domain
// refinements here; changing a backend field regenerates the shared roster.
import type {
  TracePilotConfig_Serialize as WireConfig,
  ModelPriceEntry_Serialize as WireModelPriceEntry,
  TracePilotConfigPatch_Deserialize as WirePatch,
} from "./generated/contracts.js";
import type { PricingKind, PricingProvider, PricingStatus } from "./pricing.js";

type NonNullFields<T> = { [K in keyof T]: NonNullable<T[K]> };
type ConfigSections = {
  [K in keyof WireConfig]-?: Required<NonNullFields<NonNullable<WireConfig[K]>>>;
};

/** Pricing controls expose the supported domain choices over the Rust wire fields. */
export type ModelPriceEntry = Omit<
  NonNullFields<WireModelPriceEntry>,
  "pricingTier" | "source" | "pricingKind" | "status"
> & {
  pricingTier?: "default" | "long-context";
  source?: PricingProvider;
  pricingKind?: PricingKind;
  status?: PricingStatus;
};

/** Normalized application settings returned by the backend, persisted in config.toml. */
export type TracePilotConfig = Omit<ConfigSections, "pricing" | "alerts"> & {
  pricing: Omit<ConfigSections["pricing"], "models" | "removedModels"> & {
    models: ModelPriceEntry[];
    removedModels?: string[];
  };
  alerts: Omit<ConfigSections["alerts"], "scope"> & { scope: "monitored" | "all" };
};

/** Only supplied fields change; arrays and maps replace as a whole. */
export type TracePilotConfigPatch = Omit<
  {
    [K in keyof WirePatch]?: NonNullFields<NonNullable<WirePatch[K]>>;
  },
  "pricing" | "alerts"
> & {
  pricing?: Partial<TracePilotConfig["pricing"]>;
  alerts?: Partial<TracePilotConfig["alerts"]>;
};

/** A single entry in the release manifest used by the What's New modal. */
export interface ReleaseManifestEntry {
  version: string;
  date: string;
  notes: {
    added: string[];
    changed: string[];
    fixed: string[];
  };
  requiresReindex?: boolean;
}
