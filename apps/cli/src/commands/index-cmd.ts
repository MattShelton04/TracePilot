/** The desktop Rust indexer is not exposed by this standalone CLI. */

import { handleValidationError } from "../utils/errorHandler.js";

export async function indexCommand(_options: { full?: boolean }): Promise<never> {
  handleValidationError(
    "The index command is unavailable in the standalone CLI. Open TracePilot desktop to rebuild its index.",
  );
}
