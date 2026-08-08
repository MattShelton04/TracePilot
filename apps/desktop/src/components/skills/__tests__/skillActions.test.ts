import { describe, expect, it, vi } from "vitest";
import { confirmSkillDeletion } from "../skillActions";

describe("confirmSkillDeletion", () => {
  it("does not delete when confirmation is cancelled", async () => {
    const deleteSkill = vi.fn(async () => true);
    const deleted = await confirmSkillDeletion(
      vi.fn(async () => ({ confirmed: false, checked: false })),
      deleteSkill,
      "/skills/demo",
    );
    expect(deleted).toBe(false);
    expect(deleteSkill).not.toHaveBeenCalled();
  });

  it("awaits deletion after confirmation", async () => {
    const deleteSkill = vi.fn(async () => true);
    expect(
      await confirmSkillDeletion(
        vi.fn(async () => ({ confirmed: true, checked: false })),
        deleteSkill,
        "/skills/demo",
      ),
    ).toBe(true);
    expect(deleteSkill).toHaveBeenCalledWith("/skills/demo");
  });
});
