import nextEnv from "@next/env";

/** Match Next's .env precedence before running database/startup tools. */
export function loadDatabaseEnvironment(development = false) {
  nextEnv.loadEnvConfig(process.cwd(), development, { info() {}, error() {} });
}
