import type { AppConfig } from "./config";
import { loadConfig } from "./config";
import { createDatabase, type Database } from "./db";
import { VerificationJobService } from "./jobs";
import { PerplexityResearchProvider } from "./providers/perplexity";

export interface AppRuntime {
  config: AppConfig;
  db: Database;
  jobs: VerificationJobService;
  provider: PerplexityResearchProvider;
}

declare global {
  // eslint-disable-next-line no-var
  var __ruleAiRuntime__: AppRuntime | undefined;
}

export function getAppRuntime(): AppRuntime {
  if (!globalThis.__ruleAiRuntime__) {
    const config = loadConfig();
    const db = createDatabase(config);
    const provider = new PerplexityResearchProvider(config);
    const jobs = new VerificationJobService(db, provider);

    globalThis.__ruleAiRuntime__ = {
      config,
      db,
      jobs,
      provider,
    };
  }

  return globalThis.__ruleAiRuntime__;
}
