import { describe, expect, it } from "vitest";
import {
  CONFIG_VERSION,
  createDefaultConfig,
  DEFAULT_AUTO_REFRESH_INTERVAL_SECONDS,
  DEFAULT_CLI_COMMAND,
  DEFAULT_CONTENT_MAX_WIDTH,
  DEFAULT_COST_PER_PREMIUM_REQUEST,
  DEFAULT_UI_SCALE,
} from "../src/defaults.js";
import { DEFAULT_FAVOURITE_MODELS } from "../src/models.js";

describe("createDefaultConfig", () => {
  const expectedDefaults = {
    version: CONFIG_VERSION,
    paths: {
      sessionStateDir: "",
      indexDbPath: "",
    },
    general: {
      autoIndexOnLaunch: true,
      cliCommand: DEFAULT_CLI_COMMAND,
      setupComplete: false,
    },
    ui: {
      theme: "dark",
      hideEmptySessions: true,
      autoRefreshEnabled: false,
      autoRefreshIntervalSeconds: DEFAULT_AUTO_REFRESH_INTERVAL_SECONDS,
      checkForUpdates: true,
      favouriteModels: [...DEFAULT_FAVOURITE_MODELS],
      recentRepoPaths: [],
      contentMaxWidth: DEFAULT_CONTENT_MAX_WIDTH,
      uiScale: DEFAULT_UI_SCALE,
    },
    pricing: {
      costPerPremiumRequest: DEFAULT_COST_PER_PREMIUM_REQUEST,
      models: [],
    },
    toolRendering: {
      enabled: true,
      toolOverrides: {},
    },
    features: {
      exportView: true,
      healthScoring: false,
      sessionReplay: false,
      renderMarkdown: true,
      mcpServers: false,
      skills: false,
    },
    logging: {
      level: "info",
    },
  };

  it("should return identical defaults for no args and empty object", () => {
    expect(createDefaultConfig()).toEqual(expectedDefaults);
    expect(createDefaultConfig({})).toEqual(expectedDefaults);
  });

  it("should return a new object each call (mutation isolation)", () => {
    const a = createDefaultConfig();
    const b = createDefaultConfig();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);

    a.ui.theme = "light";
    expect(b.ui.theme).toBe("dark");
  });

  it("should handle partial section overrides without overwriting other defaults in the same section", () => {
    const config = createDefaultConfig({
      paths: { sessionStateDir: "/custom/path" },
      general: { autoIndexOnLaunch: false },
      ui: { theme: "light" },
      features: { skills: true },
    });

    // Check overridden values
    expect(config.paths.sessionStateDir).toBe("/custom/path");
    expect(config.general.autoIndexOnLaunch).toBe(false);
    expect(config.ui.theme).toBe("light");
    expect(config.features.skills).toBe(true);

    // Check that other values in overridden sections remain at default
    expect(config.paths.indexDbPath).toBe("");
    expect(config.general.cliCommand).toBe(DEFAULT_CLI_COMMAND);
    expect(config.ui.hideEmptySessions).toBe(true);
    expect(config.features.exportView).toBe(true);

    // Check that non-overridden sections remain at default
    expect(config.pricing.costPerPremiumRequest).toBe(DEFAULT_COST_PER_PREMIUM_REQUEST);
    expect(config.logging.level).toBe("info");
  });

  it("should correctly override arrays", () => {
    const customModels = ["claude-3-opus", "gpt-4-turbo"];
    const customPricingModels = [
      {
        model: "custom-model",
        inputPerM: 10,
        cachedInputPerM: 5,
        outputPerM: 20,
        premiumRequests: 1,
      },
    ];

    const config = createDefaultConfig({
      ui: { favouriteModels: customModels },
      pricing: { models: customPricingModels },
    });

    expect(config.ui.favouriteModels).toEqual(customModels);
    expect(config.pricing.models).toEqual(customPricingModels);

    // Check that other array remains untouched
    expect(config.ui.recentRepoPaths).toEqual([]);
  });

  it("should override primitive fields successfully", () => {
    const config = createDefaultConfig({
      pricing: { costPerPremiumRequest: 0.1 },
      logging: { level: "debug" },
    });

    expect(config.pricing.costPerPremiumRequest).toBe(0.1);
    expect(config.logging.level).toBe("debug");

    // Check that nested values not specified remain intact
    expect(config.pricing.models).toEqual([]);
  });
});
