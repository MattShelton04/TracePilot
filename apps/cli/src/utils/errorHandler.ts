/**
 * Centralized error handling for CLI commands.
 * Provides consistent error formatting and exit behavior across all commands.
 */

import chalk from "chalk";

/**
 * Format and display an error message, then exit with code 1.
 * Handles different error types: Error objects, strings, and unknown values.
 *
 * @param err - The error to display
 * @param context - Optional context label (e.g., "Failed to list sessions")
 */
export function handleCommandError(err: unknown, context?: string): never {
  const message = formatErrorMessage(err);
  const label = context ? `${context}:` : "Error:";
  console.error(chalk.red(label), message);
  process.exit(1);
}

/**
 * Display a validation error message and exit with code 1.
 * Used for user input validation failures.
 *
 * @param message - The validation error message to display
 */
export function handleValidationError(message: string): never {
  console.error(chalk.red(message));
  process.exit(1);
}

/**
 * Wrap a command function to automatically catch and handle errors.
 * Reduces boilerplate try-catch blocks in command implementations.
 *
 * @param fn - The async function to wrap
 * @param context - Optional context label for errors
 * @returns A promise that resolves to the function result or exits on error
 *
 * @example
 * ```typescript
 * export async function myCommand(args) {
 *   return wrapCommand(async () => {
 *     // command implementation
 *   }, "Failed to execute command");
 * }
 * ```
 */
export async function wrapCommand<T>(
  fn: () => Promise<T>,
  context?: string
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    handleCommandError(err, context);
  }
}

/**
 * Extract a user-friendly error message from various error types.
 *
 * @param err - The error to format
 * @returns A string representation of the error
 */
function formatErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  // For unknown types, attempt string conversion
  return String(err);
}
