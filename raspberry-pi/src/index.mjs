import { readRuntimeConfig } from "./config/runtime-config.mjs";
import { startRuntime } from "./runtime/bootstrap.mjs";

function safeErrorCode(error) {
  return typeof error?.code === "string" && /^[A-Z0-9_]{1,32}$/.test(error.code)
    ? error.code
    : "STARTUP_FAILED";
}

async function main() {
  const config = readRuntimeConfig();
  let runtime;
  let shuttingDown = false;

  const shutdown = (signal) => {
    if (shuttingDown || !runtime) {
      return;
    }
    shuttingDown = true;
    runtime.close().then(() => {
      console.info(JSON.stringify({
        event: signal === "RUNTIME_FATAL" ? "runtime_fatal_shutdown_complete" : "runtime_stopped",
        signal
      }));
    }).catch((error) => {
      console.error(JSON.stringify({
        event: "runtime_shutdown_failed",
        code: safeErrorCode(error)
      }));
      process.exitCode = 1;
    });
  };

  runtime = await startRuntime(config, {
    onFatal(error) {
      process.exitCode = 1;
      console.error(JSON.stringify({
        event: "runtime_fatal_failure",
        code: safeErrorCode(error)
      }));
      shutdown("RUNTIME_FATAL");
    }
  });

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(JSON.stringify({
    event: "runtime_startup_failed",
    code: safeErrorCode(error),
    contractErrors: Array.isArray(error?.errors) ? error.errors : undefined
  }));
  process.exitCode = 1;
});
