// Both revisions use this same common-user baseline, independent of the target's
// evolving defaults. Experimental views opt in individually in the case manifest.
export const defaultFeatures = Object.freeze({
  exportView: false,
  sessionReplay: false,
  renderMarkdown: true,
  mcpServers: false,
  skills: true,
  copilotSdk: false,
  exactContextCapture: false,
  configInjector: false,
});

export function configureVisualFeatures(config, enabled = []) {
  config.features = { ...defaultFeatures };
  for (const flag of enabled) {
    if (!Object.hasOwn(defaultFeatures, flag)) throw new Error(`Unknown visual feature: ${flag}`);
    config.features[flag] = true;
  }
  config.alerts = {
    ...config.alerts,
    enabled: false,
    nativeNotifications: false,
    soundEnabled: false,
    taskbarFlash: false,
  };
  return config;
}
