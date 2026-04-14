export const TARGET_FIELDS = ["trigger_condition", "legal_source", "edge_cases"] as const;

export type TargetField = (typeof TARGET_FIELDS)[number];
export type SupportedJurisdiction = "US" | "IND";
export type VerificationVerdict = "correct" | "partially correct" | "incorrect" | "";
export type JobStatus =
  | "idle"
  | "running"
  | "stopping"
  | "cancelled"
  | "completed"
  | "completed_with_errors"
  | "failed";

export interface RuleRow {
  rule_id: string;
  name: string;
  jurisdiction_id: string;
  section: string;
  category: string;
  trigger_condition: string | null;
  calculation_outcome: string | null;
  legal_source: string | null;
  edge_cases: string | null;
  notes_for_platform: string | null;
  last_verified: string | null;
  verification_status: string;
  logic_category: string | null;
}

export interface ReviewRuleRow {
  rule_id: string;
  name: string;
  jurisdiction_id: string;
  section: string;
  category: string;
  logic_category: string | null;
  verification_status: string;
  last_verified: string | null;
  original_trigger_condition: string | null;
  original_legal_source: string | null;
  original_edge_cases: string | null;
  ai_trigger_condition: string | null;
  ai_legal_source: string | null;
  ai_edge_cases: string | null;
  ai_last_verified: string | null;
  ai_verification_status: string | null;
}

export interface VerificationResult {
  revisedText: string;
  verdict: VerificationVerdict;
  authority: string;
  sourceUrls: string[];
  explanation: string;
  needsClarification: string;
}

export interface VerifyFieldInput {
  rule: RuleRow;
  fieldName: TargetField;
  originalValue: string;
}

export interface ProviderReadiness {
  ready: boolean;
  reason?: string;
}

export interface ResearchProvider {
  readonly name: string;
  getReadiness(): ProviderReadiness;
  verifyField(input: VerifyFieldInput, options?: { signal?: AbortSignal }): Promise<VerificationResult>;
}

export interface JobError {
  rule_id: string | null;
  field: TargetField | null;
  message: string;
}

export interface JobLogEntry {
  at: string;
  message: string;
}

export interface JobState {
  status: JobStatus;
  startedAt: string | null;
  finishedAt: string | null;
  totalRules: number;
  processedRules: number;
  totalFieldRuns: number;
  completedFieldRuns: number;
  failedFieldRuns: number;
  skippedFieldRuns: number;
  overwrite: boolean;
  errors: JobError[];
  currentRuleId: string | null;
  currentField: TargetField | null;
  log: JobLogEntry[];
}

export interface RunJobInput {
  overwrite: boolean;
  ruleIds: string[] | null;
}

export interface ApiErrorResponse {
  ok: false;
  error: string;
}

export interface ApiHealthResponse {
  ok: true;
  hasDatabaseUrl: boolean;
  provider: {
    name: string;
    ready: boolean;
    reason: string | null;
  };
  jobStatus: JobStatus;
}

export interface ApiRulesResponse {
  ok: true;
  rules: ReviewRuleRow[];
}

export interface ApiRunResponse {
  ok: true;
  status: "started";
  overwrite: boolean;
  ruleIds: string[] | null;
}
