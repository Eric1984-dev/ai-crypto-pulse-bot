"use strict";

const fs = require("node:fs");
const path = require("node:path");
const markets = require("../config/markets.js");

const rootDirectory = path.resolve(__dirname, "..");
const migrationsDirectory = path.join(rootDirectory, "supabase", "migrations");
const requiredTables = [
  "AI_Crypto_Bot_Profiles",
  "AI_Crypto_Bot_Portfolios",
  "AI_Crypto_Bot_Positions",
  "AI_Crypto_Bot_Trades",
  "AI_Crypto_Bot_AI_Decisions",
  "AI_Crypto_Bot_Status",
  "AI_Crypto_Bot_Watched_Markets",
  "AI_Crypto_Bot_Market_Data",
  "AI_Crypto_Bot_Candles",
  "AI_Crypto_Bot_Strategies",
  "AI_Crypto_Bot_Strategy_Changes",
  "AI_Crypto_Bot_Strategy_Performance",
  "AI_Crypto_Bot_Backtests",
  "AI_Crypto_Bot_Portfolio_Snapshots",
  "AI_Crypto_Bot_Scanner_Events",
  "AI_Crypto_Bot_Emergency_State"
];

function validateDatabase() {
  const errors = [];
  if (!fs.existsSync(migrationsDirectory)) {
    return [`Missing Supabase migration directory: ${path.relative(rootDirectory, migrationsDirectory)}`];
  }

  const migrationFiles = fs.readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  if (migrationFiles.length < 2) {
    errors.push("Database schema and initial seed migrations are required.");
  }
  for (const file of migrationFiles) {
    if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(file)) {
      errors.push(`Invalid Supabase migration filename: ${file}`);
    }
  }

  const migrationSql = migrationFiles
    .map((file) => fs.readFileSync(path.join(migrationsDirectory, file), "utf8"))
    .join("\n");
  const createdTables = [...migrationSql.matchAll(/CREATE TABLE public\."([^"]+)"/g)]
    .map((match) => match[1]);
  const actualTableSet = new Set(createdTables);
  for (const table of requiredTables) {
    if (!actualTableSet.has(table)) {
      errors.push(`Missing prefixed database table: ${table}`);
    }
  }
  if (createdTables.length !== requiredTables.length) {
    errors.push(`Expected ${requiredTables.length} table declarations; found ${createdTables.length}.`);
  }
  for (const table of createdTables) {
    if (!table.startsWith("AI_Crypto_Bot_")) {
      errors.push(`Database table does not use the required prefix: ${table}`);
    }
  }

  const rlsTables = new Set(
    [...migrationSql.matchAll(/ALTER TABLE public\."([^"]+)" ENABLE ROW LEVEL SECURITY;/g)]
      .map((match) => match[1])
  );
  const policyTables = new Set(
    [...migrationSql.matchAll(/CREATE POLICY "([^"]+)"\s+ON public\."([^"]+)"/g)]
      .map((match) => match[2])
  );
  for (const table of requiredTables) {
    if (!rlsTables.has(table)) {
      errors.push(`Row Level Security is not enabled for ${table}.`);
    }
    if (!policyTables.has(table)) {
      errors.push(`No explicit read policy is defined for ${table}.`);
    }
  }

  const objectNamePatterns = [
    /CREATE (?:UNIQUE )?INDEX "([^"]+)"/g,
    /CREATE POLICY "([^"]+)"/g,
    /CREATE TRIGGER "([^"]+)"/g,
    /CREATE FUNCTION public\."([^"]+)"/g
  ];
  for (const pattern of objectNamePatterns) {
    for (const match of migrationSql.matchAll(pattern)) {
      if (!match[1].startsWith("AI_Crypto_Bot_")) {
        errors.push(`Database object does not use the required prefix: ${match[1]}`);
      }
    }
  }

  const configPath = path.join(rootDirectory, "supabase", "config.toml");
  if (!fs.existsSync(configPath) || !/^\s*project_id\s*=/m.test(fs.readFileSync(configPath, "utf8"))) {
    errors.push("Supabase project configuration is missing a project_id.");
  }

  const seedSql = migrationFiles
    .map((file) => fs.readFileSync(path.join(migrationsDirectory, file), "utf8"))
    .find((sql) => sql.includes('INSERT INTO public."AI_Crypto_Bot_Watched_Markets"'));
  if (!seedSql) {
    errors.push("Initial watched-market seed data is missing.");
  } else {
    const seedValues = seedSql.match(
      /INSERT INTO public\."AI_Crypto_Bot_Watched_Markets"[\s\S]*?VALUES([\s\S]*?)ON CONFLICT/i
    );
    const seededMarkets = seedValues
      ? [...seedValues[1].matchAll(/\('([^']+)',\s*(true|false),\s*(\d+)\)/gi)]
        .map((match) => ({
          symbol: match[1],
          enabled: match[2].toLowerCase() === "true",
          priority: Number(match[3])
        }))
      : [];
    if (JSON.stringify(seededMarkets) !== JSON.stringify(markets)) {
      errors.push("Watched-market migration seed does not match config/markets.js.");
    }
  }

  return errors;
}

if (require.main === module) {
  const errors = validateDatabase();
  if (errors.length > 0) {
    console.error(`Database migration validation failed:\n- ${errors.join("\n- ")}`);
    process.exitCode = 1;
  } else {
    console.log("Database migration validation passed (16 prefixed tables, RLS coverage, seed parity).");
  }
}

module.exports = { requiredTables, validateDatabase };
