import type { Skill, SkillDiagnostic, SkillSummary } from "@tracepilot/types";
import type { AsyncGuard } from "@tracepilot/ui";
import type { Ref, ShallowRef } from "vue";
import type { SkillFlag, SkillScopeFilter, SkillSortKey } from "@/utils/skills/entries";

export interface SkillsContext {
  skills: ShallowRef<SkillSummary[]>;
  diagnostics: ShallowRef<SkillDiagnostic[]>;
  selectedSkill: ShallowRef<Skill | null>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  searchQuery: Ref<string>;
  filterScope: Ref<SkillScopeFilter>;
  filterFlags: Ref<ReadonlySet<SkillFlag>>;
  sort: Ref<SkillSortKey>;
  currentRepoRoot: Ref<string | undefined>;
  loadGuard: AsyncGuard;
}

export type LoadSkills = (repoRoot?: string) => Promise<void>;
