/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { BookOpen, AlertCircle, FileSearch, HelpCircle } from "lucide-react";
import { PRELOADED_EXAMPLES } from "../examplesData";

interface EvaluationFormProps {
  onEvaluate: (data: {
    claimNumber: string;
    claimText: string;
    referenceCitation: string;
    referenceText: string;
    relevantSections?: string;
  }) => Promise<void>;
  isLoading: boolean;
}

export function EvaluationForm({ onEvaluate, isLoading }: EvaluationFormProps) {
  const [claimNumber, setClaimNumber] = useState("Claim 1");
  const [claimText, setClaimText] = useState("");
  const [referenceCitation, setReferenceCitation] = useState("");
  const [referenceText, setReferenceText] = useState("");
  const [relevantSections, setRelevantSections] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Loading message cycling
  const [loadingStep, setLoadingStep] = useState(0);
  const loadingSteps = [
    "Awaiting Analyst Feed...",
    "Activating Prior Art Overlap Evaluator Persona...",
    "Claim Parsing: Parsing target claim into unique structural limitations...",
    "Evidence Scanning: Mapping disclosures against parsed limit statements...",
    "Gap Identification: Rigorously screening prior art for missing elements...",
    "Synthesizing Judgment: Calibrating regulatory standards (§102 / §103)..."
  ];

  useEffect(() => {
    let interval: any;
    if (isLoading) {
      interval = setInterval(() => {
        setLoadingStep((prev) => (prev + 1) % loadingSteps.length);
      }, 3500);
    } else {
      setLoadingStep(0);
    }
    return () => clearInterval(interval);
  }, [isLoading]);

  const loadExample = (exampleId: string) => {
    const ex = PRELOADED_EXAMPLES.find((e) => e.id === exampleId);
    if (ex) {
      setClaimNumber(ex.claimNumber);
      setClaimText(ex.claimText);
      setReferenceCitation(ex.referenceCitation);
      setReferenceText(ex.referenceText);
      setRelevantSections(ex.relevantSections || "");
      setErrorMsg(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!claimText.trim()) {
      setErrorMsg("Target Patent Claim text cannot be blank.");
      return;
    }
    if (!referenceCitation.trim()) {
      setErrorMsg("Prior Art Reference citation is required (e.g., 'Smith '123').");
      return;
    }
    if (!referenceText.trim()) {
      setErrorMsg("Prior Art Reference text details are required for mapping analysis.");
      return;
    }

    setErrorMsg(null);
    onEvaluate({
      claimNumber,
      claimText,
      referenceCitation,
      referenceText,
      relevantSections: relevantSections.trim() || undefined,
    });
  };

  return (
    <div className="rounded-lg border border-slate-300 bg-white shadow-sm overflow-hidden" id="evaluation-form-card">
      
      {/* Header Panel block */}
      <div className="border-b border-slate-300 bg-slate-50 px-4 py-2.5 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-slate-700" />
          <h2 className="text-xs font-bold uppercase text-slate-600 tracking-wider">
            Evaluation Dossier Entry
          </h2>
        </div>
        <span className="text-[10px] font-mono text-slate-400">
          Paste Custom Patent Elements
        </span>
      </div>

      <div className="p-4 sm:p-5 space-y-5">
        
        {/* Quick Load panel of Case Files in micro pills */}
        <div>
          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
            Load Preloaded Dossiers
          </span>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {PRELOADED_EXAMPLES.map((ex) => (
              <button
                key={ex.id}
                type="button"
                id={`btn-example-${ex.id}`}
                onClick={() => loadExample(ex.id)}
                className="flex flex-col items-start rounded border border-slate-200 bg-slate-50 p-2 text-left transition hover:border-blue-500 hover:bg-slate-100/70 focus:outline-none cursor-pointer"
              >
                <span className="text-xs font-bold text-slate-800 font-sans truncate w-full">
                  {ex.name}
                </span>
                <span className="mt-0.5 text-[9px] text-slate-500 truncate w-full font-mono">
                  {ex.referenceCitation}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Input Form Fields */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            
            {/* Target Claim Statement Input Form */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <label htmlFor="claim-number-input" className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Target Patent Claim ID
                </label>
                <input
                  type="text"
                  id="claim-number-input"
                  value={claimNumber}
                  onChange={(e) => setClaimNumber(e.target.value)}
                  placeholder="e.g., Claim 1"
                  className="rounded border border-slate-300 px-2 py-1 text-xs font-mono text-slate-800 placeholder-slate-450 focus:border-blue-500 focus:outline-none"
                />
              </div>
              
              <div>
                <label htmlFor="claim-text-textarea" className="sr-only">Patent Claim text</label>
                <textarea
                  id="claim-text-textarea"
                  value={claimText}
                  onChange={(e) => setClaimText(e.target.value)}
                  placeholder="Paste the full, specific patent claim limitation text here..."
                  rows={8}
                  className="block w-full rounded border border-slate-300 p-2.5 text-xs font-mono text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:outline-none bg-slate-50/20"
                />
              </div>
              
              <div className="flex items-start gap-1.5 text-[10px] text-slate-500">
                <HelpCircle className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" />
                <span>Format recommendation: Break down sub-limitations with semicolons or indentations to assist AI parsing.</span>
              </div>
            </div>

            {/* Prior Art Citation & Text Form */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <label htmlFor="ref-citation-input" className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Prior Art Reference Citation
                </label>
                <input
                  type="text"
                  id="ref-citation-input"
                  value={referenceCitation}
                  onChange={(e) => setReferenceCitation(e.target.value)}
                  placeholder="e.g., Smith '123, col. 4, lines 5-7"
                  className="rounded border border-slate-300 px-2.5 py-1 text-xs font-mono text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:outline-none w-full max-w-[200px]"
                />
              </div>

              <div>
                <label htmlFor="ref-text-textarea" className="sr-only">Prior Art text</label>
                <textarea
                  id="ref-text-textarea"
                  value={referenceText}
                  onChange={(e) => setReferenceText(e.target.value)}
                  placeholder="Paste the relevant prior art text disclosures, descriptions, figures text transcripts or description here..."
                  rows={5}
                  className="block w-full rounded border border-slate-300 p-2.5 text-xs text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:outline-none bg-slate-50/20"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="relevant-sections" className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Specific Sections of Interest (Optional)
                </label>
                <input
                  type="text"
                  id="relevant-sections"
                  value={relevantSections}
                  onChange={(e) => setRelevantSections(e.target.value)}
                  placeholder="e.g., Page 4, Column 2, Line 15 or Fig 3"
                  className="block w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

          </div>

          {/* Error Feed */}
          {errorMsg && (
            <div className="flex items-center gap-2 rounded bg-rose-50 p-3 text-xs text-rose-800 border border-rose-200" id="form-error-banner">
              <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Submit Action Block */}
          <div className="flex border-t border-slate-200 pt-3 justify-end">
            <button
              type="submit"
              disabled={isLoading}
              id="btn-trigger-evaluate"
              className={`w-full sm:w-auto flex items-center justify-center gap-2 rounded bg-slate-900 border border-slate-950 text-white px-5 py-2.5 text-xs font-bold uppercase tracking-widest hover:bg-slate-800 transition cursor-pointer ${
                isLoading ? "opacity-70 cursor-not-allowed" : ""
              }`}
            >
              {isLoading ? (
                <>
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span className="font-bold animate-pulse font-mono tracking-tight">{loadingSteps[loadingStep]}</span>
                </>
              ) : (
                <>
                  <FileSearch className="h-3.5 w-3.5" />
                  <span>Analyze Claim Overlap</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default EvaluationForm;
