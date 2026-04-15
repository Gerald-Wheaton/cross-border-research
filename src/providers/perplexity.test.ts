import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { PerplexityResearchProvider } from "./perplexity";
import type { AppConfig } from "../config";
import type { RuleRow } from "../types";

const config: AppConfig = {
  databaseUrl: "postgres://example",
  port: 3000,
  dbMaxConnections: 1,
  perplexityApiKey: "test-key",
  perplexityModel: "sonar-pro",
  perplexityTimeoutMs: 50,
  perplexityMaxRetries: 2,
};

const rule: RuleRow = {
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

describe("PerplexityResearchProvider", () => {
  test("retries retryable HTTP failures before succeeding", async () => {
    let attempts = 0;
    const provider = new PerplexityResearchProvider(
      config,
      async () => {
        attempts += 1;
        if (attempts < 3) {
          return new Response("busy", { status: 429 });
        }

        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  revised_text: "Verified text",
                  verdict: "correct",
                  authority: "IRS",
                  source_urls: ["https://irs.gov/example"],
                  explanation: "Verified",
                  needs_clarification: "",
                }),
              },
            },
          ],
        });
      },
      async () => {},
    );

    const result = await provider.verifyField({
      rule,
      fieldName: "trigger_condition",
      originalValue: "Original trigger",
    });

    assert.equal(attempts, 3);
    assert.equal(result.revisedText, "Verified text");
  });

  test("times out hung requests", async () => {
    const provider = new PerplexityResearchProvider(
      { ...config, perplexityTimeoutMs: 10, perplexityMaxRetries: 0 },
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
      async () => {},
    );

    await assert.rejects(
      () =>
        provider.verifyField({
        rule,
        fieldName: "legal_source",
        originalValue: "Original source",
      }),
      /Perplexity request timed out\./,
    );
  });
});
