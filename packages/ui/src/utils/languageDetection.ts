/**
 * Language detection utility for syntax highlighting.
 *
 * Infers a language identifier from a file path or extension.
 * Returns a Shiki/highlight.js compatible language name.
 */

const EXTENSION_MAP: Record<string, string> = {
  // Web
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
  mjs: "javascript", cjs: "javascript",
  vue: "vue", svelte: "svelte",
  html: "html", htm: "html",
  css: "css", scss: "scss", less: "less",
  json: "json", jsonc: "json", json5: "json",
  // Systems
  rs: "rust", go: "go", c: "c", cpp: "cpp", h: "c", hpp: "cpp",
  cs: "csharp", java: "java", kt: "kotlin", swift: "swift",
  scala: "scala", sc: "scala",
  // Scripting
  py: "python", rb: "ruby", php: "php", pl: "perl",
  lua: "lua", r: "r",
  // Shell
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
  ps1: "powershell", psm1: "powershell", psd1: "powershell",
  bat: "bat", cmd: "bat",
  // Config
  yaml: "yaml", yml: "yaml", toml: "toml", ini: "ini",
  xml: "xml", xsl: "xml", xsd: "xml",
  // Data
  sql: "sql", graphql: "graphql", gql: "graphql",
  csv: "csv",
  // Docs
  md: "markdown", mdx: "markdown", rst: "markdown",
  // Other
  dockerfile: "dockerfile", docker: "dockerfile",
  tf: "hcl", hcl: "hcl",
  proto: "protobuf",
  zig: "zig", nim: "nim", ex: "elixir", exs: "elixir",
  erl: "erlang", clj: "clojure",
};

/** Well-known filenames that have a specific language. */
const FILENAME_MAP: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  cmakelists: "cmake",
  "cargo.toml": "toml",
  "cargo.lock": "toml",
  "package.json": "json",
  "tsconfig.json": "json",
  ".gitignore": "gitignore",
  ".env": "shellscript",
};

/**
 * Detect language from a file path.
 *
 * @param path File path (can be absolute or relative)
 * @returns A language identifier, or "text" as fallback
 */
export function detectLanguage(path: string): string {
  if (!path) return "text";

  // Normalize and extract filename
  const normalized = path.replace(/\\/g, "/");
  const filename = normalized.split("/").pop()?.toLowerCase() ?? "";

  // Try well-known filenames first
  const filenameMatch = FILENAME_MAP[filename];
  if (filenameMatch) return filenameMatch;

  // Extract extension
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex >= 0) {
    const ext = filename.slice(dotIndex + 1).toLowerCase();
    const extMatch = EXTENSION_MAP[ext];
    if (extMatch) return extMatch;
  }

  return "text";
}

/**
 * Get the display name for a language identifier.
 */
export function languageDisplayName(lang: string): string {
  const names: Record<string, string> = {
    typescript: "TypeScript", javascript: "JavaScript", tsx: "TSX", jsx: "JSX",
    vue: "Vue", rust: "Rust", python: "Python", go: "Go",
    bash: "Shell", powershell: "PowerShell", sql: "SQL",
    json: "JSON", yaml: "YAML", toml: "TOML", html: "HTML", css: "CSS",
    markdown: "Markdown", text: "Plain Text", dockerfile: "Dockerfile",
    csharp: "C#", cpp: "C++", java: "Java", ruby: "Ruby", php: "PHP",
    swift: "Swift", kotlin: "Kotlin", scala: "Scala",
  };
  return names[lang] ?? lang;
}
