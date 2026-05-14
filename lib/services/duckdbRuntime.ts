import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function defaultRuntimeDirectory() {
  if (process.env.VERCEL) {
    return path.join(os.tmpdir(), 'duckdb');
  }
  return path.join(process.cwd(), '.duckdb');
}

export function duckDbRuntimeSetupStatements() {
  const baseDirectory = process.env.DUCKDB_RUNTIME_DIR || defaultRuntimeDirectory();
  const homeDirectory = process.env.DUCKDB_HOME_DIRECTORY || baseDirectory;
  const extensionDirectory =
    process.env.DUCKDB_EXTENSION_DIRECTORY || path.join(baseDirectory, 'extensions');

  fs.mkdirSync(homeDirectory, { recursive: true });
  fs.mkdirSync(extensionDirectory, { recursive: true });

  return [
    `SET home_directory=${sqlString(homeDirectory)}`,
    `SET extension_directory=${sqlString(extensionDirectory)}`,
  ];
}
