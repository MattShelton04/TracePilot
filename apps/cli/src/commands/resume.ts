/**
 * `tracepilot resume <session-id>` — print the command to resume a session.
 */

import { findSession } from "./utils.js";
import { wrapCommand } from "../utils/errorHandler.js";

export async function resumeCommand(sessionIdArg: string) {
  return wrapCommand(async () => {
    const sessionId = await findSession(sessionIdArg);
    console.log(`gh copilot-cli --resume ${sessionId}`);
  });
}
