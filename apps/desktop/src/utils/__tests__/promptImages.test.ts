import { describe, expect, it } from "vitest";
import { promptImageRefs } from "../promptImages";

describe("promptImageRefs", () => {
  it("keeps Claude Code pasted images that say where their block is", () => {
    const refs = promptImageRefs([
      { type: "image", mediaType: "image/png", line: 7, pointer: "/attachment/prompt/0" },
      { type: "image", mediaType: "image/png" },
      { type: "image", mediaType: "image/jpeg", line: 7, pointer: "/attachment/prompt/2" },
    ]);
    expect(refs).toEqual([
      { index: 0, label: "Pasted image 1" },
      { index: 2, label: "Pasted image 2" },
    ]);
  });

  it("keeps Copilot CLI image files and skips other attachments", () => {
    const refs = promptImageRefs([
      { type: "selection", filePath: "a.ts", text: "x" },
      {
        type: "file",
        path: "C:Tempcopilot-image-c004fe.png",
        displayName: "copilot-image-c004fe.png",
        mimeType: "image/png",
      },
      { type: "file", path: "C:work\notes.md", displayName: "notes.md" },
      { type: "file", path: "/home/me/shot.JPG" },
      { type: "file", path: "C:workdata.bin", mimeType: "application/octet-stream" },
    ]);
    expect(refs).toEqual([
      { index: 1, label: "copilot-image-c004fe.png" },
      { index: 3, label: "shot.JPG" },
    ]);
  });
});
