/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import {
  Archive,
  User,
  Sparkles,
  FolderOpen,
  RefreshCw,
  ChevronRight,
  FileCheck,
  Layers,
  Scale,
  AlertOctagon,
} from "lucide-react";

import { Header } from "./components/Header";
import { EvaluationForm } from "./components/EvaluationForm";
import { ReportViewer } from "./components/ReportViewer";
import { ClaimMatrix } from "./components/ClaimMatrix";
import { EvaluationReport } from "./types";

type SupportType =
  | "direct"
  | "implicit"
  | "combination"
  | "inferred"
  | "missing"
  | "contradicted";

type ApiEvidence = {
  quote: string;
  location?: string;
  explanation: string;
};

type ApiClaimElement = {
  elementId: string;
  claimElement: string;
  normalizedRequirement: string;
  supportType: SupportType;
  score: number;
  evidence: ApiEvidence[];
  gap: string;
  confidence: number;
};

type PatentOverlapApiResponse = {
  claimId?: string;
  referenceId?: string;
  overallScore: number;
  shortlistDecision: "SHORTLIST" | "REVIEW" | "REJECT";
  allCriticalElementsSupported: boolean;
  weakestElementId: string;
  noveltyRisk: "high" | "medium" | "low";
  implementationRelevance: "high" | "medium" | "low";
  claimChart: ApiClaimElement[];
  keyReasons: string[];
  missingLimitations: string[];
  recommendedNextStep:
    | "prepare_full_claim_chart"
    | "run_secondary_reference_search"
    | "review_by_human_analyst"
    | "reject_from_shortlist";
  analystSummary: string;
};

type EvaluationFormData = {
  claimNumber: string;
  claimText: string;
  referenceCitation: string;
  referenceText: string;
  relevantSections?: string;
};

const STORAGE_KEY = "patent_analyst_sessions";

function formatTimestamp() {
  const now = new Date();

  return (
    now.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short",
    }) +
    " on " +
    now.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  );
}

function mapSupportTypeToFinding(supportType: SupportType) {
  switch (supportType) {
    case "direct":
      return "Disclosed";
    case "implicit":
      return "Inherently Disclosed";
    case "combination":
      return "Partially Disclosed";
    case "inferred":
      return "Partially Disclosed";
    case "contradicted":
      return "Contradicted";
    case "missing":
    default:
      return "Not Disclosed";
  }
}

function buildEvidenceText(evidence: ApiEvidence[]) {
  if (!evidence || evidence.length === 0) {
    return "No supporting quote identified.";
  }

  return evidence
    .map((item, index) => {
      const location = item.location ? ` (${item.location})` : "";
      return `${index + 1}. "${item.quote}"${location}\n${item.explanation}`;
    })
    .join("\n\n");
}

function buildStrategicRecommendation(apiResult: PatentOverlapApiResponse) {
  const reasons =
    apiResult.keyReasons && apiResult.keyReasons.length > 0
      ? apiResult.keyReasons.map((reason) => `• ${reason}`).join("\n")
      : "No key reasons returned.";

  const missing =
    apiResult.missingLimitations && apiResult.missingLimitations.length > 0
      ? apiResult.missingLimitations
          .map((limitation) => `• ${limitation}`)
          .join("\n")
      : "No missing limitations identified.";

  return [
    `Shortlist Decision: ${apiResult.shortlistDecision}`,
    `Recommended Next Step: ${apiResult.recommendedNextStep}`,
    `All Critical Elements Supported: ${
      apiResult.allCriticalElementsSupported ? "Yes" : "No"
    }`,
    `Weakest Element: ${apiResult.weakestElementId || "N/A"}`,
    `Novelty Risk: ${apiResult.noveltyRisk}`,
    `Implementation Relevance: ${apiResult.implementationRelevance}`,
    "",
    "Key Reasons:",
    reasons,
    "",
    "Missing Limitations:",
    missing,
  ].join("\n");
}

function mapApiResultToEvaluationReport(
  apiResult: PatentOverlapApiResponse,
  formData: EvaluationFormData
): EvaluationReport {
  const mapping = apiResult.claimChart.map((element, index) => {
    const evidenceText = buildEvidenceText(element.evidence);
    const finding = mapSupportTypeToFinding(element.supportType);

    return {
      id: element.elementId || `element_${index + 1}`,
      elementId: element.elementId || `element_${index + 1}`,

      limitation: element.claimElement,
      claimElement: element.claimElement,
      normalizedRequirement: element.normalizedRequirement,

      referenceDisclosure: evidenceText,
      evidence: element.evidence,

      finding,
      supportType: element.supportType,

      score: element.score,
      confidence: element.confidence,

      analysis: [
        `Support Type: ${element.supportType}`,
        `Score: ${element.score}/3`,
        `Confidence: ${Math.round(element.confidence * 100)}%`,
        "",
        `Gap / Caveat: ${element.gap || "No material gap stated."}`,
      ].join("\n"),

      gap: element.gap,
    } as EvaluationReport["mapping"][number];
  });

  return {
    id: `rep_${Date.now()}`,
    timestamp: formatTimestamp(),

    claimNumber: apiResult.claimId || formData.claimNumber || "Claim 1",
    claimText: formData.claimText,

    referenceCitation:
      apiResult.referenceId || formData.referenceCitation || "Prior Art Reference",
    referenceText: formData.referenceText,

    mapping,

    strengthJudgment: {
      conclusion: `${apiResult.shortlistDecision} — Overall Score ${apiResult.overallScore}/100`,
      rationale:
        apiResult.analystSummary ||
        "The analysis completed, but no analyst summary was returned.",
      strategicRecommendation: buildStrategicRecommendation(apiResult),
    },
  };
}

function getDisclosedCount(report: EvaluationReport) {
  return report.mapping.filter(
    (item: any) =>
      item.finding === "Disclosed" ||
      item.finding === "Inherently Disclosed"
  ).length;
}

export default function App() {
  const [reports, setReports] = useState<EvaluationReport[]>([]);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"dossier" | "report" | "matrix">(
    "dossier"
  );
  const [isLoading, setIsLoading] = useState(false);
  const [systemError, setSystemError] = useState<{
    title: string;
    desc: string;
  } | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);

      if (!stored) {
        return;
      }

      const parsed = JSON.parse(stored) as EvaluationReport[];

      if (Array.isArray(parsed) && parsed.length > 0) {
        setReports(parsed);
        setActiveReportId(parsed[0].id);
        setActiveTab("report");
      }
    } catch (error) {
      console.error("Local storage sync error:", error);
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const saveReports = (newReports: EvaluationReport[]) => {
    setReports(newReports);

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newReports));
    } catch (error) {
      console.error("Local storage save error:", error);
      setSystemError({
        title: "Local Storage Error",
        desc: "The report was generated, but the browser could not save it locally. Try clearing older sessions or browser storage.",
      });
    }
  };

  const handleEvaluate = async (formData: EvaluationFormData) => {
    setIsLoading(true);
    setSystemError(null);

    try {
      if (!formData.claimText?.trim()) {
        throw new Error("Claim text is required before running analysis.");
      }

      if (!formData.referenceText?.trim()) {
        throw new Error("Prior art reference text is required before running analysis.");
      }

      const response = await fetch("/api/analyze-overlap", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          claimId: formData.claimNumber || "Claim 1",
          referenceId: formData.referenceCitation || "Prior Art Reference",
          claimText: formData.claimText,
          priorArtText: formData.referenceText,
          productOrFeatureContext:
            formData.relevantSections ||
            "Analyze for element-by-element patent claim overlap and implementation relevance.",
        }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => null);

        throw new Error(
          errJson?.message ||
            errJson?.error ||
            `Server responded with status code ${response.status}.`
        );
      }

      const apiResult = (await response.json()) as PatentOverlapApiResponse;

      if (!apiResult || !Array.isArray(apiResult.claimChart)) {
        throw new Error(
          "The analysis server returned an invalid response. Expected a claimChart array."
        );
      }

      const freshReport = mapApiResultToEvaluationReport(apiResult, formData);

      const updated = [freshReport, ...reports];
      saveReports(updated);

      setActiveReportId(freshReport.id);
      setActiveTab("report");
    } catch (error: any) {
      console.error("API Evaluation request failed:", error);

      const message = error?.message || "Unknown evaluation failure.";
      const isApiRouteMissing =
        message.includes("404") ||
        message.includes("Failed to fetch") ||
        message.includes("NetworkError");

      setSystemError({
        title: isApiRouteMissing
          ? "Analysis API Route Not Available"
          : "Evaluation System Error",
        desc: isApiRouteMissing
          ? "The frontend could not reach /api/analyze-overlap. Add the server-side Gemini route first, then retry."
          : message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteReport = (id: string) => {
    const filtered = reports.filter((report) => report.id !== id);
    saveReports(filtered);

    if (activeReportId === id) {
      if (filtered.length > 0) {
        setActiveReportId(filtered[0].id);
        setActiveTab("report");
      } else {
        setActiveReportId(null);
        setActiveTab("dossier");
      }
    }
  };

  const handleClearSession = () => {
    const confirmed = window.confirm(
      "Are you sure you want to completely flush the active patent analysis workspace? This deletes all mapped charts."
    );

    if (!confirmed) {
      return;
    }

    saveReports([]);
    setActiveReportId(null);
    setActiveTab("dossier");
    setSystemError(null);
  };

  const activeReport = reports.find((report) => report.id === activeReportId);

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans overflow-x-hidden">
      <Header activeReport={activeReport} />

      <main className="flex-grow mx-auto max-w-7xl w-full px-4 py-4 sm:px-6 flex flex-col gap-4 lg:flex-row">
        <section
          className="lg:w-1/4 flex flex-col gap-4 shrink-0"
          aria-label="Analyst Workplace Logs"
          id="workplace-side-panel"
        >
          <div className="rounded border border-slate-300 bg-white p-3 shadow-sm flex items-center gap-3">
            <div className="h-8 w-8 rounded bg-slate-900 flex items-center justify-center shrink-0">
              <User className="h-4 w-4 text-blue-400" />
            </div>

            <div>
              <span className="block text-[9px] font-bold tracking-wider text-slate-500 uppercase">
                Active Desk
              </span>
              <h3 className="text-xs font-bold text-slate-900 truncate max-w-[150px]">
                Patent Analyst Workspace
              </h3>
            </div>
          </div>

          <div className="rounded border border-slate-300 bg-white shadow-sm flex flex-col overflow-hidden max-h-[420px]">
            <div className="border-b border-slate-300 p-2.5 bg-slate-50 flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1">
                <FolderOpen className="h-3.5 w-3.5 text-slate-500" />
                Session Dossiers ({reports.length})
              </span>

              {reports.length > 0 && (
                <button
                  onClick={handleClearSession}
                  id="btn-clear-session"
                  className="rounded p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                  title="Flush and wipe active analyst desk"
                >
                  <RefreshCw className="h-3 w-3" />
                </button>
              )}
            </div>

            <div className="overflow-y-auto p-1.5 space-y-1 bg-slate-50/30">
              {reports.length === 0 ? (
                <div className="p-4 text-center space-y-2">
                  <Archive className="h-6 w-6 text-slate-300 mx-auto" />
                  <p className="text-[10px] text-slate-400 font-mono leading-normal">
                    [Analyst Desk empty. Feed case dossier block to begin mapping.]
                  </p>
                </div>
              ) : (
                reports.map((report) => {
                  const isCurrent = report.id === activeReportId;
                  const disclosedCount = getDisclosedCount(report);
                  const totalCount = report.mapping.length;

                  return (
                    <button
                      key={report.id}
                      id={`session-log-item-${report.id}`}
                      onClick={() => {
                        setActiveReportId(report.id);
                        setActiveTab("report");
                      }}
                      className={`w-full text-left rounded p-2 transition flex items-center justify-between border cursor-pointer focus:outline-none ${
                        isCurrent
                          ? "bg-slate-900 border-slate-950 text-white font-bold"
                          : "bg-white hover:bg-slate-100 border-slate-200 text-slate-700"
                      }`}
                    >
                      <div className="min-w-0 flex-grow pr-1">
                        <div
                          className={`flex items-center gap-1 text-[9px] ${
                            isCurrent ? "text-slate-400" : "text-slate-500"
                          } font-medium`}
                        >
                          <span>{report.claimNumber}</span>
                          <span>•</span>
                          <span className="truncate">
                            {report.referenceCitation}
                          </span>
                        </div>

                        <h4
                          className={`text-xs font-semibold truncate ${
                            isCurrent ? "text-white" : "text-slate-900"
                          }`}
                        >
                          {report.referenceCitation}
                        </h4>

                        <div
                          className={`flex items-center gap-1 text-[8px] font-mono mt-0.5 ${
                            isCurrent ? "text-blue-300" : "text-slate-400"
                          }`}
                        >
                          <span>
                            {disclosedCount}/{totalCount} limitations covered
                          </span>
                        </div>
                      </div>

                      <ChevronRight
                        className={`h-3.5 w-3.5 shrink-0 transition ${
                          isCurrent
                            ? "text-blue-400 translate-x-0.5"
                            : "text-slate-300"
                        }`}
                      />
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded border border-slate-300 bg-slate-50 p-3 space-y-1.5 text-[10px] text-slate-600 shadow-sm leading-normal">
            <h5 className="font-bold text-slate-800 uppercase tracking-widest flex items-center gap-1 leading-none border-b border-slate-250 pb-1.5 mb-1">
              <Scale className="h-3 w-3 text-slate-500" />
              Prior Art Interpretation Rules
            </h5>

            <ol className="list-decimal list-inside space-y-1 text-slate-500 font-sans">
              <li>
                <strong>Anticipation (§102)</strong>: A single active reference
                explicitly discloses every claimed limitation.
              </li>
              <li>
                <strong>Obviousness (§103)</strong>: Multiple references are
                combined to cover all limitations synergistically.
              </li>
            </ol>
          </div>
        </section>

        <section
          className="flex-grow lg:w-3/4 flex flex-col gap-4"
          aria-label="Analytical Stage"
        >
          <div
            className="flex bg-slate-200 p-1 rounded border border-slate-300 shadow-sm"
            id="workspace-navigation-tabs"
          >
            <button
              onClick={() => setActiveTab("dossier")}
              id="tab-btn-dossier"
              className={`flex-1 flex items-center justify-center gap-1.5 rounded py-2 text-[10px] font-bold uppercase tracking-widest transition cursor-pointer ${
                activeTab === "dossier"
                  ? "bg-slate-900 text-white shadow"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              <span>1. Case Dossier Feed</span>
            </button>

            <button
              onClick={() => {
                if (reports.length > 0) {
                  setActiveTab("report");
                }
              }}
              disabled={reports.length === 0}
              id="tab-btn-report"
              className={`flex-1 flex items-center justify-center gap-1.5 rounded py-2 text-[10px] font-bold uppercase tracking-widest transition cursor-pointer ${
                reports.length === 0
                  ? "opacity-40 cursor-not-allowed text-slate-400"
                  : ""
              } ${
                activeTab === "report"
                  ? "bg-slate-900 text-white shadow"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <FileCheck className="h-3.5 w-3.5" />
              <span>2. Report Synthesis Desk</span>
            </button>

            <button
              onClick={() => {
                if (reports.length >= 2) {
                  setActiveTab("matrix");
                }
              }}
              disabled={reports.length < 2}
              id="tab-btn-matrix"
              className={`flex-1 flex items-center justify-center gap-1.5 rounded py-2 text-[10px] font-bold uppercase tracking-widest transition cursor-pointer ${
                reports.length < 2
                  ? "opacity-40 cursor-not-allowed text-slate-400"
                  : ""
              } ${
                activeTab === "matrix"
                  ? "bg-slate-900 text-white shadow"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>3. Side-by-Side Matrix</span>
            </button>
          </div>

          {systemError && (
            <div
              className="rounded border border-rose-300 bg-rose-50 p-4 shadow-sm space-y-2 flex items-start gap-3 border-l-4 border-l-rose-500"
              id="system-failure-banner"
            >
              <AlertOctagon className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />

              <div className="space-y-1">
                <h4 className="text-xs font-bold text-rose-950 uppercase tracking-tight">
                  {systemError.title}
                </h4>

                <p className="text-xs text-rose-900 leading-relaxed font-sans">
                  {systemError.desc}
                </p>

                <div className="flex items-center gap-1.5 pt-1">
                  <div className="inline-flex items-center gap-1 rounded bg-rose-100 px-2 py-0.5 text-[9px] font-bold text-rose-800 uppercase font-mono">
                    Action Required
                  </div>

                  <span className="text-[10px] text-rose-600 font-sans">
                    Confirm the server endpoint exists and that GEMINI_API_KEY
                    is configured server-side.
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="transition-all duration-300">
            {activeTab === "dossier" && (
              <div className="space-y-5">
                {reports.length === 0 && (
                  <div
                    className="rounded border border-slate-300 bg-white p-5 shadow-sm space-y-3"
                    id="analyst-intro-splash"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5 text-[9px] font-semibold text-blue-600 uppercase tracking-widest font-mono">
                        <Sparkles className="h-3 w-3" />
                        Analysis Persona Active
                      </div>

                      <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider font-sans">
                        Court-Grade Element-by-Element Evidence Overlap Mapping.
                      </h2>

                      <p className="text-xs text-slate-600 leading-relaxed font-sans">
                        Welcome to the Overlap Evaluation Workspace. This system
                        deconstructs target patent claims into rigid limiting
                        statements, maps active text segments parsed objectively
                        from prior art references, displays technical overlays,
                        and formats strategic responses.
                      </p>
                    </div>

                    <div className="flex border-t border-slate-200 pt-2 items-center gap-2 text-[10px] font-semibold text-slate-500">
                      <span>Quick Guidance:</span>
                      <span className="text-slate-400 font-medium">
                        Enter a claim and prior art reference below to run an
                        element-by-element overlap analysis.
                      </span>
                    </div>
                  </div>
                )}

                <EvaluationForm onEvaluate={handleEvaluate} isLoading={isLoading} />
              </div>
            )}

            {activeTab === "report" &&
              (activeReport ? (
                <ReportViewer
                  report={activeReport}
                  onDelete={handleDeleteReport}
                />
              ) : (
                <div className="text-center py-20 bg-white border border-slate-300 rounded shadow-sm">
                  <p className="text-xs text-slate-400 font-mono">
                    [No active report session found. Select a log entry to view
                    synthesis.]
                  </p>
                </div>
              ))}

            {activeTab === "matrix" && <ClaimMatrix reports={reports} />}
          </div>
        </section>
      </main>

      <footer className="bg-slate-200 px-4 py-2 flex justify-between items-center border-t border-slate-300 mt-12 w-full">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono text-slate-500">
          <span>ANALYSIS ID: X-9921-BLUEPRINT</span>
          <span>CHECKSUM: 0xA4F21</span>
          <span>TIMESTAMP: {new Date().toISOString()}</span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
          <span className="text-[10px] font-bold uppercase text-slate-600 tracking-tighter italic">
            Evaluator Logic Synchronized
          </span>
        </div>
      </footer>
    </div>
  );
}
