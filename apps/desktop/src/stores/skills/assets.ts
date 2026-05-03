import {
  skillsAddAsset,
  skillsCopyAssetFrom,
  skillsListAssets,
  skillsReadAsset,
  skillsRemoveAsset,
} from "@tracepilot/client";
import type { SkillAsset } from "@tracepilot/types";
import { runMutation } from "@tracepilot/ui";
import { logWarn } from "@/utils/logger";
import type { SkillsContext } from "./context";

export function createSkillsAssetActions(context: SkillsContext) {
  const { error } = context;

  async function listAssets(dir: string): Promise<SkillAsset[]> {
    try {
      return await skillsListAssets(dir);
    } catch (e) {
      logWarn("[skills] Failed to list assets", { dir, error: e });
      return [];
    }
  }

  async function addAsset(dir: string, name: string, content: number[]): Promise<boolean> {
    return (
      (await runMutation(error, async () => {
        await skillsAddAsset(dir, name, content);
        return true as const;
      })) ?? false
    );
  }

  async function copyAssetFrom(dir: string, name: string, sourcePath: string): Promise<boolean> {
    return (
      (await runMutation(error, async () => {
        await skillsCopyAssetFrom(dir, name, sourcePath);
        return true as const;
      })) ?? false
    );
  }

  async function readAsset(dir: string, name: string): Promise<string | null> {
    try {
      return await skillsReadAsset(dir, name);
    } catch (e) {
      logWarn("[skills] Failed to read asset", { dir, name, error: e });
      return null;
    }
  }

  async function removeAsset(dir: string, name: string): Promise<boolean> {
    return (
      (await runMutation(error, async () => {
        await skillsRemoveAsset(dir, name);
        return true as const;
      })) ?? false
    );
  }

  return {
    listAssets,
    addAsset,
    copyAssetFrom,
    readAsset,
    removeAsset,
  };
}
