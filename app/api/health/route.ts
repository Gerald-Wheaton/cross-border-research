import { NextResponse } from "next/server";
import { getAppRuntime } from "@/src/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const runtime = getAppRuntime();
  const readiness = runtime.provider.getReadiness();

  return NextResponse.json({
    ok: true,
    hasDatabaseUrl: Boolean(runtime.config.databaseUrl),
    provider: {
      name: runtime.provider.name,
      ready: readiness.ready,
      reason: readiness.reason ?? null,
    },
    jobStatus: runtime.jobs.getState().status,
  });
}
