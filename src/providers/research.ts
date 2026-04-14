import type { SupportedJurisdiction, VerificationResult } from "../types";

export function assertSupportedJurisdiction(jurisdictionId: string): SupportedJurisdiction {
  if (jurisdictionId === "US" || jurisdictionId === "IND") {
    return jurisdictionId;
  }

  throw new Error(`Unsupported jurisdiction: ${jurisdictionId}`);
}

export function getAllowedDomains(jurisdiction: SupportedJurisdiction): string[] {
  if (jurisdiction === "US") {
    return ["irs.gov", "usa.gov"];
  }

  return ["incometaxindia.gov.in", "rbi.org.in"];
}

export function formatVerificationResult(result: VerificationResult): string {
  const parts = [
    `Verified text:\n${result.revisedText || "No verified text returned."}`,
    `Verdict: ${result.verdict || "unknown"}`,
    `Authority: ${result.authority || "Not provided"}`,
    `Source URLs:\n${result.sourceUrls.length > 0 ? result.sourceUrls.join("\n") : "Not provided"}`,
    `Explanation:\n${result.explanation || "Not provided"}`,
  ];

  if (result.needsClarification) {
    parts.push(`Needs clarification:\n${result.needsClarification}`);
  }

  return parts.join("\n\n");
}
