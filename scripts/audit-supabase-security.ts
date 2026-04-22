import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

type FunctionAudit = {
  file: string;
  hasSearchPath: boolean;
  name: string;
  securityDefiner: boolean;
};

const repoRoot = process.cwd();
const migrationsDir = path.join(repoRoot, "supabase", "migrations");
const sourceDirs = [path.join(repoRoot, "src"), path.join(repoRoot, "scripts")];
const sourceFilePattern = /\.(ts|tsx|js|jsx|sql)$/i;

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return listFiles(fullPath);
      }

      return sourceFilePattern.test(entry.name) ? [fullPath] : [];
    }),
  );

  return files.flat();
}

function getSortedEntries(entries: string[]) {
  return [...entries].sort((left, right) => left.localeCompare(right));
}

function collectCreatedTables(sql: string) {
  const matches = sql.matchAll(/create\s+table\s+if\s+not\s+exists\s+public\.([a-z0-9_]+)/gi);
  return Array.from(matches, (match) => match[1].toLowerCase());
}

function collectRlsTables(sql: string, mode: "enable" | "disable" | "force") {
  const regex = new RegExp(
    String.raw`alter\s+table\s+public\.([a-z0-9_]+)\s+${mode}\s+row\s+level\s+security`,
    "gi",
  );

  return Array.from(sql.matchAll(regex), (match) => match[1].toLowerCase());
}

function collectPolicies(sql: string) {
  const matches = sql.matchAll(/create\s+policy\s+[\s\S]+?\s+on\s+public\.([a-z0-9_]+)/gi);
  return Array.from(matches, (match) => match[1].toLowerCase());
}

function collectFunctions(sql: string, file: string): FunctionAudit[] {
  const matches = sql.matchAll(
    /create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)\s*\([^)]*\)([\s\S]*?)as\s+\$\$/gi,
  );

  return Array.from(matches, (match) => {
    const header = match[2].toLowerCase();
    return {
      file,
      hasSearchPath: header.includes("set search_path"),
      name: match[1].toLowerCase(),
      securityDefiner: header.includes("security definer"),
    };
  });
}

function collectReferencedTables(source: string) {
  const matches = source.matchAll(/\.from\(\s*['"]([a-z0-9_]+)['"]\s*\)/gi);
  return Array.from(matches, (match) => match[1].toLowerCase());
}

async function main() {
  const migrationFiles = getSortedEntries(
    (await readdir(migrationsDir)).filter((entry) => entry.toLowerCase().endsWith(".sql")),
  );

  const createdTables = new Set<string>();
  const enabledRlsTables = new Set<string>();
  const disabledRlsTables = new Set<string>();
  const forcedRlsTables = new Set<string>();
  const policyTables = new Set<string>();
  const functionAudits: FunctionAudit[] = [];

  for (const migrationFile of migrationFiles) {
    const fullPath = path.join(migrationsDir, migrationFile);
    const sql = await readFile(fullPath, "utf8");

    for (const table of collectCreatedTables(sql)) {
      createdTables.add(table);
    }

    for (const table of collectRlsTables(sql, "enable")) {
      enabledRlsTables.add(table);
      disabledRlsTables.delete(table);
    }

    for (const table of collectRlsTables(sql, "disable")) {
      disabledRlsTables.add(table);
    }

    for (const table of collectRlsTables(sql, "force")) {
      forcedRlsTables.add(table);
    }

    for (const table of collectPolicies(sql)) {
      policyTables.add(table);
    }

    functionAudits.push(...collectFunctions(sql, fullPath));
  }

  const referencedTables = new Set<string>();

  for (const sourceDir of sourceDirs) {
    const files = await listFiles(sourceDir);
    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const table of collectReferencedTables(source)) {
        referencedTables.add(table);
      }
    }
  }

  const findings: string[] = [];

  for (const table of getSortedEntries(Array.from(createdTables))) {
    if (!enabledRlsTables.has(table)) {
      findings.push(`Missing RLS enablement for table: ${table}`);
    }

    if (disabledRlsTables.has(table)) {
      findings.push(`RLS is disabled by migrations for table: ${table}`);
    }

    if (!forcedRlsTables.has(table)) {
      findings.push(`Missing FORCE RLS for table: ${table}`);
    }
  }

  for (const table of getSortedEntries(Array.from(referencedTables))) {
    if (!createdTables.has(table)) {
      findings.push(`Code references a Supabase table that is not managed by migrations: ${table}`);
    }
  }

  for (const audit of functionAudits) {
    if (audit.securityDefiner && !audit.hasSearchPath) {
      findings.push(
        `SECURITY DEFINER function is missing SET search_path: ${audit.name} (${path.relative(repoRoot, audit.file)})`,
      );
    }
  }

  if (!policyTables.has("users")) {
    findings.push("Expected self-access policy for users table was not found in migrations.");
  }

  if (findings.length > 0) {
    console.error("Supabase security audit failed:\n");
    for (const finding of findings) {
      console.error(`- ${finding}`);
    }
    process.exit(1);
  }

  console.log("Supabase security audit passed.");
  console.log(`Checked ${createdTables.size} migrated tables, ${functionAudits.length} functions, and ${referencedTables.size} referenced tables.`);
}

main().catch((error) => {
  console.error("Supabase security audit failed unexpectedly.");
  console.error(error);
  process.exit(1);
});
