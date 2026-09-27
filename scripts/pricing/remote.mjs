import { extractFootnotes, requireDate, SOURCE_PATHS, sha256 } from "./source.mjs";

export async function fetchUpstream({
  revision,
  verifiedAt = new Date().toISOString().slice(0, 10),
  fetchImpl = fetch,
  token = process.env.GITHUB_TOKEN,
} = {}) {
  requireDate(verifiedAt);
  if (!revision) {
    const response = await fetchImpl("https://api.github.com/repos/github/docs/commits/main", {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Cannot resolve github/docs main (HTTP ${response.status})`);
    revision = (await response.json()).sha;
  }
  if (!/^[a-f0-9]{40}$/.test(revision ?? ""))
    throw new Error("Expected a full github/docs commit SHA");
  // Resolve main once: every source file must come from the very same commit.
  const sources = Object.fromEntries(
    await Promise.all(
      Object.entries(SOURCE_PATHS).map(async ([key, path]) => {
        const response = await fetchImpl(
          `https://raw.githubusercontent.com/github/docs/${revision}/${path}`,
          {
            signal: AbortSignal.timeout(30_000),
          },
        );
        if (!response.ok) throw new Error(`Download failed (${response.status}): ${path}`);
        return [key, (await response.text()).replaceAll("\r\n", "\n")];
      }),
    ),
  );
  return {
    sources,
    snapshot: {
      revision,
      verifiedAt,
      sha256: Object.fromEntries(Object.entries(sources).map(([key, text]) => [key, sha256(text)])),
      footnotes: extractFootnotes(sources.page),
    },
  };
}
