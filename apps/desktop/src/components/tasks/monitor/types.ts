import type { ModelInfo } from "@tracepilot/types";

export interface OrchestratorMonitorModelTier {
  id: string;
  label: string;
  desc: string;
  order: number;
  models: ModelInfo[];
}
