import { DashboardClient } from "@/components/dashboard-client";
import { getAppRuntime } from "@/src/runtime";

export const dynamic = "force-dynamic";

interface RulePageProps {
  params: Promise<{ ruleId: string }>;
}

export default async function RulePage({ params }: RulePageProps) {
  const { ruleId } = await params;
  const runtime = getAppRuntime();
  await runtime.db.ensureRuleAiGenerationTable();

  const [rules, jobState] = await Promise.all([
    runtime.db.fetchRulesForReview(),
    Promise.resolve(runtime.jobs.getState()),
  ]);

  const readiness = runtime.provider.getReadiness();

  return (
    <DashboardClient
      initialRules={rules}
      initialJob={jobState}
      initialRuleId={decodeURIComponent(ruleId)}
      provider={{
        name: runtime.provider.name,
        ready: readiness.ready,
        reason: readiness.reason ?? null,
      }}
    />
  );
}
