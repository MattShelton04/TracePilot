import { SOURCE_PATHS } from "./source.mjs";

const key = (row) => `${row.model}:${row.minimumInputTokens ?? 0}`;
const terms = (row) =>
  JSON.stringify([
    row.minimumInputTokens ?? 0,
    row.inputPerM,
    row.cachedInputPerM,
    row.cacheWritePerM,
    row.outputPerM,
    row.premiumRequests,
    row.effectiveTo,
  ]);

function refreshRows(previous, incoming, history, source, date) {
  const result = [];
  const models = [...new Set([...previous, ...incoming].map((row) => row.model))];
  for (const model of models) {
    const oldRows = previous.filter((row) => row.model === model);
    const newRows = incoming.filter((row) => row.model === model);
    if (!newRows.length) {
      result.push(
        ...oldRows.map((row) => ({
          ...row,
          verifiedAt: row.verifiedAt ?? source.verifiedAt,
          sourceNote: row.sourceNote?.includes("absent from")
            ? row.sourceNote
            : [
                row.sourceNote,
                `Retained ${row.verifiedAt ?? source.verifiedAt} snapshot; absent from the ${date} Copilot table`,
              ]
                .filter(Boolean)
                .join("; "),
        })),
      );
      continue;
    }
    const changed =
      oldRows.length !== newRows.length ||
      newRows.some(
        (row) => terms(row) !== terms(oldRows.find((old) => key(old) === key(row)) ?? {}),
      );
    // Version the whole model's tier set together, including removed tiers.
    if (changed) {
      for (const old of oldRows) {
        if (date <= (old.effectiveFrom ?? source.effectiveFrom ?? "")) {
          throw new Error(`Cannot rewrite ${model} history at/before its existing effective date`);
        }
        history.push({
          ...old,
          effectiveFrom: old.effectiveFrom ?? source.effectiveFrom,
          verifiedAt: old.verifiedAt ?? source.verifiedAt,
          effectiveTo: old.effectiveTo && old.effectiveTo < date ? old.effectiveTo : date,
        });
      }
    }
    for (const row of newRows) {
      const old = oldRows.find((entry) => key(entry) === key(row));
      const next = { ...old, ...row };
      delete next.verifiedAt;
      delete next.sourceNote;
      delete next.effectiveTo;
      if (row.sourceNote) next.sourceNote = row.sourceNote;
      if (row.effectiveTo) next.effectiveTo = row.effectiveTo;
      if (changed || !old) next.effectiveFrom = date;
      result.push(next);
    }
  }
  return result;
}

export function updatePricing(data, models, parsed, snapshot) {
  const next = structuredClone(data);
  const registry = structuredClone(models);
  const date = snapshot.verifiedAt;
  for (const source of [data.sources.githubCopilotUsage, data.sources.annualLegacyMultipliers]) {
    if (date < source.verifiedAt) throw new Error("Snapshot date must not go backwards");
  }
  next.githubCopilotUsageHistory ??= [];
  next.annualLegacyMultiplierHistory ??= [];
  next.githubCopilotUsage = refreshRows(
    data.githubCopilotUsage,
    parsed.usage,
    next.githubCopilotUsageHistory,
    data.sources.githubCopilotUsage,
    date,
  );
  next.annualLegacyMultipliers = refreshRows(
    data.annualLegacyMultipliers,
    parsed.annual,
    next.annualLegacyMultiplierHistory,
    data.sources.annualLegacyMultipliers,
    date,
  );
  for (const [name, sourceKey] of [
    ["githubCopilotUsage", "usage"],
    ["annualLegacyMultipliers", "annual"],
  ]) {
    Object.assign(next.sources[name], {
      verifiedAt: date,
      revision: snapshot.revision,
      dataUrl: `https://raw.githubusercontent.com/github/docs/${snapshot.revision}/${SOURCE_PATHS[sourceKey]}`,
      sha256: snapshot.sha256[sourceKey],
    });
  }
  for (const model of registry) {
    const row = next.githubCopilotUsage.find(
      (entry) => entry.model === model.id && !entry.minimumInputTokens,
    );
    if (row) {
      for (const field of ["inputPerM", "cachedInputPerM", "outputPerM"]) model[field] = row[field];
    }
    const multiplier =
      next.currentPremiumRequestDefaults.find((entry) => entry.model === model.id) ??
      next.annualLegacyMultipliers.find((entry) => entry.model === model.id);
    if (multiplier?.currentPremiumRequests == null) {
      throw new Error(`Register an explicit local compatibility multiplier for ${model.id}`);
    }
    model.premiumRequests = multiplier.currentPremiumRequests;
  }
  next.version = `github-copilot-usage-${date}`;
  return { data: next, models: registry };
}
