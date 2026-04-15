import type { AppConfig } from "../config";
import type {
  ProviderReadiness,
  ResearchProvider,
  VerificationResult,
  VerifyFieldInput,
} from "../types";
import { assertSupportedJurisdiction, getAllowedDomains } from "./research";

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

type FetchLike = typeof fetch;
type SleepFn = (ms: number) => Promise<void>;

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

  constructor(
    private readonly config: AppConfig,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly sleep: SleepFn = defaultSleep,
  ) {}

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

    const requestBody = JSON.stringify({
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
    });

    const maxAttempts = Math.max(1, this.config.perplexityMaxRetries + 1);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => {
        timeoutController.abort(new Error("Perplexity request timed out."));
      }, this.config.perplexityTimeoutMs);

      const cleanup = linkAbortSignals(options?.signal, timeoutController);

      try {
        const response = await this.fetchImpl(PERPLEXITY_API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.perplexityApiKey}`,
            "Content-Type": "application/json",
          },
          body: requestBody,
          signal: timeoutController.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          const error = new Error(`Perplexity API error ${response.status}: ${errorText}`);
          if (attempt < maxAttempts && RETRYABLE_STATUS_CODES.has(response.status)) {
            await this.sleep(getRetryDelayMs(attempt));
            continue;
          }
          throw error;
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
      } catch (error) {
        if (isAbortError(error)) {
          const abortReason = options?.signal?.aborted
            ? options.signal.reason
            : new Error("Perplexity request timed out.");
          throw abortReason instanceof Error ? abortReason : new Error(String(abortReason));
        }

        if (attempt < maxAttempts && isRetryableError(error)) {
          await this.sleep(getRetryDelayMs(attempt));
          continue;
        }

        throw error;
      } finally {
        clearTimeout(timeoutId);
        cleanup();
      }
    }

    throw new Error("Perplexity request failed after retries.");
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelayMs(attempt: number): number {
  return Math.min(1_000 * 2 ** (attempt - 1), 5_000);
}

function linkAbortSignals(parentSignal: AbortSignal | undefined, childController: AbortController): () => void {
  if (!parentSignal) {
    return () => {};
  }

  if (parentSignal.aborted) {
    childController.abort(parentSignal.reason);
    return () => {};
  }

  const onAbort = () => childController.abort(parentSignal.reason);
  parentSignal.addEventListener("abort", onAbort, { once: true });
  return () => parentSignal.removeEventListener("abort", onAbort);
}

function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === "AbortError";
}

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /Perplexity API error (408|429|500|502|503|504):/.test(error.message);
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
