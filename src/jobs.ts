import type { Database } from "./db";
import { formatVerificationResult } from "./providers/research";
import type { JobState, ResearchProvider, RunJobInput, TargetField } from "./types";
import { TARGET_FIELDS } from "./types";

const MAX_LOG_ENTRIES = 50;

export class VerificationJobService {
  private cancelRequested = false;
  private activeAbortController: AbortController | null = null;

  private readonly state: JobState = {
    status: "idle",
    startedAt: null,
    finishedAt: null,
    totalRules: 0,
    processedRules: 0,
    totalFieldRuns: 0,
    completedFieldRuns: 0,
    failedFieldRuns: 0,
    skippedFieldRuns: 0,
    overwrite: false,
    errors: [],
    currentRuleId: null,
    currentField: null,
    log: [],
  };

  constructor(
    private readonly db: Database,
    private readonly provider: ResearchProvider,
  ) {}

  getState(): JobState {
    return {
      ...this.state,
      errors: [...this.state.errors],
      log: [...this.state.log],
    };
  }

  canStart(): { ok: true } | { ok: false; statusCode: number; message: string } {
    if (this.state.status === "running" || this.state.status === "stopping") {
      return {
        ok: false,
        statusCode: 409,
        message: "A verification job is already running.",
      };
    }

    const readiness = this.provider.getReadiness();
    if (!readiness.ready) {
      return {
        ok: false,
        statusCode: 503,
        message: readiness.reason ?? "The research provider is not ready.",
      };
    }

    return { ok: true };
  }

  async start(input: RunJobInput): Promise<void> {
    const readiness = this.canStart();
    if (!readiness.ok) {
      throw new Error(readiness.message);
    }

    const rules = await this.db.fetchSourceRules(input.ruleIds);
    this.resetState({
      totalRules: rules.length,
      totalFieldRuns: rules.length * TARGET_FIELDS.length,
      overwrite: input.overwrite,
    });
    this.addLog(`Starting verification job for ${rules.length} rule(s).`);

    try {
      for (const rule of rules) {
        if (this.cancelRequested) {
          this.finishCancelledState();
          return;
        }

        this.state.currentRuleId = rule.rule_id;
        this.addLog(`Syncing ${rule.rule_id} into rule_ai_generation.`);

        if (input.overwrite) {
          await this.db.syncAiRowFromSource(rule.rule_id);
        }

        for (const fieldName of TARGET_FIELDS) {
          if (this.cancelRequested) {
            this.finishCancelledState();
            return;
          }

          this.state.currentField = fieldName;
          const originalValue = rule[fieldName];

          if (!originalValue || !String(originalValue).trim()) {
            this.state.skippedFieldRuns += 1;
            this.addLog(`Skipped ${rule.rule_id}.${fieldName} because the source field is empty.`);
            continue;
          }

          if (!input.overwrite) {
            const existingValue = await this.db.getExistingAiValue(rule.rule_id, fieldName);
            if (existingValue && existingValue.trim()) {
              this.state.skippedFieldRuns += 1;
              this.addLog(`Skipped ${rule.rule_id}.${fieldName} because an AI value already exists.`);
              continue;
            }
          }

          this.addLog(`Verifying ${rule.rule_id}.${fieldName}.`);

          try {
            if (!input.overwrite) {
              await this.db.syncAiRowFromSource(rule.rule_id);
            }

            this.activeAbortController = new AbortController();
            const result = await this.provider.verifyField({
              rule,
              fieldName,
              originalValue,
            }, {
              signal: this.activeAbortController.signal,
            });
            this.activeAbortController = null;

            if (this.cancelRequested) {
              this.addLog(`Stopped before writing ${rule.rule_id}.${fieldName}.`);
              this.finishCancelledState();
              return;
            }

            const formattedValue = formatVerificationResult(result);
            await this.db.updateAiField(rule.rule_id, fieldName, formattedValue);
            this.state.completedFieldRuns += 1;
          } catch (error) {
            this.activeAbortController = null;

            if (this.isAbortError(error)) {
              this.addLog(`Cancelled while verifying ${rule.rule_id}.${fieldName}.`);
              this.finishCancelledState();
              return;
            }

            this.recordFieldFailure(rule.rule_id, fieldName, error);
          }
        }

        this.state.processedRules += 1;
      }

      this.finishState(this.state.failedFieldRuns > 0 ? "completed_with_errors" : "completed");
      this.addLog(`Verification job finished with status ${this.state.status}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state.errors.push({
        rule_id: this.state.currentRuleId,
        field: this.state.currentField,
        message,
      });
      this.addLog(`Job aborted: ${message}`);
      this.finishState("failed");
    }
  }

  stop(): { ok: true } | { ok: false; message: string } {
    if (this.state.status !== "running" && this.state.status !== "stopping") {
      return {
        ok: false,
        message: "There is no active verification job to stop.",
      };
    }

    this.cancelRequested = true;
    this.state.status = "stopping";
    this.addLog("Stop requested. Finishing the current step safely.");
    this.activeAbortController?.abort();

    return { ok: true };
  }

  private resetState(input: { totalRules: number; totalFieldRuns: number; overwrite: boolean }): void {
    this.cancelRequested = false;
    this.activeAbortController = null;
    this.state.status = "running";
    this.state.startedAt = new Date().toISOString();
    this.state.finishedAt = null;
    this.state.totalRules = input.totalRules;
    this.state.processedRules = 0;
    this.state.totalFieldRuns = input.totalFieldRuns;
    this.state.completedFieldRuns = 0;
    this.state.failedFieldRuns = 0;
    this.state.skippedFieldRuns = 0;
    this.state.overwrite = input.overwrite;
    this.state.errors = [];
    this.state.currentRuleId = null;
    this.state.currentField = null;
    this.state.log = [];
  }

  private finishState(status: JobState["status"]): void {
    this.cancelRequested = false;
    this.activeAbortController = null;
    this.state.status = status;
    this.state.finishedAt = new Date().toISOString();
    this.state.currentRuleId = null;
    this.state.currentField = null;
  }

  private finishCancelledState(): void {
    this.addLog("Verification job stopped by user request.");
    this.finishState("cancelled");
  }

  private addLog(message: string): void {
    this.state.log.unshift({
      at: new Date().toISOString(),
      message,
    });
    this.state.log = this.state.log.slice(0, MAX_LOG_ENTRIES);
  }

  private recordFieldFailure(ruleId: string, fieldName: TargetField, error: unknown): void {
    this.state.failedFieldRuns += 1;
    const message = error instanceof Error ? error.message : String(error);
    this.state.errors.push({
      rule_id: ruleId,
      field: fieldName,
      message,
    });
    this.addLog(`Failed ${ruleId}.${fieldName}: ${message}`);
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
  }
}
