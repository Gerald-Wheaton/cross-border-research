import { NextResponse } from "next/server";
import { getAppRuntime } from "@/src/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const runtime = getAppRuntime();
  await runtime.db.ensureRuleAiGenerationTable();
  const rules = await runtime.db.fetchRulesForReview();

  return NextResponse.json({
    ok: true,
    rules,
  });
}
