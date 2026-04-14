import type { AppConfig } from "../config";
import type {
  ProviderReadiness,
  ResearchProvider,
  VerificationResult,
  VerifyFieldInput,
} from "../types";
import { assertSupportedJurisdiction, getAllowedDomains } from "./research";

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";

interface PerplexityMessage {
  content?: unknown;
}

interface PerplexityChoice {
  message?: PerplexityMessage;
}

interface PerplexityResponseBody {
  choices?: PerplexityChoice[];
}

interface ParsedPerplexityResult {
  revised_text?: unknown;
  verdict?: unknown;
  authority?: unknown;
  source_urls?: unknown;
  explanation?: unknown;
  needs_clarification?: unknown;
}

export class PerplexityResearchProvider implements ResearchProvider {
  readonly name = "perplexity";

  constructor(private readonly config: AppConfig) {}

  getReadiness(): ProviderReadiness {
    if (!this.config.perplexityApiKey) {
      return {
        ready: false,
        reason: "Missing PERPLEXITY_API_KEY in environment.",
      };
    }

    return { ready: true };
  }

  async verifyField(
    input: VerifyFieldInput,
    options?: { signal?: AbortSignal },
  ): Promise<VerificationResult> {
    const readiness = this.getReadiness();
    if (!readiness.ready) {
      throw new Error(readiness.reason);
    }

    const jurisdiction = assertSupportedJurisdiction(input.rule.jurisdiction_id);
    const allowedDomains = getAllowedDomains(jurisdiction);

    const requestInit: RequestInit = {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.perplexityApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.perplexityModel,
        temperature: 0.1,
        search_mode: "web",
        messages: [
          {
            role: "system",
            content:
              "You are a tax verification assistant. Use only the allowed official domains and respond with valid JSON only.",
          },
          {
            role: "user",
            content: buildFieldPrompt(input, allowedDomains),
          },
        ],
        web_search_options: {
          search_domain_filter: allowedDomains,
        },
      }),
    };

    if (options?.signal) {
      requestInit.signal = options.signal;
    }

    const response = await fetch(PERPLEXITY_API_URL, requestInit);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Perplexity API error ${response.status}: ${errorText}`);
    }

    const payload = (await response.json()) as PerplexityResponseBody;
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("Perplexity response did not include message content.");
    }

    const parsed = parsePerplexityJson(content);
    if (!parsed) {
      throw new Error(
        `Perplexity returned non-JSON content for ${input.rule.rule_id} ${input.fieldName}.`,
      );
    }

    return {
      revisedText: typeof parsed.revised_text === "string" ? parsed.revised_text.trim() : "",
      verdict: normalizeVerdict(parsed.verdict),
      authority: typeof parsed.authority === "string" ? parsed.authority.trim() : "",
      sourceUrls: Array.isArray(parsed.source_urls)
        ? parsed.source_urls.map((item) => String(item).trim()).filter(Boolean)
        : [],
      explanation: typeof parsed.explanation === "string" ? parsed.explanation.trim() : "",
      needsClarification:
        typeof parsed.needs_clarification === "string" ? parsed.needs_clarification.trim() : "",
    };
  }
}

function buildFieldPrompt(input: VerifyFieldInput, allowedDomains: string[]): string {
  const regionLabel = input.rule.jurisdiction_id === "US" ? "U.S." : "India";

  return `
Verify the following tax statement against official sources only.

Jurisdiction: ${regionLabel}
Rule ID: ${input.rule.rule_id}
Rule name: ${input.rule.name}
Section: ${input.rule.section}
Field being verified: ${input.fieldName}

Original statement:
${input.originalValue}

Instructions:
- Search only these domains: ${allowedDomains.join(", ")}
- Ignore all other sources.
- Focus on verifying and correcting the original statement, not just summarizing it.
- If the original statement mixes correct and incorrect claims, rewrite it into a verified version.
- If the statement is ambiguous, explain exactly what needs clarification.
- Return valid JSON only with this shape:
{
  "revised_text": "the corrected or confirmed field value",
  "verdict": "correct | partially correct | incorrect",
  "authority": "section, rule, circular, notification, or page title",
  "source_urls": ["https://..."],
  "explanation": "short explanation grounded in the official sources",
  "needs_clarification": "optional clarification note or empty string"
}
`.trim();
}

function stripMarkdownFence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function parsePerplexityJson(value: string): ParsedPerplexityResult | null {
  try {
    return JSON.parse(stripMarkdownFence(value)) as ParsedPerplexityResult;
  } catch {
    return null;
  }
}

function normalizeVerdict(value: unknown): VerificationResult["verdict"] {
  if (value === "correct" || value === "partially correct" || value === "incorrect") {
    return value;
  }

  return "";
}
