/**
 * `tracepilot resume <session-id>` — print the command to resume a session.
 */

import { wrapCommand } from "../utils/errorHandler.js";
import { findSession } from "./utils.js";

export async function resumeCommand(sessionIdArg: string) {
  return wrapCommand(async () => {
    const sessionId = await findSession(sessionIdArg);
    console.log(`gh copilot-cli --resume ${sessionId}`);
  });
}
