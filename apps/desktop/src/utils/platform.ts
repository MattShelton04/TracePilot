/** Whether the app is running on macOS, for platform-specific guidance. */
export function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
}
