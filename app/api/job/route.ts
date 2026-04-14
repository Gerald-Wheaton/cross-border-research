import { NextResponse } from "next/server";
import { getAppRuntime } from "@/src/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const runtime = getAppRuntime();
  return NextResponse.json(runtime.jobs.getState());
}
