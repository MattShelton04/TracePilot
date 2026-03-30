import { describe, expect, it } from "vitest";
import { detectLanguage, languageDisplayName } from "../utils/languageDetection";

describe("detectLanguage", () => {
  it("detects TypeScript from .ts extension", () => {
    expect(detectLanguage("src/index.ts")).toBe("typescript");
  });

  it("detects TSX from .tsx extension", () => {
    expect(detectLanguage("App.tsx")).toBe("tsx");
  });

  it("detects JavaScript from .js extension", () => {
    expect(detectLanguage("utils.js")).toBe("javascript");
  });

  it("detects Rust from .rs extension", () => {
    expect(detectLanguage("main.rs")).toBe("rust");
  });

  it("detects Python from .py extension", () => {
    expect(detectLanguage("script.py")).toBe("python");
  });

  it("detects Vue from .vue extension", () => {
    expect(detectLanguage("Component.vue")).toBe("vue");
  });

  it("detects Go from .go extension", () => {
    expect(detectLanguage("main.go")).toBe("go");
  });

  it("detects YAML from .yaml extension", () => {
    expect(detectLanguage("config.yaml")).toBe("yaml");
  });

  it("detects YAML from .yml extension", () => {
    expect(detectLanguage("ci.yml")).toBe("yaml");
  });

  it("detects TOML from .toml extension", () => {
    expect(detectLanguage("Cargo.toml")).toBe("toml");
  });

  it("detects JSON from .json extension", () => {
    expect(detectLanguage("package.json")).toBe("json");
  });

  it("detects SQL from .sql extension", () => {
    expect(detectLanguage("query.sql")).toBe("sql");
  });

  it("detects Bash from .sh extension", () => {
    expect(detectLanguage("build.sh")).toBe("bash");
  });

  it("detects PowerShell from .ps1 extension", () => {
    expect(detectLanguage("script.ps1")).toBe("powershell");
  });

  it("detects CSS from .css extension", () => {
    expect(detectLanguage("styles.css")).toBe("css");
  });

  it("detects HTML from .html extension", () => {
    expect(detectLanguage("index.html")).toBe("html");
  });

  it("detects Markdown from .md extension", () => {
    expect(detectLanguage("README.md")).toBe("markdown");
  });

  it("detects Dockerfile by filename", () => {
    expect(detectLanguage("Dockerfile")).toBe("dockerfile");
  });

  it("detects Makefile by filename", () => {
    expect(detectLanguage("Makefile")).toBe("makefile");
  });

  it("handles Windows-style paths", () => {
    expect(detectLanguage("C:\\src\\main.rs")).toBe("rust");
  });

  it("handles deeply nested paths", () => {
    expect(detectLanguage("packages/ui/src/components/renderers/CodeBlock.vue")).toBe("vue");
  });

  it("returns 'text' for unknown extensions", () => {
    expect(detectLanguage("file.xyz")).toBe("text");
  });

  it("returns 'text' for empty string", () => {
    expect(detectLanguage("")).toBe("text");
  });

  it("returns 'text' for extensionless non-known filenames", () => {
    expect(detectLanguage("README")).toBe("text");
  });

  it("detects Scala from .scala extension", () => {
    expect(detectLanguage("Main.scala")).toBe("scala");
  });

  it("detects Scala from .sc extension", () => {
    expect(detectLanguage("script.sc")).toBe("scala");
  });
});

describe("languageDisplayName", () => {
  it("returns display name for known languages", () => {
    expect(languageDisplayName("typescript")).toBe("TypeScript");
    expect(languageDisplayName("javascript")).toBe("JavaScript");
    expect(languageDisplayName("rust")).toBe("Rust");
    expect(languageDisplayName("python")).toBe("Python");
    expect(languageDisplayName("scala")).toBe("Scala");
  });

  it("returns raw identifier for unknown languages", () => {
    expect(languageDisplayName("brainfuck")).toBe("brainfuck");
  });

  it("returns 'Plain Text' for 'text'", () => {
    expect(languageDisplayName("text")).toBe("Plain Text");
  });
});
