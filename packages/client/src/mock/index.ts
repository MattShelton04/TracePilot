// `@tracepilot/client/mock`: fixtures shared with tests outside this package.
// Mock command answers import their data directly (see `routes/`), so a new
// fixture needs a line here only when another package's tests use it.
export {
  agentCatalog,
  agentDefinition,
  agentFields,
  agentSettings,
  agentUsage,
} from "./agentFixtures.js";
