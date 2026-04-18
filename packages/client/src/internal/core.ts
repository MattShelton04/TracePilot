import { createInvoke } from "../invoke.js";
import { getMockData } from "./mockData.js";

/**
 * Shared invoke instance for all core `@tracepilot/client` domain modules.
 * Routes to the Tauri plugin in production and to `getMockData` in dev/test.
 */
export const invoke = createInvoke("Core", getMockData);
