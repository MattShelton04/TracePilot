/**
 * Keep one report comment per PR and family, edited in place. Every run compares
 * the whole PR against its merge base, so the latest report supersedes earlier
 * ones; separate comments per push read as incremental reports.
 */
export async function postReportComment({ api, pr, run, body, marker, family }) {
  const isCurrent = async () => {
    const current = await api(`/pulls/${pr}`);
    return current.state === "open" && current.head.sha === run.head_sha;
  };
  if (!(await isCurrent())) return "stale-head";
  let existing;
  for (let page = 1; ; page++) {
    const comments = await api(`/issues/${pr}/comments?per_page=100&page=${page}`);
    for (const comment of comments) {
      if (comment.user?.login !== "github-actions[bot]") continue;
      if (comment.body?.includes(marker)) return "already-posted";
      // Newest family comment wins; older duplicates predate sticky reports.
      if (family && comment.body?.includes(family)) existing = comment;
    }
    if (comments.length < 100) break;
  }
  if (!(await isCurrent())) return "stale-head";
  const currentRun = await api(`/actions/runs/${run.id}`);
  if ((currentRun.run_attempt ?? 1) !== (run.run_attempt ?? 1)) return "stale-attempt";
  const request = {
    body: JSON.stringify({ body }),
    headers: { "Content-Type": "application/json" },
  };
  if (existing && Number.isSafeInteger(existing.id)) {
    await api(`/issues/comments/${existing.id}`, { method: "PATCH", ...request });
    return "updated";
  }
  await api(`/issues/${pr}/comments`, { method: "POST", ...request });
  return "created";
}

export function githubApi(repo, token) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("Invalid repository");
  return async (path, options = {}) => {
    const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      ...options,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...options.headers,
      },
    });
    if (!response.ok) throw new Error(`GitHub ${response.status} for ${path}`);
    return response.status === 204 ? null : response.json();
  };
}
