import { mockConfigCommand } from "./mockConfig.js";

// Loaded on first use so the mock datasets stay out of the Tauri bundle.
let routesModule: Promise<typeof import("../mock/routes/index.js")> | null = null;

/**
 * Fallback mock data source used when running outside the Tauri webview.
 * Answers live per client module in `mock/routes/`.
 */
export async function getMockData<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (["get_config", "save_config", "update_config"].includes(cmd))
    return mockConfigCommand(cmd, args) as T;
  routesModule ??= import("../mock/routes/index.js");
  const { mockRoute } = await routesModule;
  return mockRoute(cmd, args) as T;
}
