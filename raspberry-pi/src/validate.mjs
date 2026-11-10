import { readRuntimeConfig } from "./config/runtime-config.mjs";
import { validateRuntime } from "./runtime/bootstrap.mjs";

function safeErrorCode(error) {
  return typeof error?.code === "string" && /^[A-Z0-9_]{1,32}$/.test(error.code)
    ? error.code
    : "VALIDATION_FAILED";
}

async function main() {
  const config = readRuntimeConfig();
  const validation = await validateRuntime(config);
  console.info(JSON.stringify({
    event: "runtime_validation_passed",
    validation
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({
    event: "runtime_validation_failed",
    code: safeErrorCode(error),
    contractErrors: Array.isArray(error?.errors) ? error.errors : undefined
  }));
  process.exitCode = 1;
});
