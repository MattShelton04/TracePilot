export interface SchemaType {
  kind:
    | "string"
    | "number"
    | "boolean"
    | "object"
    | "array"
    | "null"
    | "union"
    | "enum"
    | "const"
    | "unknown";
  enumValues?: string[];
  constValue?: unknown;
  items?: SchemaType;
  properties?: PropertyInfo[];
  raw?: unknown;
}

export interface PropertyInfo {
  name: string;
  type: SchemaType;
  required: boolean;
  description?: string;
}

export interface EventTypeInfo {
  name: string;
  properties: PropertyInfo[];
  requiredFields: string[];
  description?: string;
  ephemeral: "always" | "optional" | "never";
}

export interface RpcMethodInfo {
  name: string;
  params: PropertyInfo[];
  result: PropertyInfo[];
  isExperimental: boolean;
  description?: string;
}

export interface AgentInfo {
  name: string;
  displayName?: string;
  model: string;
  toolCount: number;
  description: string;
}

export interface CopilotVersion {
  version: string;
  gitCommit?: string;
  path: string;
  eventTypes: EventTypeInfo[];
  rpcMethods: RpcMethodInfo[];
  agents: AgentInfo[];
}

export interface VersionDiff {
  from: string;
  to: string;
  addedEvents: string[];
  removedEvents: string[];
  modifiedEvents: EventModification[];
  addedRpcMethods: string[];
  removedRpcMethods: string[];
  modifiedRpcMethods: RpcModification[];
  addedAgents: string[];
  removedAgents: string[];
}

export interface EventModification {
  eventType: string;
  addedProperties: string[];
  removedProperties: string[];
  changes: string[];
}

export interface RpcModification {
  method: string;
  changes: string[];
}

export interface EventObservation {
  eventType: string;
  inSchema: boolean;
  ephemeral: "always" | "optional" | "never";
  handledByTracePilot: boolean;
  observedLocally: boolean;
  exampleSessions: SessionExample[];
  category: string;
  recommendation: string;
}

export interface SessionExample {
  sessionId: string;
  copilotVersion: string;
  timestamp?: string;
  summary?: string;
}

export interface CoverageReport {
  schemaVersion: string;
  totalSchemaEvents: number;
  alwaysEphemeralCount: number;
  persistedEventCount: number;
  handledCount: number;
  unhandledPersistedCount: number;
  coveragePercentage: number;
  observations: EventObservation[];
}

export interface SessionVersionInfo {
  sessionId: string;
  copilotVersion: string;
  eventTypesObserved: Set<string>;
  createdAt?: string;
  summary?: string;
}
