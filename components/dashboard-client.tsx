"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, LoaderCircle, Play, RefreshCcw, Square } from "lucide-react";
import {
  runSingleRuleAction,
  runVerificationJobAction,
  stopVerificationJobAction,
  type ActionResult,
} from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { JobState, ReviewRuleRow, TargetField } from "@/src/types";

interface ProviderInfo {
  name: string;
  ready: boolean;
  reason: string | null;
}

interface DashboardClientProps {
  initialRules: ReviewRuleRow[];
  initialJob: JobState;
  initialRuleId: string | null;
  provider: ProviderInfo;
}

const FIELD_OPTIONS: Array<{ key: TargetField; label: string }> = [
  { key: "trigger_condition", label: "Trigger Condition" },
  { key: "legal_source", label: "Legal Source" },
  { key: "edge_cases", label: "Edge Cases" },
];

export function DashboardClient({
  initialRules,
  initialJob,
  initialRuleId,
  provider,
}: DashboardClientProps) {
  const router = useRouter();
  const [rules, setRules] = useState(initialRules);
  const [job, setJob] = useState(initialJob);
  const [search, setSearch] = useState("");
  const [selectedRuleId, setSelectedRuleId] = useState(
    initialRuleId ?? initialRules[0]?.rule_id ?? null,
  );

  function selectRule(ruleId: string) {
    setSelectedRuleId(ruleId);
    router.replace(`/${encodeURIComponent(ruleId)}`);
  }
  const [selectedField, setSelectedField] = useState<TargetField>("trigger_condition");
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filteredRules = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) {
      return rules;
    }

    return rules.filter((rule) =>
      [rule.rule_id, rule.name, rule.jurisdiction_id, rule.section]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [rules, search]);

  const selectedRule =
    rules.find((rule) => rule.rule_id === selectedRuleId) ?? filteredRules[0] ?? null;

  useEffect(() => {
    if (selectedRule && selectedRule.rule_id !== selectedRuleId) {
      setSelectedRuleId(selectedRule.rule_id);
    }
  }, [selectedRule, selectedRuleId]);

  useEffect(() => {
    if (job.status !== "running" && job.status !== "stopping") {
      return;
    }

    const interval = window.setInterval(async () => {
      const [jobResponse, rulesResponse] = await Promise.all([
        fetch("/api/job", { cache: "no-store" }),
        fetch("/api/rules", { cache: "no-store" }),
      ]);

      const nextJob = (await jobResponse.json()) as JobState;
      const nextRules = (await rulesResponse.json()) as { ok: true; rules: ReviewRuleRow[] };
      setJob(nextJob);
      setRules(nextRules.rules);
    }, 3000);

    return () => window.clearInterval(interval);
  }, [job.status]);

  const selectedFieldLabel =
    FIELD_OPTIONS.find((field) => field.key === selectedField)?.label ?? selectedField;

  const progressPercent =
    job.totalFieldRuns > 0
      ? Math.round(
          ((job.completedFieldRuns + job.failedFieldRuns + job.skippedFieldRuns) / job.totalFieldRuns) * 100,
        )
      : 0;

  const canRun = provider.ready && job.status !== "running" && job.status !== "stopping";
  const canStop = job.status === "running" || job.status === "stopping";

  function resolveField(rule: ReviewRuleRow, prefix: "original" | "ai", field: TargetField) {
    return rule[`${prefix}_${field}` as keyof ReviewRuleRow] as string | null;
  }

  function runAction(action: () => Promise<ActionResult>, successMessage: string) {
    setActionMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setActionMessage(result.error ?? "Something went wrong.");
        return;
      }

      setActionMessage(successMessage);
      const [jobResponse, rulesResponse] = await Promise.all([
        fetch("/api/job", { cache: "no-store" }),
        fetch("/api/rules", { cache: "no-store" }),
      ]);

      setJob((await jobResponse.json()) as JobState);
      setRules(((await rulesResponse.json()) as { ok: true; rules: ReviewRuleRow[] }).rules);
    });
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1500px] flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">
      <Card className="overflow-hidden">
        <CardContent className="grid gap-8 p-8 lg:grid-cols-[1.45fr_0.85fr]">
          <div className="space-y-5">
            <div className="space-y-3">
              <Badge variant="outline" className="border-emerald-700/20 bg-emerald-700/5 text-emerald-800">
                Next.js App Router + Server Actions
              </Badge>
              <h1 className="max-w-4xl font-[family-name:var(--font-display)] text-4xl font-semibold leading-none tracking-tight text-stone-900 md:text-6xl">
                Cross-border rule review, with source text and AI corrections side by side.
              </h1>
              <p className="max-w-3xl text-base leading-7 text-stone-600 md:text-lg">
                This dashboard mirrors every non-<code className="rounded bg-stone-900/5 px-1 py-0.5">CROSS</code> rule
                into <code className="rounded bg-stone-900/5 px-1 py-0.5">rule_ai_generation</code> and verifies
                <code className="mx-1 rounded bg-stone-900/5 px-1 py-0.5">trigger_condition</code>,
                <code className="mx-1 rounded bg-stone-900/5 px-1 py-0.5">legal_source</code>, and
                <code className="ml-1 rounded bg-stone-900/5 px-1 py-0.5">edge_cases</code> with Perplexity.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                onClick={() => runAction(() => runVerificationJobAction(), "Verification job started.")}
                disabled={!canRun || isPending}
                className="min-w-40"
              >
                {isPending ? <LoaderCircle className="animate-spin" /> : <Play />}
                Run All Rules
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  selectedRule
                    ? runAction(
                        () => runSingleRuleAction(selectedRule.rule_id),
                        `Verification started for ${selectedRule.rule_id}.`,
                      )
                    : undefined
                }
                disabled={!canRun || !selectedRule || isPending}
              >
                <RefreshCcw />
                Run Selected Rule
              </Button>
              <Button
                variant="outline"
                onClick={() => runAction(() => stopVerificationJobAction(), "Stop requested.")}
                disabled={!canStop || isPending}
              >
                {isPending && canStop ? <LoaderCircle className="animate-spin" /> : <Square />}
                Stop Run
              </Button>
            </div>
            {actionMessage ? (
              <div className="flex items-start gap-3 rounded-2xl border border-stone-900/10 bg-white/70 px-4 py-3 text-sm text-stone-700">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{actionMessage}</span>
              </div>
            ) : null}
          </div>

          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-4">
              <StatCard label="Queued Rules" value={String(rules.length)} />
              <StatCard label="Job Status" value={job.status} />
              <StatCard label="Completed" value={`${job.completedFieldRuns}/${job.totalFieldRuns || 0}`} />
              <StatCard label="Failures" value={String(job.failedFieldRuns)} />
            </div>
            <Card className="border-stone-900/10 bg-white/70 shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="text-xl">Provider Readiness</CardTitle>
                <CardDescription>
                  The current research backend is <span className="font-medium">{provider.name}</span>.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Badge variant={provider.ready ? "default" : "secondary"} className="w-fit">
                  {provider.ready ? "Ready to run" : "Configuration needed"}
                </Badge>
                <p className="text-sm leading-6 text-stone-600">
                  {provider.ready
                    ? "Perplexity is configured and the job runner can execute field verification."
                    : provider.reason ?? "Provider readiness is unavailable."}
                </p>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
        <Card className="overflow-hidden">
          <CardHeader className="pb-4">
            <CardTitle className="text-2xl">Rules</CardTitle>
            <CardDescription>Browse one rule at a time to keep the review focused.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by id, name, jurisdiction, or section..."
            />
            <div className="max-h-[720px] space-y-3 overflow-y-auto pr-1">
              {filteredRules.map((rule) => {
                const isActive = rule.rule_id === selectedRule?.rule_id;
                const hasAiResult = Boolean(
                  rule.ai_trigger_condition || rule.ai_legal_source || rule.ai_edge_cases,
                );

                return (
                  <button
                    key={rule.rule_id}
                    type="button"
                    onClick={() => selectRule(rule.rule_id)}
                    className={`w-full rounded-[1.2rem] border px-4 py-4 text-left transition ${
                      isActive
                        ? "border-emerald-700/25 bg-emerald-900/[0.04] shadow-sm"
                        : "bg-white/70 hover:bg-white"
                    }`}
                  >
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                        {rule.rule_id}
                      </span>
                      <Badge variant="outline">{rule.jurisdiction_id}</Badge>
                    </div>
                    <div className="text-sm font-semibold leading-6 text-stone-900">{rule.name}</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge variant="secondary">Section {rule.section}</Badge>
                      <Badge variant={hasAiResult ? "default" : "outline"}>
                        {hasAiResult ? "AI reviewed" : "Awaiting review"}
                      </Badge>
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6">
          <Card>
            <CardHeader className="pb-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <CardTitle>{selectedRule?.name ?? "No rule selected"}</CardTitle>
                  <CardDescription>
                    {selectedRule
                      ? `${selectedRule.rule_id} · ${selectedRule.jurisdiction_id} · Section ${selectedRule.section}`
                      : "Pick a rule from the left column to inspect it."}
                  </CardDescription>
                </div>
                {selectedRule ? (
                  <div className="flex flex-wrap items-start gap-2">
                    <Badge variant="outline">{selectedRule.category}</Badge>
                    <Badge variant="secondary">{selectedRule.logic_category ?? "Unspecified logic"}</Badge>
                    <Badge variant="secondary">
                      {selectedRule.ai_verification_status ?? "No AI status yet"}
                    </Badge>
                  </div>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <Tabs value={selectedField} onValueChange={(value: string) => setSelectedField(value as TargetField)}>
                <TabsList>
                  {FIELD_OPTIONS.map((field) => (
                    <TabsTrigger key={field.key} value={field.key}>
                      {field.label}
                    </TabsTrigger>
                  ))}
                </TabsList>

                {FIELD_OPTIONS.map((field) => (
                  <TabsContent key={field.key} value={field.key} className="mt-0">
                    <div className="grid gap-4 xl:grid-cols-2">
                      <ComparisonCard
                        title="Original"
                        subtitle={field.label}
                        content={selectedRule ? resolveField(selectedRule, "original", field.key) : null}
                      />
                      <ComparisonCard
                        title="AI Generated"
                        subtitle={field.label}
                        content={selectedRule ? resolveField(selectedRule, "ai", field.key) : null}
                      />
                    </div>
                  </TabsContent>
                ))}
              </Tabs>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-2xl">Run Progress</CardTitle>
              <CardDescription>
                {job.status === "running"
                  ? `Processing ${job.currentRuleId ?? "next rule"} / ${job.currentField ?? "next field"}`
                  : job.status === "stopping"
                    ? `Stopping ${job.currentRuleId ?? "current rule"} safely.`
                  : "No active job is running right now."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm text-stone-600">
                  <span>{progressPercent}% complete</span>
                  <span>
                    {job.completedFieldRuns + job.failedFieldRuns + job.skippedFieldRuns}/{job.totalFieldRuns || 0}
                  </span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-stone-900/10">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,#d19843_0%,#0f6a5b_100%)] transition-all"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
                    Recent Activity
                  </h3>
                  <div className="max-h-64 space-y-3 overflow-y-auto pr-1">
                    {job.log.length > 0 ? (
                      job.log.map((entry) => (
                        <div key={`${entry.at}-${entry.message}`} className="rounded-2xl border bg-white/70 px-4 py-3">
                          <div className="text-xs uppercase tracking-[0.16em] text-stone-400">
                            {new Date(entry.at).toLocaleString()}
                          </div>
                          <div className="mt-1 text-sm leading-6 text-stone-700">{entry.message}</div>
                        </div>
                      ))
                    ) : (
                      <EmptyState label="No job activity yet." />
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
                    Errors
                  </h3>
                  <div className="max-h-64 space-y-3 overflow-y-auto pr-1">
                    {job.errors.length > 0 ? (
                      job.errors.map((error, index) => (
                        <div
                          key={`${error.rule_id ?? "job"}-${error.field ?? "general"}-${index}`}
                          className="rounded-2xl border border-red-900/10 bg-red-50/80 px-4 py-3"
                        >
                          <div className="text-xs uppercase tracking-[0.16em] text-red-700/70">
                            {(error.rule_id ?? "job").toUpperCase()}
                            {error.field ? ` · ${error.field}` : ""}
                          </div>
                          <div className="mt-1 text-sm leading-6 text-red-900/85">{error.message}</div>
                        </div>
                      ))
                    ) : (
                      <EmptyState label="No errors recorded." />
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.3rem] border bg-white/75 p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">{label}</div>
      <div className="mt-2 text-xl font-semibold text-stone-900">{value}</div>
    </div>
  );
}

function ComparisonCard({
  title,
  subtitle,
  content,
}: {
  title: string;
  subtitle: string;
  content: string | null;
}) {
  return (
    <div className="rounded-[1.5rem] border bg-white/75">
      <div className="space-y-1 border-b px-5 py-4">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">{title}</div>
        <div className="text-lg font-semibold text-stone-900">{subtitle}</div>
      </div>
      <div className="max-h-[440px] overflow-y-auto px-5 py-4">
        {content ? (
          <pre className="whitespace-pre-wrap text-sm leading-7 text-stone-700">{content}</pre>
        ) : (
          <EmptyState label={`No ${title.toLowerCase()} content yet.`} />
        )}
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-[1.2rem] border border-dashed bg-stone-50/80 px-4 py-6 text-sm text-stone-500">
      {label}
    </div>
  );
}
