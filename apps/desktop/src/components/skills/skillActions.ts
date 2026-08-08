import type { ConfirmOptions, ConfirmResult } from "@tracepilot/ui";

export async function confirmSkillDeletion(
  confirm: (options: ConfirmOptions) => Promise<ConfirmResult>,
  deleteSkill: (directory: string) => Promise<unknown>,
  directory: string,
): Promise<boolean> {
  const { confirmed } = await confirm({
    title: "Delete Skill",
    message: "Delete this skill? This cannot be undone.",
    variant: "danger",
    confirmLabel: "Delete",
    cancelLabel: "Cancel",
  });
  if (!confirmed) return false;
  await deleteSkill(directory);
  return true;
}
