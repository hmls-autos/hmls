import {
  configure,
  getConsoleSink,
  getLogger,
  getTextFormatter,
} from "@logtape/logtape";

export async function setupLogging() {
  await configure({
    sinks: {
      console: getConsoleSink({
        // deno-lint-ignore no-explicit-any
        formatter: getTextFormatter({ category: "." } as any),
      }),
    },
    filters: {},
    loggers: [
      {
        category: ["hmls"],
        level: Deno.env.get("LOG_LEVEL") === "debug" ? "debug" : "info",
        sinks: ["console"],
      },
    ],
  });
}

export function getGatewayLogger(name: string) {
  return getLogger(["hmls", "gateway", name]);
}

export function getAgentLogger(name: string) {
  return getLogger(["hmls", "agent", name]);
}
