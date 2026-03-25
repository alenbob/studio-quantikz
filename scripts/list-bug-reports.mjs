import { readFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_STORAGE_PATH = path.join(process.cwd(), "data", "bug-reports.jsonl");

function parseArgs(argv) {
  let limit = 10;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--limit") {
      const nextValue = argv[index + 1];
      const parsed = Number.parseInt(nextValue ?? "", 10);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error("--limit must be a positive integer.");
      }
      limit = parsed;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { limit, json };
}

function bugReportPath() {
  return process.env.BUG_REPORTS_FILE_PATH?.trim() || DEFAULT_STORAGE_PATH;
}

function truncate(value, maxLength = 160) {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3)}...`;
}

async function loadReports(filePath) {
  const raw = await readFile(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSON on line ${index + 1} of ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
}

function printHumanReadable(reports, filePath) {
  if (reports.length === 0) {
    console.log(`No bug reports found in ${filePath}`);
    return;
  }

  console.log(`Showing ${reports.length} bug report${reports.length === 1 ? "" : "s"} from ${filePath}`);
  console.log("");

  for (const report of reports) {
    console.log(`${report.submittedAt}  ${report.title}`);
    console.log(`id: ${report.id}`);
    if (report.email) {
      console.log(`email: ${report.email}`);
    }
    if (report.pageUrl) {
      console.log(`page: ${report.pageUrl}`);
    }
    console.log(`description: ${truncate(report.description, 240)}`);
    if (report.code) {
      console.log(`code: ${truncate(report.code, 120)}`);
    }
    console.log("");
  }
}

async function main() {
  const { limit, json } = parseArgs(process.argv.slice(2));
  const filePath = bugReportPath();
  const reports = await loadReports(filePath);
  const recentReports = reports.slice(-limit).reverse();

  if (json) {
    console.log(JSON.stringify(recentReports, null, 2));
    return;
  }

  printHumanReadable(recentReports, filePath);
}

main().catch((error) => {
  const filePath = bugReportPath();
  if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
    console.error(`No local bug report file found at ${filePath}`);
    process.exit(1);
  }

  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});