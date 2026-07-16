import { env } from "@hmls/shared/env";
import { AsyncLocalStorage } from "node:async_hooks";
import { configure, getConsoleSink, getJsonLinesFormatter } from "@logtape/logtape";

export async function setupLogging() {
  const level = env("LOG_LEVEL") === "debug" ? "debug" : "info";

  await configure({
    reset: true,
    sinks: {
      console: getConsoleSink({ formatter: getJsonLinesFormatter() }),
    },
    loggers: [
      { category: ["hmls"], lowestLevel: level, sinks: ["console"] },
      { category: ["logtape", "meta"], lowestLevel: "warning", sinks: ["console"] },
    ],
    contextLocalStorage: new AsyncLocalStorage(),
  });
}
