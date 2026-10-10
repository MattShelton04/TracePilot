/**
 * Static reachability analysis for pop-out (viewer) windows.
 *
 * Starting from `main.ts` (minus the main-window-only `App.vue` and router),
 * it follows every static and dynamic import through the desktop sources,
 * including `ChildApp.vue` and the lazy session tabs, and records:
 *
 *   - each `@tracepilot/client` symbol a reachable file imports, resolved to
 *     the IPC commands that symbol can invoke (following calls between
 *     client functions);
 *   - each `@tauri-apps/*` module a reachable file imports.
 *
 * Reachability is per file, so the result over-approximates: a command used
 * only by a main-window branch of a shared store still shows up. That is
 * deliberate: `viewerCapabilities.test.ts` makes each such command an explicit,
 * reviewed decision instead of a silent gap.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { parse as parseSfc } from "vue/compiler-sfc";

export const DESKTOP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SRC = join(DESKTOP_ROOT, "src");
const CLIENT_SRC = resolve(DESKTOP_ROOT, "../../packages/client/src");

/** Imports of `main.ts` that only the main window mounts. */
export const MAIN_ONLY_ENTRY_IMPORTS = ["./App.vue", "./router"] as const;

/** Client exports that call arbitrary commands; pop-out code must use typed wrappers. */
const RAW_INVOKE_EXPORTS = new Set(["createInvoke", "invokePlugin"]);

interface ImportRef {
  spec: string;
  /** Imported value names; `*` means the whole module. */
  names: string[];
}

export interface ViewerReach {
  /** Reachable desktop files, relative to `apps/desktop/src`. */
  files: string[];
  /** Command name → reachable files that import a client function invoking it. */
  commands: Map<string, Set<string>>;
  /** `@tauri-apps/*` module → reachable files importing it. */
  tauriModules: Map<string, Set<string>>;
  /** Problems that make the analysis unsound; the test fails on any. */
  errors: string[];
}

function scriptSource(file: string): string {
  const text = readFileSync(file, "utf8");
  if (!file.endsWith(".vue")) return text;
  const { descriptor } = parseSfc(text, { filename: file });
  return [descriptor.script?.content, descriptor.scriptSetup?.content]
    .filter((part): part is string => Boolean(part))
    .join("\n");
}

function sourceFile(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function namedValues(elements: ts.NodeArray<ts.ImportSpecifier | ts.ExportSpecifier>): string[] {
  return elements.filter((el) => !el.isTypeOnly).map((el) => (el.propertyName ?? el.name).text);
}

function collectImports(sf: ts.SourceFile): ImportRef[] {
  const refs: ImportRef[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const spec = node.moduleSpecifier.text;
      if (!clause) refs.push({ spec, names: [] });
      else if (!clause.isTypeOnly) {
        const names: string[] = [];
        if (clause.name) names.push("default");
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) names.push("*");
        if (bindings && ts.isNamedImports(bindings)) names.push(...namedValues(bindings.elements));
        if (names.length > 0) refs.push({ spec, names });
      }
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !node.isTypeOnly
    ) {
      const clause = node.exportClause;
      const names = clause && ts.isNamedExports(clause) ? namedValues(clause.elements) : ["*"];
      if (names.length > 0) refs.push({ spec: node.moduleSpecifier.text, names });
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      refs.push({ spec: node.arguments[0].text, names: ["*"] });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return refs;
}

function resolveLocal(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  const candidates = [base, `${base}.ts`, `${base}.vue`, join(base, "index.ts")];
  if (base.endsWith(".js")) candidates.push(`${base.slice(0, -3)}.ts`);
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

/**
 * For a barrel (a module made only of `export … from` statements), the
 * re-export sources that provide `names`; null when the module is not a barrel.
 */
function barrelSources(sf: ts.SourceFile, names: string[]): string[] | null {
  if (names.includes("*")) return null;
  const sources: string[] = [];
  for (const statement of sf.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier) return null;
    if (statement.isTypeOnly || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.exportClause;
    const exported =
      clause && ts.isNamedExports(clause)
        ? clause.elements.filter((el) => !el.isTypeOnly).map((el) => el.name.text)
        : null;
    if (!exported || exported.some((name) => names.includes(name))) {
      sources.push(statement.moduleSpecifier.text);
    }
  }
  return sources;
}

interface ClientDecl {
  commands: Set<string>;
  refs: Set<string>;
}

function declNames(statement: ts.Statement): string[] {
  if (
    (ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement)) &&
    statement.name
  ) {
    return [statement.name.text];
  }
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations
      .map((d) => d.name)
      .filter(ts.isIdentifier)
      .map((id) => id.text);
  }
  return [];
}

/** Map every top-level declaration in `packages/client/src` to the commands it invokes. */
function analyzeClient(errors: string[]): Map<string, ClientDecl> {
  const decls = new Map<string, ClientDecl>();
  const declOf = (name: string) => {
    let decl = decls.get(name);
    if (!decl) {
      decl = { commands: new Set(), refs: new Set() };
      decls.set(name, decl);
    }
    return decl;
  };
  const bodies: Array<{ names: string[]; node: ts.Node; file: string }> = [];
  for (const entry of readdirSync(CLIENT_SRC)) {
    if (!entry.endsWith(".ts")) continue;
    const sf = sourceFile(entry, readFileSync(join(CLIENT_SRC, entry), "utf8"));
    for (const statement of sf.statements) {
      if (ts.isExportDeclaration(statement) && statement.exportClause) {
        const clause = statement.exportClause;
        if (!ts.isNamedExports(clause)) continue;
        for (const el of clause.elements) {
          if (el.propertyName) declOf(el.name.text).refs.add(el.propertyName.text);
        }
        continue;
      }
      const names = declNames(statement);
      if (names.length > 0) bodies.push({ names, node: statement, file: entry });
    }
  }
  for (const { names } of bodies) for (const name of names) declOf(name);
  for (const { names, node, file } of bodies) {
    const visit = (child: ts.Node) => {
      if (ts.isIdentifier(child) && decls.has(child.text) && !names.includes(child.text)) {
        for (const name of names) declOf(name).refs.add(child.text);
      }
      if (
        ts.isCallExpression(child) &&
        ts.isIdentifier(child.expression) &&
        child.expression.text === "invoke"
      ) {
        const arg = child.arguments[0];
        if (arg && ts.isStringLiteralLike(arg)) {
          for (const name of names) declOf(name).commands.add(arg.text);
        } else {
          errors.push(
            `packages/client/src/${file}: invoke() in ${names.join(", ")} has a non-literal command name; ` +
              "pass the command as a string literal so pop-out reachability can be checked",
          );
        }
      }
      ts.forEachChild(child, visit);
    };
    visit(node);
  }
  return decls;
}

function commandsFor(decls: Map<string, ClientDecl>, name: string): Set<string> {
  const out = new Set<string>();
  const seen = new Set<string>();
  const stack = [name];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (seen.has(current)) continue;
    seen.add(current);
    const decl = decls.get(current);
    if (!decl) continue;
    for (const cmd of decl.commands) out.add(cmd);
    stack.push(...decl.refs);
  }
  return out;
}

export function analyzeViewerReach(): ViewerReach {
  const errors: string[] = [];
  const clientImports = new Map<string, Set<string>>();
  const tauriModules = new Map<string, Set<string>>();
  const visited = new Map<string, Set<string>>(); // file → names already followed
  const parsed = new Map<string, ts.SourceFile>();
  const parse = (file: string) => {
    let sf = parsed.get(file);
    if (!sf) {
      sf = sourceFile(file, scriptSource(file));
      parsed.set(file, sf);
    }
    return sf;
  };
  const add = (map: Map<string, Set<string>>, key: string, file: string) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)?.add(relative(SRC, file).replaceAll("\\", "/"));
  };

  const entry = join(SRC, "main.ts");
  const stack: Array<{ file: string; names: string[] }> = [];
  const entryImports = collectImports(parse(entry));
  for (const skipped of MAIN_ONLY_ENTRY_IMPORTS) {
    if (!entryImports.some((ref) => ref.spec === skipped)) {
      errors.push(`main.ts no longer imports ${skipped}; update MAIN_ONLY_ENTRY_IMPORTS`);
    }
  }
  visited.set(entry, new Set(["*"]));
  const pushImports = (file: string, refs: ImportRef[]) => {
    for (const ref of refs) {
      if (file === entry && (MAIN_ONLY_ENTRY_IMPORTS as readonly string[]).includes(ref.spec)) {
        continue;
      }
      if (ref.spec === "@tracepilot/client") {
        for (const name of ref.names) add(clientImports, name, file);
      } else if (ref.spec.startsWith("@tracepilot/client/")) {
        errors.push(
          `${relative(SRC, file)} imports ${ref.spec}, which the analysis does not cover`,
        );
      } else if (ref.spec.startsWith("@tauri-apps/")) {
        add(tauriModules, ref.spec, file);
      } else {
        const target = resolveLocal(file, ref.spec);
        if (target) stack.push({ file: target, names: ref.names });
        else if (ref.spec.startsWith("@/") || ref.spec.startsWith(".")) {
          errors.push(`${relative(SRC, file)}: cannot resolve ${ref.spec}`);
        }
      }
    }
  };
  pushImports(entry, entryImports);

  while (stack.length > 0) {
    const { file, names } = stack.pop() as { file: string; names: string[] };
    if (!/\.(ts|vue)$/.test(file)) continue;
    const followed = visited.get(file) ?? new Set<string>();
    const wanted = names.length === 0 ? ["*"] : names;
    if (followed.has("*") || wanted.every((name) => followed.has(name))) continue;
    for (const name of wanted) followed.add(name);
    visited.set(file, followed);
    const sf = parse(file);
    const barrel = barrelSources(sf, [...followed]);
    if (barrel) {
      const refs = collectImports(sf).filter((ref) => barrel.includes(ref.spec));
      pushImports(file, refs);
    } else {
      followed.add("*");
      pushImports(file, collectImports(sf));
    }
  }

  // Shared workspace packages are not walked; they must stay IPC-free.
  for (const pkg of ["ui", "types"]) {
    const manifest = JSON.parse(
      readFileSync(resolve(DESKTOP_ROOT, `../../packages/${pkg}/package.json`), "utf8"),
    ) as Record<string, Record<string, string> | undefined>;
    const deps = Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies });
    for (const dep of deps.filter(
      (d) => d === "@tracepilot/client" || d.startsWith("@tauri-apps/"),
    )) {
      errors.push(`@tracepilot/${pkg} depends on ${dep}; extend viewerIpcReach.ts to walk it`);
    }
  }

  const decls = analyzeClient(errors);
  const commands = new Map<string, Set<string>>();
  for (const [name, files] of clientImports) {
    if (name === "*" || name === "default") {
      errors.push(`${[...files].join(", ")}: import named functions from @tracepilot/client`);
      continue;
    }
    if (RAW_INVOKE_EXPORTS.has(name)) {
      errors.push(`${[...files].join(", ")}: ${name} is reachable from pop-out windows`);
      continue;
    }
    if (!decls.has(name)) {
      errors.push(`${[...files].join(", ")}: unknown @tracepilot/client export ${name}`);
      continue;
    }
    for (const cmd of commandsFor(decls, name)) {
      for (const f of files) {
        if (!commands.has(cmd)) commands.set(cmd, new Set());
        commands.get(cmd)?.add(f);
      }
    }
  }

  const files = [...visited.keys()].map((f) => relative(SRC, f).replaceAll("\\", "/")).sort();
  return { files, commands, tauriModules, errors };
}
