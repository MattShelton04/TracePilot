import type { Skill, SkillScope, SkillSummary } from "@tracepilot/types";
import type { AsyncGuard } from "@tracepilot/ui";
import type { Ref, ShallowRef } from "vue";
import type { EncounteredSkillSummary } from "./encountered";

export interface SkillsContext {
  skills: ShallowRef<SkillSummary[]>;
  encounteredSkills: ShallowRef<EncounteredSkillSummary[]>;
  selectedSkill: ShallowRef<Skill | null>;
  loading: Ref<boolean>;
  encounteredLoading: Ref<boolean>;
  error: Ref<string | null>;
  encounteredError: Ref<string | null>;
  searchQuery: Ref<string>;
  filterScope: Ref<"all" | SkillScope>;
  currentRepoRoot: Ref<string | undefined>;
  loadGuard: AsyncGuard;
}

export type LoadSkills = (repoRoot?: string) => Promise<void>;
