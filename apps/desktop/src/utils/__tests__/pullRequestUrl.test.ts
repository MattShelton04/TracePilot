import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import {
  handlePullRequestPaste,
  isPullRequestSearchKey,
  parsePullRequestUrl,
  pullRequestKeyFromUrl,
  pullRequestPasteEdit,
} from "../pullRequestUrl";

describe("parsePullRequestUrl", () => {
  it("reads a github.com pull request URL", () => {
    expect(parsePullRequestUrl("https://github.com/Example/orchard/pull/1046")).toEqual({
      host: "github.com",
      owner: "Example",
      repo: "orchard",
      number: 1046,
    });
  });

  it("accepts GitHub Enterprise hosts and http", () => {
    expect(parsePullRequestUrl("https://github.example.com/o/r/pull/7")?.host).toBe(
      "github.example.com",
    );
    expect(parsePullRequestUrl("https://acme.ghe.com/o/r/pull/7")?.host).toBe("acme.ghe.com");
    expect(parsePullRequestUrl("HTTP://GitHub.com/o/r/pull/7")?.host).toBe("github.com");
  });

  it.each([
    "https://github.com/o/r/pull/12/",
    "https://github.com/o/r/pull/12/files",
    "https://github.com/o/r/pull/12/commits/",
    "https://github.com/o/r/pull/12/checks",
    "https://github.com/o/r/pull/12/changes",
    "https://github.com/o/r/pull/12#issuecomment-1",
    "https://github.com/o/r/pull/12/files#diff-abc",
    "https://github.com/o/r/pull/12?w=1",
    "  https://github.com/o-dash/re_po-1.x/pull/12\n",
  ])("accepts %s", (url) => {
    expect(parsePullRequestUrl(url)?.number).toBe(12);
  });

  it.each([
    ["a new-pull-request page", "https://github.com/o/r/pull/new/feature"],
    ["an issue", "https://github.com/o/r/issues/1"],
    ["pull request 0", "https://github.com/o/r/pull/0"],
    ["a leading zero", "https://github.com/o/r/pull/012"],
    ["a non-number", "https://github.com/o/r/pull/abc"],
    ["a ten-digit number", "https://github.com/o/r/pull/1234567890"],
    ["a script URL", "javascript:alert(1)//github.com/o/r/pull/1"],
    ["another scheme", "ftp://github.com/o/r/pull/1"],
    ["no repository", "https://github.com/o/pull/1"],
    ["an extra segment", "https://github.com/o/r/pull/1/commits/abc123"],
    ["an unknown subpage", "https://github.com/o/r/pull/1/reviews"],
    ["a path before the owner", "https://github.com/x/o/r/pull/1"],
    ["other words", "see https://github.com/o/r/pull/1"],
    ["two URLs", "https://github.com/o/r/pull/1 https://github.com/o/r/pull/2"],
    ["userinfo", "https://user@github.com/o/r/pull/1"],
    ["a port", "https://github.com:8443/o/r/pull/1"],
    ["a single-label host", "https://localhost/o/r/pull/1"],
    ["an invalid owner", "https://github.com/o_o/r/pull/1"],
    ["a dot repository", "https://github.com/o/../pull/1"],
    ["empty text", ""],
  ])("rejects %s", (_, url) => {
    expect(parsePullRequestUrl(url)).toBeNull();
  });
});

describe("pullRequestKeyFromUrl", () => {
  it("writes owner/repo#n, keeping the URL's case", () => {
    expect(pullRequestKeyFromUrl("https://github.com/Example/Orchard/pull/57/files")).toBe(
      "Example/Orchard#57",
    );
    expect(pullRequestKeyFromUrl("orchard#57")).toBeNull();
  });
});

describe("isPullRequestSearchKey", () => {
  it("knows #n and owner/repo#n", () => {
    expect(isPullRequestSearchKey("#57")).toBe(true);
    expect(isPullRequestSearchKey("example/orchard#57")).toBe(true);
    expect(isPullRequestSearchKey("57")).toBe(false);
    expect(isPullRequestSearchKey("#057")).toBe(false);
    expect(isPullRequestSearchKey("example/orchard")).toBe(false);
    expect(isPullRequestSearchKey("fix#57")).toBe(false);
    expect(isPullRequestSearchKey("#57a")).toBe(false);
  });
});

describe("pullRequestPasteEdit", () => {
  const url = "https://github.com/o/r/pull/12";

  it("puts the key in an empty input", () => {
    expect(pullRequestPasteEdit("", 0, 0, url)).toEqual({ value: "o/r#12", caret: 6 });
  });

  it("replaces the selection and keeps the other text apart", () => {
    // "fix |bug| later" with "bug" selected.
    expect(pullRequestPasteEdit("fix bug later", 4, 7, url)).toEqual({
      value: "fix o/r#12 later",
      caret: 10,
    });
    // Pasted against text on both sides.
    expect(pullRequestPasteEdit("fixlater", 3, 3, url)).toEqual({
      value: "fix o/r#12 later",
      caret: 10,
    });
  });

  it("leaves any other paste alone", () => {
    expect(pullRequestPasteEdit("", 0, 0, "retry index")).toBeNull();
    expect(pullRequestPasteEdit("", 0, 0, "https://github.com/o/r/issues/1")).toBeNull();
  });
});

describe("handlePullRequestPaste", () => {
  function paste(input: HTMLInputElement, text: string) {
    const event = new Event("paste", { cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", {
      value: { getData: (type: string) => (type === "text/plain" ? text : "") },
    });
    Object.defineProperty(event, "target", { value: input });
    return event;
  }

  it("applies the key in place of a pasted URL and moves the caret after it", async () => {
    const input = document.createElement("input");
    input.value = "login ";
    input.setSelectionRange(6, 6);
    const apply = vi.fn((value: string) => {
      input.value = value;
    });
    const event = paste(input, "https://github.com/o/r/pull/12/files");

    expect(handlePullRequestPaste(event, apply)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(apply).toHaveBeenCalledWith("login o/r#12");
    await nextTick();
    expect(input.selectionStart).toBe(12);
  });

  it("lets the browser paste anything else", () => {
    const input = document.createElement("input");
    const apply = vi.fn();
    const event = paste(input, "login bug");
    expect(handlePullRequestPaste(event, apply)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });
});
