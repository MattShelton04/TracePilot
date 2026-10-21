/**
 * Pull request URLs and `owner/repo#n` keys, for finding sessions by the pull
 * requests they are linked to. Pure string work: nothing here fetches.
 */

export interface PullRequestUrlParts {
  /** Lower-cased. */
  host: string;
  owner: string;
  repo: string;
  number: number;
}

/** A hostname of dot-separated labels, at least two of them; no port or userinfo. */
const HOST = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+";
const OWNER = "[a-z0-9-]{1,39}";
const REPO = "[a-z0-9._-]{1,100}";
/** 1 to 999999999, without leading zeros. */
const NUMBER = "[1-9][0-9]{0,8}";
const SHA = "[0-9a-f]{7,40}";
/** A pull request's tabs, one of its commits, or the files of a commit range. */
const SUBPAGE = `(?:/(?:files|commits|checks|changes)|/commits/${SHA}|/files/${SHA}(?:\\.\\.${SHA})?)`;

const PULL_REQUEST_URL = new RegExp(
  `^https?://(${HOST})/(${OWNER})/(${REPO})/pull/(${NUMBER})${SUBPAGE}?/?(?:[?#]\\S*)?$`,
  "i",
);

/** `#57` or `owner/repo#57`, lower-cased, as `pullRequestSearchKeys` writes them. */
const PULL_REQUEST_KEY = new RegExp(`^(?:${OWNER}/${REPO})?#${NUMBER}$`);

/**
 * The parts of a GitHub (or GitHub Enterprise) pull request URL such as
 * `https://github.com/o/r/pull/123`, optionally followed by `/files`,
 * `/commits`, `/checks`, `/changes`, `/commits/<sha>` or
 * `/files/<sha>..<sha>`, a trailing slash, a query or a fragment.
 * Surrounding whitespace is ignored; anything else, including other words, a
 * port, userinfo, `/pull/new/…` or a non-http scheme, gives null.
 */
export function parsePullRequestUrl(text: string): PullRequestUrlParts | null {
  const match = PULL_REQUEST_URL.exec(text.trim());
  if (!match) return null;
  const [, host, owner, repo, number] = match;
  if (repo === "." || repo === "..") return null;
  return { host: host.toLowerCase(), owner, repo, number: Number(number) };
}

/** `owner/repo#123` for a pull request URL (see `parsePullRequestUrl`), else null. */
export function pullRequestKeyFromUrl(text: string): string | null {
  const pr = parsePullRequestUrl(text);
  return pr ? `${pr.owner}/${pr.repo}#${pr.number}` : null;
}

/**
 * Whether a lower-cased search term names one pull request exactly (`#57`,
 * `owner/repo#57`), so it is matched against whole keys rather than as a
 * substring: `#57` must not find #570.
 */
export function isPullRequestSearchKey(term: string): boolean {
  return term.includes("#") && PULL_REQUEST_KEY.test(term);
}

/**
 * Whether `text` contains a pull-request-shaped `term` that no digit follows,
 * so `#57` finds "see #57" but not "see #570". Allocates nothing.
 */
export function includesPullRequestKey(text: string, term: string): boolean {
  for (let i = text.indexOf(term); i !== -1; i = text.indexOf(term, i + 1)) {
    const next = text.charCodeAt(i + term.length);
    if (!(next >= 48 && next <= 57)) return true;
  }
  return false;
}

/** The exact keys `isPullRequestSearchKey` terms are matched against, lower-cased. */
export function pullRequestSearchKeys(pr: { owner: string; repo: string; number: number }) {
  return [`#${pr.number}`, `${pr.owner}/${pr.repo}#${pr.number}`.toLowerCase()];
}

export interface TextEdit {
  value: string;
  /** What replaces the selection: the key, spaced from the text around it. */
  inserted: string;
  /** Where the caret goes after the edit: just after the key. */
  caret: number;
}

/**
 * The input value after pasting `pasted` over the selection, when the pasted
 * text is exactly one pull request URL: its `owner/repo#123` key goes in
 * instead, with a space on either side where it would touch other text.
 * Null for any other paste, which the input handles as usual.
 */
export function pullRequestPasteEdit(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  pasted: string,
): TextEdit | null {
  const key = pullRequestKeyFromUrl(pasted);
  if (!key) return null;
  const before = value.slice(0, selectionStart);
  const after = value.slice(selectionEnd);
  const lead = before && !/\s$/.test(before) ? " " : "";
  const trail = after && !/^\s/.test(after) ? " " : "";
  const inserted = `${lead}${key}${trail}`;
  return {
    value: `${before}${inserted}${after}`,
    inserted,
    caret: before.length + lead.length + key.length,
  };
}

/**
 * Paste handler for a text input: a pasted pull request URL goes in as its
 * `owner/repo#123` key (see `pullRequestPasteEdit`); any other paste is left
 * to the browser. The key is typed with `insertText`, so the input fires its
 * own input event (a `v-model` follows it) and undo keeps working. Where that
 * command is missing or does nothing, the value is set and an input event
 * dispatched instead. Returns whether it handled the paste.
 */
export function handlePullRequestPaste(event: ClipboardEvent): boolean {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return false;
  const pasted = event.clipboardData?.getData("text/plain") ?? "";
  const edit = pullRequestPasteEdit(
    input.value,
    input.selectionStart ?? input.value.length,
    input.selectionEnd ?? input.value.length,
    pasted,
  );
  if (!edit) return false;
  event.preventDefault();
  const typed =
    typeof document.execCommand === "function" &&
    document.activeElement === input &&
    document.execCommand("insertText", false, edit.inserted) &&
    input.value === edit.value;
  if (!typed) {
    input.value = edit.value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  input.setSelectionRange(edit.caret, edit.caret);
  return true;
}
