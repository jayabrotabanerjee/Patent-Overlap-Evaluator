/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface LimitationMapping {
  limitationId: string;
  limitation: string;
  disclosure: string;
  finding: 'Disclosed' | 'Partially Disclosed' | 'Not Found' | 'Inherently Disclosed';
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
