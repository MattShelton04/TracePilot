/**
 * `tracepilot resume <session-id>` — print the command to resume a session.
 */

import chalk from "chalk";
import { findSession } from "./utils.js";

export async function resumeCommand(sessionIdArg: string) {
  try {
    const sessionId = await findSession(sessionIdArg);
    console.log(`gh copilot-cli --resume ${sessionId}`);
  } catch (err) {
    console.error(chalk.red("Error:"), err);
    process.exit(1);
  }
}
