"use server";

import { revalidatePath } from "next/cache";
import { getAppRuntime } from "@/src/runtime";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

async function startJob(ruleIds: string[] | null): Promise<ActionResult> {
  const runtime = getAppRuntime();
  await runtime.db.ensureRuleAiGenerationTable();

  const readiness = runtime.jobs.canStart();
  if (!readiness.ok) {
    return {
      ok: false,
      error: readiness.message,
    };
  }

  void runtime.jobs
    .start({
      overwrite: false,
      ruleIds,
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Unhandled job error: ${message}`);
    });

  revalidatePath("/");

  return { ok: true };
}

export async function runVerificationJobAction(): Promise<ActionResult> {
  return startJob(null);
}

export async function runSingleRuleAction(ruleId: string): Promise<ActionResult> {
  const trimmed = ruleId.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: "A rule id is required.",
    };
  }

  return startJob([trimmed]);
}

export async function stopVerificationJobAction(): Promise<ActionResult> {
  const runtime = getAppRuntime();
  const result = runtime.jobs.stop();

  revalidatePath("/");

  if (!result.ok) {
    return {
      ok: false,
      error: result.message,
    };
  }

  return { ok: true };
}
