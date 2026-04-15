import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { VerificationJobService } from "./jobs";
import type { Database } from "./db";
import type { ResearchProvider, RuleRow, VerificationResult } from "./types";

const baseRule: RuleRow = {
  rule_id: "US-001",
  name: "Test rule",
  jurisdiction_id: "US",
  section: "1",
  category: "tax-withholding",
  trigger_condition: "Original trigger",
  calculation_outcome: null,
  legal_source: "Original source",
  edge_cases: "Original edge",
  notes_for_platform: null,
  last_verified: null,
  verification_status: "NEEDS_RESEARCH",
  logic_category: "TREE",
};

function createDb(overrides: Partial<Database> = {}): Database {
  return {
    ensureRuleAiGenerationTable: async () => {},
    fetchRulesForReview: async () => [],
    fetchSourceRules: async () => [baseRule],
    syncAiRowFromSource: async () => {},
    ensureAiRowFromSource: async () => {},
    getExistingAiValue: async () => null,
    updateAiField: async () => {},
    close: async () => {},
    ...overrides,
  };
}

function createProvider(
  verifyField: ResearchProvider["verifyField"],
  readiness: ResearchProvider["getReadiness"] = () => ({ ready: true }),
): ResearchProvider {
  return {
    name: "test-provider",
    getReadiness: readiness,
    verifyField,
  };
}

function successResult(value: string): VerificationResult {
  return {
    revisedText: value,
    verdict: "correct",
    authority: "IRS",
    sourceUrls: ["https://irs.gov/example"],
    explanation: "Verified",
    needsClarification: "",
  };
}

describe("VerificationJobService", () => {
  test("reserves running state before awaiting database reads", async () => {
    let releaseFetch!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });

    const db = createDb({
      fetchSourceRules: async () => {
        await fetchStarted;
        return [baseRule];
      },
    });
    const provider = createProvider(async () => successResult("updated"));
    const service = new VerificationJobService(db, provider);

    const runPromise = service.start({ overwrite: false, ruleIds: null });
    assert.equal(service.getState().status, "running");
    assert.deepEqual(service.canStart(), {
      ok: false,
      statusCode: 409,
      message: "A verification job is already running.",
    });

    releaseFetch();
    await runPromise;
  });

  test("skips fields that already have AI values when overwrite is false", async () => {
    const existingChecks: string[] = [];
    const updatedFields: string[] = [];
    let ensuredRows = 0;

    const db = createDb({
      ensureAiRowFromSource: async () => {
        ensuredRows += 1;
      },
      getExistingAiValue: async (_ruleId, fieldName) => {
        existingChecks.push(fieldName);
        if (fieldName === "trigger_condition") {
          return "Already verified";
        }
        return null;
      },
      updateAiField: async (_ruleId, fieldName) => {
        updatedFields.push(fieldName);
      },
    });

    const provider = createProvider(async ({ fieldName }) => successResult(`updated-${fieldName}`));
    const service = new VerificationJobService(db, provider);

    await service.start({ overwrite: false, ruleIds: null });

    assert.equal(ensuredRows, 1);
    assert.deepEqual(existingChecks, ["trigger_condition", "legal_source", "edge_cases"]);
    assert.deepEqual(updatedFields, ["trigger_condition", "legal_source", "edge_cases"]);
    assert.equal(service.getState().skippedFieldRuns, 0);
  });

  test("does not treat copied source text as completed AI research", async () => {
    const updatedFields: string[] = [];

    const db = createDb({
      getExistingAiValue: async (_ruleId, fieldName) => {
        if (fieldName === "legal_source") {
          return baseRule.legal_source;
        }
        if (fieldName === "edge_cases") {
          return baseRule.edge_cases;
        }
        return null;
      },
      updateAiField: async (_ruleId, fieldName) => {
        updatedFields.push(fieldName);
      },
    });

    const provider = createProvider(async ({ fieldName }) => successResult(`updated-${fieldName}`));
    const service = new VerificationJobService(db, provider);

    await service.start({ overwrite: false, ruleIds: null });

    assert.deepEqual(updatedFields, ["trigger_condition", "legal_source", "edge_cases"]);
    assert.equal(service.getState().skippedFieldRuns, 0);
  });
});
