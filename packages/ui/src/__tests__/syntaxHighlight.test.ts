import { afterEach, describe, expect, it } from "vitest";
import { _cacheSize, _clearCache, highlightLine, highlightSql } from "../utils/syntaxHighlight";

afterEach(() => {
  _clearCache();
});

describe("syntaxHighlight", () => {
  it("returns identical output for repeated same-language calls", () => {
    const line = 'const result = formatValue("ok")';
    expect(highlightLine(line, "typescript")).toBe(highlightLine(line, "typescript"));
  });

  it("does not leak regex state across mixed-language calls", () => {
    const tsLine = 'const result = formatValue("ok")';
    const sqlLine = "select count(*) from sessions";

    const firstTs = highlightLine(tsLine, "typescript");
    const sql = highlightLine(sqlLine, "sql");
    const secondTs = highlightLine(tsLine, "typescript");

    expect(firstTs).toBe(secondTs);
    expect(sql).toContain('<span class="syn-keyword">select</span>');
    expect(sql).toContain('<span class="syn-keyword">from</span>');
  });

  it("reuses canonical rules across language aliases", () => {
    const line = "const value = helper()";

    expect(highlightLine(line, "typescript")).toBe(highlightLine(line, "javascript"));
  });

  it("escapes unsupported languages without adding syntax spans", () => {
    expect(highlightLine('<script>alert("xss")</script>', "unknown")).toBe(
      "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;",
    );
  });

  it("keeps SQL keyword highlighting case-insensitive", () => {
    const html = highlightLine("select * from sessions where id = 1", "sql");
    expect(html).toContain('<span class="syn-keyword">select</span>');
    expect(html).toContain('<span class="syn-keyword">from</span>');
    expect(html).toContain('<span class="syn-keyword">where</span>');
  });

  it("highlightSql delegates to SQL highlighting", () => {
    const sql = "SELECT * FROM sessions";
    expect(highlightSql(sql)).toBe(highlightLine(sql, "sql"));
  });
});

describe("syntaxHighlight: rust lifetimes", () => {
  it("highlights `'static` as a keyword, not a string", () => {
    const html = highlightLine("fn make<'a>(s: &'static str) -> &'a str { s }", "rust");
    expect(html).toContain('<span class="syn-keyword">\'static</span>');
    expect(html).toContain('<span class="syn-keyword">\'a</span>');
    // The lifetime should NOT appear inside a string span.
    expect(html).not.toMatch(/<span class="syn-string">[^<]*'static/);
  });

  it("still highlights single-character char literals as strings", () => {
    const html = highlightLine("let c = 'x';", "rust");
    // escapeHtml does not encode `'` (we never emit attribute-context HTML).
    expect(html).toContain("<span class=\"syn-string\">'x'</span>");
  });
});

describe("syntaxHighlight: TS regex vs division", () => {
  it("does not classify `a / b / c` as a regex literal", () => {
    const html = highlightLine("const r = a / b / c;", "typescript");
    expect(html).not.toContain("syn-regex");
  });

  it("still classifies a true regex literal", () => {
    const html = highlightLine("const r = /foo/g;", "typescript");
    expect(html).toContain('<span class="syn-regex">/foo/g</span>');
  });

  it("recognises a regex after `return`", () => {
    const html = highlightLine("return /\\d+/.test(s);", "typescript");
    expect(html).toContain('class="syn-regex"');
  });

  it("does not misfire after a paren close (treated as division)", () => {
    const html = highlightLine("const x = (a + b) / 2;", "typescript");
    expect(html).not.toContain("syn-regex");
  });
});

describe("syntaxHighlight: TS template literal interpolation", () => {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: ${} is the literal input under test
  it("renders ${expr} as nested punct + highlighted inner", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal `${}` is the input to the highlighter under test
    const html = highlightLine("const x = `hi ${name}`;", "typescript");
    // The literal "hi " is inside a string span.
    expect(html).toContain('<span class="syn-string">`hi </span>');
    // ${ and } are emitted as punct.
    expect(html).toContain('<span class="syn-punct">${</span>');
    expect(html).toContain('<span class="syn-punct">}</span>');
    // The closing backtick is its own string span.
    expect(html).toContain('<span class="syn-string">`</span>');
  });

  it("highlights inner expressions in interpolations", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal `${}` is the input to the highlighter under test
    const html = highlightLine("`${count + 1}`", "typescript");
    expect(html).toContain('<span class="syn-number">1</span>');
    expect(html).toContain('<span class="syn-operator">+</span>');
  });

  it("treats a plain template literal with no interpolation as one string", () => {
    const html = highlightLine("const x = `plain text`;", "typescript");
    expect(html).toContain('<span class="syn-string">`plain text`</span>');
  });
});

describe("syntaxHighlight: TSX / JSX", () => {
  it("colours JSX tags and attributes distinctly", () => {
    const html = highlightLine('<Foo bar="x">', "tsx");
    expect(html).toContain('<span class="syn-tag">&lt;Foo</span>');
    expect(html).toContain('<span class="syn-attr">bar</span>');
    expect(html).toContain('<span class="syn-string">&quot;x&quot;</span>');
    expect(html).toContain('<span class="syn-tag">&gt;</span>');
  });

  it("recognises closing tags", () => {
    const html = highlightLine("</Component>", "jsx");
    expect(html).toContain('<span class="syn-tag">&lt;/Component</span>');
  });

  it("does not confuse `a < b` for a JSX tag", () => {
    const html = highlightLine("if (a < b) {}", "tsx");
    // No tag span should be emitted around `<`.
    expect(html).not.toMatch(/<span class="syn-tag">&lt;[a-zA-Z]/);
  });
});

describe("syntaxHighlight: HCL", () => {
  it("highlights block headers and attributes", () => {
    const html = highlightLine('resource "aws_instance" "web" {', "hcl");
    expect(html).toContain('<span class="syn-keyword">resource</span>');
    expect(html).toContain('<span class="syn-string">&quot;aws_instance&quot;</span>');
  });

  it("highlights `key = value` assignments", () => {
    const html = highlightLine('  ami = "ami-123"', "hcl");
    expect(html).toContain('<span class="syn-prop">ami</span>');
    expect(html).toContain('<span class="syn-string">&quot;ami-123&quot;</span>');
  });

  it("recognises `#` and `//` line comments", () => {
    expect(highlightLine("# hash comment", "hcl")).toContain(
      '<span class="syn-comment"># hash comment</span>',
    );
    expect(highlightLine("// slash comment", "hcl")).toContain(
      '<span class="syn-comment">// slash comment</span>',
    );
  });
});

describe("syntaxHighlight: YAML anchors / aliases / tags", () => {
  it("highlights anchor declarations as const", () => {
    const html = highlightLine("default: &base { name: x }", "yaml");
    expect(html).toContain('<span class="syn-const">&amp;base</span>');
  });

  it("highlights alias references as const", () => {
    const html = highlightLine("other: *base", "yaml");
    expect(html).toContain('<span class="syn-const">*base</span>');
  });

  it("highlights tags as type", () => {
    const html = highlightLine("v: !!str 42", "yaml");
    expect(html).toContain('<span class="syn-type">!!str</span>');
  });
});

describe("syntaxHighlight: TS decorators", () => {
  it("highlights @Component as a keyword", () => {
    const html = highlightLine("@Component({ selector: 'x' })", "typescript");
    expect(html).toContain('<span class="syn-keyword">@Component</span>');
  });
});

describe("syntaxHighlight: bounded LRU cache", () => {
  it("returns identical cached output on hit", () => {
    _clearCache();
    const line = "const x = 1;";
    const first = highlightLine(line, "typescript");
    const second = highlightLine(line, "typescript");
    expect(first).toBe(second);
    expect(_cacheSize()).toBe(1);
  });

  it("evicts the least-recently-used entry after CACHE_MAX inserts", () => {
    _clearCache();
    // Fill the cache past its 256-entry cap.
    for (let i = 0; i < 260; i++) {
      highlightLine(`const v${i} = ${i};`, "typescript");
    }
    expect(_cacheSize()).toBe(256);
  });

  it("does not cache lines longer than the cap", () => {
    _clearCache();
    const long = "x".repeat(2000);
    highlightLine(long, "typescript");
    expect(_cacheSize()).toBe(0);
  });
});

describe("syntaxHighlight: ReDoS smoke test", () => {
  // Pathological inputs aimed at the patterns most likely to backtrack:
  //   - long unterminated strings/templates
  //   - long sequences of comment-opener-like chars
  //   - long sequences of operator chars
  const PATHOLOGICAL_INPUTS = [
    "a".repeat(100_000),
    `"${"\\".repeat(50_000)}`, // unterminated string with escapes
    `\`${"$".repeat(50_000)}`, // unterminated template
    "/*".concat("*".repeat(99_998)), // unterminated block comment
    "/".repeat(100_000), // many slashes
    "<".repeat(100_000),
    "&".repeat(100_000),
  ];

  const LANGUAGES = [
    "typescript",
    "tsx",
    "rust",
    "python",
    "css",
    "json",
    "sql",
    "bash",
    "go",
    "html",
    "yaml",
    "toml",
    "hcl",
    "scala",
    "markdown",
  ];

  it.each(LANGUAGES)("language %s completes within 200ms on pathological inputs", (lang) => {
    for (const input of PATHOLOGICAL_INPUTS) {
      const start = performance.now();
      highlightLine(input, lang);
      const elapsed = performance.now() - start;
      expect(elapsed, `lang=${lang} input.len=${input.length}`).toBeLessThan(200);
    }
  });
});
