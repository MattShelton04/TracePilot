import type { SessionListItem } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import {
  buildSearchFieldCache,
  filterAndSortSessions,
  PROJECT_FILTER_PREFIX,
  repositoryFilterOptions,
} from "../filtering";
import { folderKey } from "../repositoryFolders";

function s(
  id: string,
  cwd: string | null,
  repository: string | null = null,
  source: SessionListItem["source"] = repository ? "copilot" : "claudeCode",
): SessionListItem {
  return { id, cwd, repository, source, isRunning: false, turnCount: 1 } as SessionListItem;
}

/** Ids the session list shows with the repository filter set to `repository`. */
function pick(sessions: SessionListItem[], repository: string): string[] {
  const predicates = { searchTerms: [], repository, hideEmptySessions: false };
  return filterAndSortSessions(sessions, predicates, buildSearchFieldCache(sessions), "updated")
    .map((x) => x.id)
    .sort();
}

const values = (sessions: SessionListItem[], selected: string | null = null) =>
  repositoryFilterOptions(sessions, selected).map((o) => o.value);

describe("stores/sessions/repositoryFolders – folderKey", () => {
  it("ignores slash direction, trailing separators and case on Windows paths", () => {
    expect(folderKey("C:/synthetic/orchard")).toBe("c:/synthetic/orchard");
    expect(folderKey(" C:\\Synthetic\\Orchard\\ ")).toBe("c:/synthetic/orchard");
    expect(folderKey("\\\\?\\C:\\Synthetic\\Orchard")).toBe("c:/synthetic/orchard");
    expect(folderKey("\\\\Server\\Share\\Repo\\")).toBe("//server/share/repo");
  });

  it("keeps case on POSIX paths and the root itself", () => {
    expect(folderKey("/home/dev/Orchard//")).toBe("/home/dev/Orchard");
    expect(folderKey("/home/dev/orchard")).not.toBe(folderKey("/home/dev/Orchard"));
    expect(folderKey("/")).toBe("/");
    expect(folderKey("C:\\")).toBe("c:/");
    expect(folderKey("  ")).toBeNull();
    expect(folderKey(null)).toBeNull();
  });
});

describe("stores/sessions/filtering – folders that belong to a repository", () => {
  it("files a folder-only session under the repository named in its folder", () => {
    const sessions = [
      s("cop-1", "C:/synthetic/orchard", "example/orchard"),
      s("cop-2", "C:/synthetic/orchard", "example/orchard"),
      s("cc-1", "C:\\synthetic\\orchard"),
    ];
    expect(values(sessions)).toEqual(["example/orchard"]);
    expect(pick(sessions, "example/orchard")).toEqual(["cc-1", "cop-1", "cop-2"]);
  });

  it("merges every clone folder of one repository under it", () => {
    const sessions = [
      s("cop-a", "C:\\git\\TracePilot", "owner/TracePilot"),
      s("cop-b", "c:\\git\\RepoClones\\TracePilot\\", "owner/TracePilot"),
      s("cc-a", "c:/git/tracepilot"),
      s("cc-b", "C:/git/RepoClones/TracePilot"),
    ];
    expect(values(sessions)).toEqual(["owner/TracePilot"]);
    expect(pick(sessions, "owner/TracePilot")).toEqual(["cc-a", "cc-b", "cop-a", "cop-b"]);
  });

  it("keeps a clone folder no repository-bearing session ran in as a folder", () => {
    const sessions = [
      s("cop-a", "C:\\git\\TracePilot", "owner/TracePilot"),
      s("cc-a", "C:\\git\\TracePilot"),
      s("cc-b", "D:\\clones\\TracePilot"),
    ];
    const options = repositoryFilterOptions(sessions);
    expect(options.map((o) => o.value)).toEqual([
      "owner/TracePilot",
      `${PROJECT_FILTER_PREFIX}TracePilot`,
    ]);
    expect(options[1].title).toBe("D:\\clones\\TracePilot");
    expect(pick(sessions, "owner/TracePilot")).toEqual(["cc-a", "cop-a"]);
    expect(pick(sessions, `${PROJECT_FILTER_PREFIX}TracePilot`)).toEqual(["cc-a", "cc-b"]);
  });

  it("keeps a folder two different repositories ran in as a folder", () => {
    const sessions = [
      s("cop-old", "C:\\work\\app", "owner/app-old"),
      s("cop-new", "C:\\work\\app", "owner/app"),
      s("cc", "C:\\work\\app"),
    ];
    expect(values(sessions)).toEqual(["owner/app", "owner/app-old", `${PROJECT_FILTER_PREFIX}app`]);
    expect(pick(sessions, "owner/app")).toEqual(["cop-new"]);
    expect(pick(sessions, `${PROJECT_FILTER_PREFIX}app`)).toEqual(["cc"]);
  });

  it("does not guess a subfolder's repository from a parent folder", () => {
    // A subfolder can be its own clone (a dotfiles repository at home, say),
    // and list items carry no git root to tell the two apart.
    const sessions = [
      s("cop-home", "C:\\Users\\dev", "dev/dotfiles"),
      s("cc-project", "C:\\Users\\dev\\projects\\site"),
      s("cop-root", "/srv/app", "owner/app"),
      s("cc-sub", "/srv/app/packages/web"),
    ];
    expect(values(sessions)).toEqual([
      "dev/dotfiles",
      "owner/app",
      `${PROJECT_FILTER_PREFIX}site`,
      `${PROJECT_FILTER_PREFIX}web`,
    ]);
    expect(pick(sessions, "dev/dotfiles")).toEqual(["cop-home"]);
    expect(pick(sessions, "owner/app")).toEqual(["cop-root"]);
  });

  it("matches case-sensitively on POSIX paths", () => {
    const sessions = [s("cop", "/src/Orchard", "example/orchard"), s("cc", "/src/orchard")];
    expect(values(sessions)).toEqual(["example/orchard", `${PROJECT_FILTER_PREFIX}orchard`]);
    expect(pick(sessions, "example/orchard")).toEqual(["cop"]);
  });

  it("still matches a folder picked before it was filed under a repository", () => {
    const sessions = [s("cop", "C:\\x\\orchard", "example/orchard"), s("cc", "C:\\x\\orchard")];
    const selected = `${PROJECT_FILTER_PREFIX}orchard`;
    expect(values(sessions, selected)).toEqual(["example/orchard", selected]);
    expect(pick(sessions, selected)).toEqual(["cc"]);
  });
});
