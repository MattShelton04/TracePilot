export const DEFAULT_VIEWPORTS = [
  { label: "1440x1000", width: 1440, height: 1000 },
  { label: "1280x900", width: 1280, height: 900 },
  { label: "1920x1080", width: 1920, height: 1080 },
];

export const DEFAULT_FINAL_VIEWPORT = "1440x1000";

export function parseArgs(rawArgs) {
  const parsed = { viewport: [] };
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === "--port") parsed.port = rawArgs[++i];
    else if (arg === "--out-dir") parsed.outDir = rawArgs[++i];
    else if (arg === "--docs-images-dir") parsed.docsImagesDir = rawArgs[++i];
    else if (arg === "--final-viewport") parsed.finalViewport = rawArgs[++i];
    else if (arg === "--viewport") parsed.viewport.push(rawArgs[++i]);
    else if (arg === "--list-candidates") parsed.listCandidates = true;
    else if (arg === "--candidate-limit") parsed.candidateLimit = rawArgs[++i];
    else if (arg === "--overview-session") parsed.overviewSession = rawArgs[++i];
    else if (arg === "--conversation-session") parsed.conversationSession = rawArgs[++i];
    else if (arg === "--conversation-turn") parsed.conversationTurn = rawArgs[++i];
    else if (arg === "--timeline-session") parsed.timelineSession = rawArgs[++i];
    else if (arg === "--timeline-turn") parsed.timelineTurn = rawArgs[++i];
    else if (arg === "--todos-session") parsed.todosSession = rawArgs[++i];
    else if (arg === "--explorer-session") parsed.explorerSession = rawArgs[++i];
    else if (arg === "--metrics-session") parsed.metricsSession = rawArgs[++i];
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

export function parseViewports(rawViewports) {
  return rawViewports.map((value) => {
    const match = /^(\d+)x(\d+)$/i.exec(value);
    if (!match) throw new Error(`Invalid viewport "${value}". Expected WIDTHxHEIGHT.`);
    return {
      label: `${match[1]}x${match[2]}`,
      width: Number(match[1]),
      height: Number(match[2]),
    };
  });
}

function printHelp() {
  console.log(`Capture TracePilot README media.

Usage:
  node scripts\\e2e\\capture-readme-media.mjs [options]

Options:
  --port <port>                  CDP port, usually auto-discovered
  --out-dir <path>               Candidate screenshot directory
  --docs-images-dir <path>       Final docs image directory
  --viewport <WxH>               Add a viewport, can be repeated
  --final-viewport <WxH>         Viewport copied into docs/images
  --list-candidates              Score sessions and print screenshot candidates
  --candidate-limit <n>          Candidate rows to print, default 12
  --overview-session <id>        Session ID for overview screenshot
  --conversation-session <id>    Session ID for conversation screenshot
  --conversation-turn <n>        Turn to scroll to for conversation screenshot
  --timeline-session <id>        Session ID for timeline screenshot
  --timeline-turn <n>            Agent-tree turn to navigate to
  --todos-session <id>           Session ID for todos screenshot
  --explorer-session <id>        Session ID for explorer screenshot
  --metrics-session <id>         Session ID for metrics screenshot
  -h, --help                     Show this help
`);
}
