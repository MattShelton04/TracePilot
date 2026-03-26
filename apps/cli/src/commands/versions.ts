/**
 * `tracepilot versions` — Analyze installed Copilot CLI versions and schema changes.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import chalk from 'chalk';
import {
  type CopilotVersion,
  computeCoverage,
  diffAllVersions,
  diffVersions,
  discoverInstalledVersions,
  findEventExamples,
  generateMarkdownReport,
  type SessionVersionInfo,
  scanSessionVersions,
} from '../lib/version-analyzer.js';

// ── Shared helpers ───────────────────────────────────────────────────

function ensureVersions(): CopilotVersion[] {
  const versions = discoverInstalledVersions();
  if (versions.length === 0) {
    console.error(
      chalk.red('No installed Copilot CLI versions found at ~/.copilot/pkg/universal/'),
    );
    process.exit(1);
  }
  return versions;
}

function findVersion(versions: CopilotVersion[], query: string): CopilotVersion | undefined {
  // Exact match first, then prefix match (only if unambiguous)
  const exact = versions.find((v) => v.version === query);
  if (exact) return exact;
  const prefixMatches = versions.filter((v) => v.version.startsWith(query));
  return prefixMatches.length === 1 ? prefixMatches[0] : undefined;
}

// ── tracepilot versions list ─────────────────────────────────────────

export async function versionsListCommand(opts: { json?: boolean }) {
  const versions = ensureVersions();

  if (opts.json) {
    const data = versions.map((v) => ({
      version: v.version,
      eventTypes: v.eventTypes.length,
      rpcMethods: v.rpcMethods.length,
      agents: v.agents.length,
      agentNames: v.agents.map((a) => a.name),
      path: v.path,
    }));
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(chalk.bold('\n  Installed Copilot CLI Versions\n'));

  // Header
  const header = `  ${'Version'.padEnd(12)} ${'Events'.padStart(8)} ${'Methods'.padStart(9)} ${'Agents'.padStart(8)}  Agent Names`;
  console.log(chalk.dim(header));
  console.log(chalk.dim('  ' + '─'.repeat(80)));

  for (const v of versions) {
    const agentNames = v.agents.map((a) => a.name).join(', ') || chalk.dim('—');
    console.log(
      `  ${chalk.cyan(v.version.padEnd(12))} ${String(v.eventTypes.length).padStart(8)} ${String(v.rpcMethods.length).padStart(9)} ${String(v.agents.length).padStart(8)}  ${agentNames}`,
    );
  }
  console.log();
}

// ── tracepilot versions diff ─────────────────────────────────────────

export async function versionsDiffCommand(v1?: string, v2?: string, opts?: { json?: boolean }) {
  const versions = ensureVersions();

  if (v1 && v2) {
    const ver1 = findVersion(versions, v1);
    const ver2 = findVersion(versions, v2);
    if (!ver1) {
      console.error(
        chalk.red(
          `Version "${v1}" not found. Available: ${versions.map((v) => v.version).join(', ')}`,
        ),
      );
      process.exit(1);
    }
    if (!ver2) {
      console.error(
        chalk.red(
          `Version "${v2}" not found. Available: ${versions.map((v) => v.version).join(', ')}`,
        ),
      );
      process.exit(1);
    }

    const diff = diffVersions(ver1, ver2);
    if (opts?.json) {
      console.log(JSON.stringify(diff, null, 2));
    } else {
      printDiff(diff);
    }
  } else {
    const diffs = diffAllVersions(versions);
    if (opts?.json) {
      console.log(JSON.stringify(diffs, null, 2));
    } else {
      for (const diff of diffs) {
        printDiff(diff);
      }
    }
  }
}

function countDiffChanges(diff: ReturnType<typeof diffVersions>): number {
  return (
    diff.addedEvents.length +
    diff.removedEvents.length +
    diff.modifiedEvents.length +
    diff.addedRpcMethods.length +
    diff.removedRpcMethods.length +
    diff.modifiedRpcMethods.length +
    diff.addedAgents.length +
    diff.removedAgents.length
  );
}

function printDiff(diff: ReturnType<typeof diffVersions>) {
  const totalChanges = countDiffChanges(diff);

  console.log(
    chalk.bold(`\n  ${diff.from} → ${diff.to}`) + chalk.dim(` (${totalChanges} changes)`),
  );
  console.log(chalk.dim('  ' + '─'.repeat(60)));

  if (totalChanges === 0) {
    console.log(chalk.dim('  No significant changes'));
    return;
  }

  if (diff.addedEvents.length > 0) {
    console.log(chalk.green(`  +${diff.addedEvents.length} event types:`));
    for (const e of diff.addedEvents) {
      console.log(chalk.green(`    + ${e}`));
    }
  }
  if (diff.removedEvents.length > 0) {
    console.log(chalk.red(`  -${diff.removedEvents.length} event types:`));
    for (const e of diff.removedEvents) {
      console.log(chalk.red(`    - ${e}`));
    }
  }
  if (diff.modifiedEvents.length > 0) {
    console.log(chalk.yellow(`  ~${diff.modifiedEvents.length} modified events:`));
    for (const m of diff.modifiedEvents) {
      console.log(chalk.yellow(`    ~ ${m.eventType}`));
      for (const p of m.addedProperties) console.log(chalk.green(`      + ${p}`));
      for (const p of m.removedProperties) console.log(chalk.red(`      - ${p}`));
      for (const c of m.changes) console.log(chalk.dim(`      ${c}`));
    }
  }
  if (diff.addedRpcMethods.length > 0) {
    console.log(chalk.green(`  +${diff.addedRpcMethods.length} RPC methods:`));
    for (const m of diff.addedRpcMethods) {
      console.log(chalk.green(`    + ${m}`));
    }
  }
  if (diff.removedRpcMethods.length > 0) {
    console.log(chalk.red(`  -${diff.removedRpcMethods.length} RPC methods:`));
    for (const m of diff.removedRpcMethods) {
      console.log(chalk.red(`    - ${m}`));
    }
  }
  if (diff.modifiedRpcMethods.length > 0) {
    console.log(chalk.yellow(`  ~${diff.modifiedRpcMethods.length} modified RPC methods:`));
    for (const m of diff.modifiedRpcMethods) {
      console.log(chalk.yellow(`    ~ ${m.method}: ${m.changes.join('; ')}`));
    }
  }
  if (diff.addedAgents.length > 0) {
    console.log(
      chalk.green(`  +${diff.addedAgents.length} agents: ${diff.addedAgents.join(', ')}`),
    );
  }
  console.log();
}

// ── tracepilot versions coverage ─────────────────────────────────────

export async function versionsCoverageCommand(opts: { json?: boolean }) {
  const versions = ensureVersions();
  const latest = versions[versions.length - 1];

  if (!opts.json) console.log(chalk.dim('  Scanning sessions for event examples...'));
  const sessionInfo = await scanSessionVersions();

  const coverage = computeCoverage(latest, sessionInfo);

  if (opts.json) {
    // Serialize with exampleSessions limited
    const serializable = {
      ...coverage,
      observations: coverage.observations.map((o) => ({
        ...o,
        exampleSessions: o.exampleSessions.map((e) => ({
          sessionId: e.sessionId,
          copilotVersion: e.copilotVersion,
        })),
      })),
    };
    console.log(JSON.stringify(serializable, null, 2));
    return;
  }

  console.log(
    chalk.bold(`\n  TracePilot Event Type Coverage (vs schema v${coverage.schemaVersion})\n`),
  );
  console.log(`  Total schema events:     ${coverage.totalSchemaEvents}`);
  console.log(
    `  Always ephemeral:        ${coverage.alwaysEphemeralCount} ${chalk.dim('(never on disk, no handling needed)')}`,
  );
  console.log(`  Persisted events:        ${coverage.persistedEventCount}`);
  console.log(`  ${chalk.green('Handled by TracePilot:')}  ${coverage.handledCount}`);
  console.log(`  ${chalk.red('Unhandled (persisted):')}  ${coverage.unhandledPersistedCount}`);
  console.log(`  Coverage:                ${chalk.bold(coverage.coveragePercentage + '%')}`);
  console.log();

  // Group by category
  const byCategory = new Map<string, typeof coverage.observations>();
  for (const obs of coverage.observations) {
    if (!byCategory.has(obs.category)) byCategory.set(obs.category, []);
    byCategory.get(obs.category)!.push(obs);
  }

  for (const [category, events] of byCategory) {
    console.log(chalk.bold(`  ${category}:`));
    for (const obs of events) {
      let icon: string;
      let color: typeof chalk.green;
      if (obs.handledByTracePilot) {
        icon = '✅';
        color = chalk.green;
      } else if (obs.ephemeral === 'always') {
        icon = '👻';
        color = chalk.dim;
      } else if (obs.observedLocally) {
        icon = '⚠️ ';
        color = chalk.yellow;
      } else {
        icon = '  ';
        color = chalk.dim;
      }
      const suffix = obs.observedLocally
        ? chalk.dim(` (seen in ${obs.exampleSessions.length} session(s))`)
        : '';
      console.log(`    ${icon} ${color(obs.eventType)}${suffix}`);
    }
    console.log();
  }
}

// ── tracepilot versions report ───────────────────────────────────────

export async function versionsReportCommand(opts: { output?: string }) {
  const versions = ensureVersions();

  console.error(chalk.dim('  Scanning sessions...'));
  const sessionInfo = await scanSessionVersions();

  console.error(chalk.dim('  Computing diffs...'));
  const diffs = diffAllVersions(versions);

  console.error(chalk.dim('  Computing coverage...'));
  const coverage = computeCoverage(versions[versions.length - 1], sessionInfo);

  const report = generateMarkdownReport(versions, diffs, coverage, sessionInfo);

  if (opts.output) {
    mkdirSync(dirname(opts.output), { recursive: true });
    writeFileSync(opts.output, report, 'utf-8');
    console.log(chalk.green(`\n  Report saved to ${opts.output}`));
    console.log(chalk.dim(`  ${report.split('\n').length} lines, ${report.length} bytes\n`));
  } else {
    console.log(report);
  }
}

// ── tracepilot versions examples ─────────────────────────────────────

export async function versionsExamplesCommand(opts: { eventType?: string; json?: boolean }) {
  if (opts.eventType) {
    if (!opts.json) console.log(chalk.dim(`  Searching for "${opts.eventType}" in sessions...`));
    const examples = await findEventExamples(opts.eventType);

    if (opts.json) {
      console.log(JSON.stringify(examples, null, 2));
      return;
    }

    if (examples.length === 0) {
      console.log(chalk.yellow(`\n  No sessions found containing "${opts.eventType}"`));
      console.log(
        chalk.dim('  This event may be ephemeral (never written to disk) or not yet triggered.\n'),
      );
      console.log(chalk.dim('  To generate this event, try:'));
      console.log(chalk.dim('    - Start a new Copilot CLI session with: copilot'));
      console.log(chalk.dim('    - Use features that might trigger this event type'));
      console.log(
        chalk.dim('    - Check if this is an ephemeral event (use `versions coverage`)\n'),
      );
      return;
    }

    console.log(
      chalk.bold(`\n  Sessions containing "${opts.eventType}" (${examples.length} found):\n`),
    );
    for (const ex of examples) {
      const summary = ex.summary ? chalk.dim(` — ${ex.summary.slice(0, 50)}`) : '';
      console.log(`  ${chalk.cyan(ex.sessionId.slice(0, 8))}… v${ex.copilotVersion}${summary}`);
    }
    console.log();
  } else {
    // Show all event types with observation status
    if (!opts.json) console.log(chalk.dim('  Scanning all sessions for event type examples...'));
    const sessionInfo = await scanSessionVersions();
    const versions = ensureVersions();
    const latest = versions[versions.length - 1];

    // Collect all observed types
    const observedTypes = new Map<string, number>();
    for (const session of sessionInfo) {
      for (const et of session.eventTypesObserved) {
        observedTypes.set(et, (observedTypes.get(et) ?? 0) + 1);
      }
    }

    // All types from schema
    const schemaTypes = new Set(latest.eventTypes.map((e) => e.name));
    // Types observed but not in schema (truly unknown)
    const unknownTypes = [...observedTypes.keys()].filter((t) => !schemaTypes.has(t));

    if (opts.json) {
      const data = {
        schemaEvents: latest.eventTypes.map((e) => ({
          name: e.name,
          ephemeral: e.ephemeral,
          observedCount: observedTypes.get(e.name) ?? 0,
        })),
        unknownObserved: unknownTypes.map((t) => ({
          name: t,
          count: observedTypes.get(t) ?? 0,
        })),
        sessionsScanned: sessionInfo.length,
      };
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    console.log(
      chalk.bold(`\n  Event Type Observations (${sessionInfo.length} sessions scanned)\n`),
    );

    // Show observed types sorted by frequency
    const sorted = [...observedTypes.entries()].sort((a, b) => b[1] - a[1]);

    console.log(chalk.bold('  Most common event types:'));
    for (const [type, count] of sorted.slice(0, 20)) {
      const inSchema = schemaTypes.has(type) ? '' : chalk.red(' [NOT IN SCHEMA]');
      console.log(`    ${String(count).padStart(6)} × ${chalk.cyan(type)}${inSchema}`);
    }
    console.log();

    // Show unobserved schema types
    const unobserved = latest.eventTypes
      .filter((e) => !observedTypes.has(e.name))
      .sort((a, b) => {
        if (a.ephemeral !== b.ephemeral) return a.ephemeral === 'always' ? 1 : -1;
        return a.name.localeCompare(b.name);
      });

    if (unobserved.length > 0) {
      console.log(chalk.bold('  Schema-defined but not observed locally:'));
      for (const e of unobserved) {
        const eph = e.ephemeral === 'always' ? chalk.dim(' 👻 ephemeral') : '';
        console.log(`    ${chalk.dim(e.name)}${eph}`);
      }
      console.log();
    }

    if (unknownTypes.length > 0) {
      console.log(chalk.yellow.bold('  Observed but not in latest schema:'));
      for (const t of unknownTypes) {
        console.log(`    ${chalk.yellow(t)} (${observedTypes.get(t)} sessions)`);
      }
      console.log();
    }
  }
}
