export interface AppConfig {
  databaseUrl: string;
  port: number;
  dbMaxConnections: number;
  perplexityApiKey: string | null;
  perplexityModel: string;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(): AppConfig {
  return {
    databaseUrl: requireEnv("DATABASE_URL"),
    port: parseNumber(process.env.PORT, 3000),
    dbMaxConnections: parseNumber(process.env.DB_MAX_CONNECTIONS, 4),
    perplexityApiKey: process.env.PERPLEXITY_API_KEY?.trim() || null,
    perplexityModel: process.env.PERPLEXITY_MODEL?.trim() || "sonar-pro",
  };
}
