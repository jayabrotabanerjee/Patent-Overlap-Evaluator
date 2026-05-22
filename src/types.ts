/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type LimitationFinding =
  | "Disclosed"
  | "Partially Disclosed"
  | "Not Found"
  | "Inherently Disclosed";

export type SupportType =
  | "direct"
  | "implicit"
  | "combination"
  | "inferred"
  | "missing"
  | "contradicted";

export interface EvidenceSnippet {
  quote: string;
  location?: string;
  explanation: string;
}

export interface LimitationMapping {
  limitationId: string;
  limitation: string;
  disclosure: string;
  finding: LimitationFinding;

  // Optional structured-analysis fields from the newer backend.
  elementId?: string;
  claimElement?: string;
  normalizedRequirement?: string;
  supportType?: SupportType;
  score?: number;
  confidence?: number;
  gap?: string;
  evidence?: EvidenceSnippet[];
}

export interface StrengthJudgment {
  conclusion: string;
  rationale: string;
  strategicRecommendation: string;
}

export interface EvaluationReport {
  id: string;
  timestamp: string;
  claimNumber: string;
  claimText: string;
  referenceCitation: string;
  referenceText: string;
  mapping: LimitationMapping[];
  strengthJudgment: StrengthJudgment;
}

export interface PreloadedExample {
  id: string;
  name: string;
  claimNumber: string;
  claimText: string;
  referenceCitation: string;
  referenceText: string;
  relevantSections?: string;
}
