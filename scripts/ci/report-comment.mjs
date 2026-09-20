/** Append one comment per run attempt, preserving earlier revision discussions. */
export async function postReportComment({ api, pr, run, body, marker }) {
  const isCurrent = async () => {
    const current = await api(`/pulls/${pr}`);
    return current.state === "open" && current.head.sha === run.head_sha;
  };
  if (!(await isCurrent())) return "stale-head";
  for (let page = 1; ; page++) {
    const comments = await api(`/issues/${pr}/comments?per_page=100&page=${page}`);
    if (
      comments.some(
        (comment) =>
          comment.user?.login === "github-actions[bot]" && comment.body?.includes(marker),
      )
    )
      return "already-posted";
    if (comments.length < 100) break;
  }
  if (!(await isCurrent())) return "stale-head";
  const currentRun = await api(`/actions/runs/${run.id}`);
  if ((currentRun.run_attempt ?? 1) !== (run.run_attempt ?? 1)) return "stale-attempt";
  await api(`/issues/${pr}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
    headers: { "Content-Type": "application/json" },
  });
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
