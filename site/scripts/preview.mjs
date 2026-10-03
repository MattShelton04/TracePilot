// Shared preview lifecycle for the browser checks and social-image generator.
import { spawn } from "node:child_process";
import { join } from "node:path";

export async function startPreview(root, port) {
  const proc = spawn(
    process.execPath,
    [
      join(root, "node_modules/vite/bin/vite.js"),
      "preview",
      "--port",
      String(port),
      "--strictPort",
    ],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  try {
    // Wait for this process to listen: an existing server on the port is an error.
    await new Promise((resolve, reject) => {
      let output = "";
      const timeout = setTimeout(
        () => reject(new Error("vite preview did not start; run pnpm site:build first")),
        20_000,
      );
      const cleanup = () => clearTimeout(timeout);
      proc.once("error", (error) => {
        cleanup();
        reject(error);
      });
      proc.once("exit", (code) => {
        cleanup();
        reject(new Error(`vite preview exited (${code}): ${output}`));
      });
      proc.stderr.on("data", (chunk) => {
        output += chunk;
      });
      proc.stdout.on("data", (chunk) => {
        output += chunk;
        if (/Local:.*http:/.test(output)) {
          cleanup();
          resolve();
        }
      });
    });
    const response = await fetch(`http://localhost:${port}/`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`vite preview returned HTTP ${response.status}`);
    return proc;
  } catch (error) {
    proc.kill();
    throw error;
  }
}
