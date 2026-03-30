/**
 * Centralized error handling for CLI commands.
 * Provides consistent error formatting and exit behavior across all commands.
 */

import chalk from "chalk";

/**
 * Format and display an error message, then exit with code 1.
 * Handles different error types: Error objects, strings, and unknown values.
 * Preserves stack traces and cause chains for diagnostics.
 *
 * @param err - The error to display
 * @param context - Optional context label (e.g., "Failed to list sessions")
 */
export function handleCommandError(err: unknown, context?: string): never {
  const label = context ? `${context}:` : "Error:";

  if (err instanceof Error) {
    // Print the main message in red, then the full error (with stack) for diagnostics
    console.error(chalk.red(label), err.message);
    if (err.stack) {
      console.error(chalk.dim(err.stack));
    }
    if (err.cause) {
      console.error(chalk.dim("Caused by:"), err.cause);
    }
  } else if (typeof err === "string") {
    console.error(chalk.red(label), err);
  } else {
    // For unknown types, log the raw value to preserve structure
    console.error(chalk.red(label), err);
  }

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

