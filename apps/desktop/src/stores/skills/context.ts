import type { Skill, SkillScope, SkillSummary } from "@tracepilot/types";
import type { AsyncGuard } from "@tracepilot/ui";
import type { Ref, ShallowRef } from "vue";

export interface SkillsContext {
  skills: ShallowRef<SkillSummary[]>;
  selectedSkill: ShallowRef<Skill | null>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  searchQuery: Ref<string>;
  filterScope: Ref<"all" | SkillScope>;
  currentRepoRoot: Ref<string | undefined>;
  loadGuard: AsyncGuard;
}

export type LoadSkills = (repoRoot?: string) => Promise<void>;
