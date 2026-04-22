import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

type TableSchema = {
  columns: Set<string>;
  table: string;
};

type UsageFinding = {
  column: string;
  file: string;
  table: string;
};

const repoRoot = process.cwd();
const migrationsDir = path.join(repoRoot, "supabase", "migrations");
const sourceDirs = [path.join(repoRoot, "src"), path.join(repoRoot, "scripts")];
const sourceFilePattern = /\.(ts|tsx|js|jsx)$/i;
const ignoredColumns = new Set(["count", "exact", "head", "ascending", "foreignTable", "nullsFirst"]);

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

function normalizeIdentifier(value: string) {
  return value.trim().replace(/^public\./i, "").replace(/^["']|["']$/g, "").toLowerCase();
}

function parseCreateTableBlocks(sql: string) {
  const blocks: Array<{ body: string; table: string }> = [];
  const regex = /create\s+table\s+if\s+not\s+exists\s+public\.([a-z0-9_]+)\s*\(([\s\S]*?)\);\s*/gi;

  for (const match of sql.matchAll(regex)) {
    blocks.push({
      body: match[2],
      table: normalizeIdentifier(match[1]),
    });
  }

  return blocks;
}

function collectColumnsFromCreateTableBody(body: string) {
  const columns = new Set<string>();
  const lines = body.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("--")) {
      continue;
    }

    const lowerLine = line.toLowerCase();
    if (
      lowerLine.startsWith("constraint ") ||
      lowerLine.startsWith("primary key") ||
      lowerLine.startsWith("unique ") ||
      lowerLine.startsWith("foreign key") ||
      lowerLine.startsWith("check ")
    ) {
      continue;
    }

    const match = line.match(/^"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+/);
    const columnName = match?.[1];

    if (columnName) {
      columns.add(normalizeIdentifier(columnName));
    }
  }

  return columns;
}

function collectAddedColumns(sql: string) {
  const addedColumns = new Map<string, Set<string>>();
  const alterTableRegex = /alter\s+table\s+public\.([a-z0-9_]+)([\s\S]*?);/gi;

  for (const match of sql.matchAll(alterTableRegex)) {
    const table = normalizeIdentifier(match[1]);
    const body = match[2];
    const addColumnRegex = /add\s+column\s+if\s+not\s+exists\s+([a-z0-9_]+)/gi;

    for (const addMatch of body.matchAll(addColumnRegex)) {
      if (!addedColumns.has(table)) {
        addedColumns.set(table, new Set());
      }

      addedColumns.get(table)?.add(normalizeIdentifier(addMatch[1]));
    }
  }

  return addedColumns;
}

function buildSchemaMap(migrationSql: string[]) {
  const schemas = new Map<string, TableSchema>();

  for (const sql of migrationSql) {
    for (const block of parseCreateTableBlocks(sql)) {
      if (!schemas.has(block.table)) {
        schemas.set(block.table, { table: block.table, columns: new Set() });
      }

      const schema = schemas.get(block.table);
      const columns = collectColumnsFromCreateTableBody(block.body);
      for (const column of columns) {
        schema?.columns.add(column);
      }
    }

    for (const [table, columns] of collectAddedColumns(sql)) {
      if (!schemas.has(table)) {
        schemas.set(table, { table, columns: new Set() });
      }

      const schema = schemas.get(table);
      for (const column of columns) {
        schema?.columns.add(column);
      }
    }
  }

  return schemas;
}

function extractSelectColumns(value: string) {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/\s+as\s+.+$/i, ""))
    .map((part) => part.replace(/[()]/g, ""))
    .map((part) => part.split(/\s+/)[0] ?? "")
    .map((part) => part.split("!")[0] ?? "")
    .map((part) => part.split(":")[0] ?? "")
    .map((part) => part.trim())
    .filter(Boolean)
    .map(normalizeIdentifier)
    .filter((column) => column !== "*" && !column.includes("->"));
}

function collectUsageFindings(source: string, file: string, schemas: Map<string, TableSchema>) {
  const findings: UsageFinding[] = [];
  const fromRegex = /\.from\(\s*['"]([a-z0-9_]+)['"]\s*\)([\s\S]{0,1200}?)(?=\.from\(\s*['"][a-z0-9_]+['"]\s*\)|;)/gi;

  for (const match of source.matchAll(fromRegex)) {
    const table = normalizeIdentifier(match[1]);
    const schema = schemas.get(table);
    if (!schema) {
      continue;
    }

    const chain = match[2];
    const referencedColumns = new Set<string>();

    for (const selectMatch of chain.matchAll(/\.select\(\s*(['"`])([\s\S]*?)\1/gi)) {
      for (const column of extractSelectColumns(selectMatch[2])) {
        referencedColumns.add(column);
      }
    }

    for (const columnMatch of chain.matchAll(/\.(?:eq|neq|gt|gte|lt|lte|is|in|order|or|filter)\(\s*['"]([a-z0-9_]+)['"]/gi)) {
      referencedColumns.add(normalizeIdentifier(columnMatch[1]));
    }

    for (const column of referencedColumns) {
      if (ignoredColumns.has(column)) {
        continue;
      }

      if (!schema.columns.has(column)) {
        findings.push({ column, file, table });
      }
    }
  }

  return findings;
}

async function main() {
  const migrationFiles = (await readdir(migrationsDir))
    .filter((entry) => entry.toLowerCase().endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));

  const migrationSql = await Promise.all(
    migrationFiles.map((file) => readFile(path.join(migrationsDir, file), "utf8")),
  );

  const schemas = buildSchemaMap(migrationSql);
  const findings: UsageFinding[] = [];

  for (const sourceDir of sourceDirs) {
    const files = await listFiles(sourceDir);
    for (const file of files) {
      const source = await readFile(file, "utf8");
      findings.push(...collectUsageFindings(source, file, schemas));
    }
  }

  if (findings.length > 0) {
    console.error("Supabase schema usage audit failed:\n");
    for (const finding of findings) {
      console.error(
        `- ${path.relative(repoRoot, finding.file)} references missing column ${finding.table}.${finding.column}`,
      );
    }
    process.exit(1);
  }

  console.log("Supabase schema usage audit passed.");
  console.log(`Checked ${schemas.size} migrated tables against literal code references.`);
}

main().catch((error) => {
  console.error("Supabase schema usage audit failed unexpectedly.");
  console.error(error);
  process.exit(1);
});
