/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { 
  Archive, HelpCircle, User, Sparkles, FolderOpen, RefreshCw, 
  ChevronRight, Gavel, FileCheck, Layers, Scale, AlertOctagon
} from "lucide-react";
import { Header } from "./components/Header";
import { EvaluationForm } from "./components/EvaluationForm";
import { ReportViewer } from "./components/ReportViewer";
import { ClaimMatrix } from "./components/ClaimMatrix";
import { EvaluationReport } from "./types";

export default function App() {
  const [reports, setReports] = useState<EvaluationReport[]>([]);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"dossier" | "report" | "matrix">("dossier");
  const [isLoading, setIsLoading] = useState(false);
  const [systemError, setSystemError] = useState<{ title: string; desc: string } | null>(null);

  // Load from localStorage on initialization
  useEffect(() => {
    try {
      const stored = localStorage.getItem("patent_analyst_sessions");
      if (stored) {
        const parsed = JSON.parse(stored) as EvaluationReport[];
        if (parsed && Array.isArray(parsed) && parsed.length > 0) {
          setReports(parsed);
          setActiveReportId(parsed[0].id);
          setActiveTab("report");
        }
      }
    } catch (e) {
      console.error("Local storage sync error:", e);
    }
  }, []);

  // Save to localStorage when reports list updates
  const saveReports = (newReports: EvaluationReport[]) => {
    setReports(newReports);
    try {
      localStorage.setItem("patent_analyst_sessions", JSON.stringify(newReports));
    } catch (e) {
      console.error("Local storage save error:", e);
    }
  };

  // Submit dossier handler
  const handleEvaluate = async (formData: {
    claimNumber: string;
    claimText: string;
    referenceCitation: string;
    referenceText: string;
    relevantSections?: string;
  }) => {
    setIsLoading(true);
    setSystemError(null);

    try {
      const response = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.message || errJson.error || `Server responded with status code ${response.status}`);
      }

      const freshResponse = await response.json();

      // Formulate a clean local report object
      const freshReport: EvaluationReport = {
        id: `rep_${Date.now()}`,
        timestamp: new Date().toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
          timeZoneName: "short",
        }) + " on " + new Date().toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric"
        }),
        claimNumber: freshResponse.claimNumber || formData.claimNumber || "Claim 1",
        claimText: formData.claimText,
        referenceCitation: freshResponse.referenceCitation || formData.referenceCitation,
        referenceText: formData.referenceText,
        mapping: freshResponse.mapping || [],
        strengthJudgment: {
          conclusion: freshResponse.strengthJudgment?.conclusion || "Not Parsed",
          rationale: freshResponse.strengthJudgment?.rationale || "No rationale returned.",
          strategicRecommendation: freshResponse.strengthJudgment?.strategicRecommendation || "No recommendations.",
        }
      };

      const updated = [freshReport, ...reports];
      saveReports(updated);
      setActiveReportId(freshReport.id);
      setActiveTab("report");

    } catch (err: any) {
      console.error("API Evaluation request failed:", err);
      const isConfigError = err.message?.includes("GEMINI_API_KEY") || err.message?.includes("API_KEY");
      
      setSystemError({
        title: isConfigError ? "API Authorization Error" : "Evaluation System Error",
        desc: isConfigError 
          ? "The Gemini API Key is missing. Please select the Settings > Secrets configuration panel in the Google AI Studio UI, declare 'GEMINI_API_KEY', and retry."
          : err.message || "An unexpected error occurred during claims deconstruction and prior art matching. Please verify file syntax."
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Delete individual report
  const handleDeleteReport = (id: string) => {
    const filtered = reports.filter((r) => r.id !== id);
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

  // Clear all sessions
  const handleClearSession = () => {
    if (window.confirm("Are you sure you want to completely flush the active patent analysis workspace? This deletes all mapped charts.")) {
      saveReports([]);
      setActiveReportId(null);
      setActiveTab("dossier");
      setSystemError(null);
    }
  };

  const activeReport = reports.find((r) => r.id === activeReportId);

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans overflow-x-hidden">
      {/* Dynamic Header passing reference stats */}
      <Header activeReport={activeReport} />

      <main className="flex-grow mx-auto max-w-7xl w-full px-4 py-4 sm:px-6 flex flex-col gap-4 lg:flex-row">
        
        {/* Workspace Side Panel (Session logs) */}
        <section className="lg:w-1/4 flex flex-col gap-4 shrink-0" aria-label="Analyst Workplace Logs" id="workplace-side-panel">
          
          {/* Senior Analyst Avatar card */}
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

          {/* Sessions Log List panel */}
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
                reports.map((rep) => {
                  const isCur = rep.id === activeReportId;
                  const disclosedCount = rep.mapping.filter(m => m.finding === "Disclosed" || m.finding === "Inherently Disclosed").length;
                  const totalCount = rep.mapping.length;

                  return (
                    <button
                      key={rep.id}
                      id={`session-log-item-${rep.id}`}
                      onClick={() => {
                        setActiveReportId(rep.id);
                        setActiveTab("report");
                      }}
                      className={`w-full text-left rounded p-2 transition flex items-center justify-between border cursor-pointer focus:outline-none ${
                        isCur 
                          ? "bg-slate-900 border-slate-950 text-white font-bold" 
                          : "bg-white hover:bg-slate-100 border-slate-200 text-slate-700"
                      }`}
                    >
                      <div className="min-w-0 flex-grow pr-1">
                        <div className={`flex items-center gap-1 text-[9px] ${isCur ? "text-slate-400" : "text-slate-500"} font-medium`}>
                          <span>{rep.claimNumber}</span>
                          <span>•</span>
                          <span className="truncate">{rep.referenceCitation}</span>
                        </div>
                        <h4 className={`text-xs font-semibold truncate ${isCur ? "text-white" : "text-slate-900"}`}>
                          {rep.referenceCitation}
                        </h4>
                        <div className={`flex items-center gap-1 text-[8px] font-mono mt-0.5 ${isCur ? "text-blue-300" : "text-slate-400"}`}>
                          <span>{disclosedCount}/{totalCount} limitations covered</span>
                        </div>
                      </div>
                      <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition ${isCur ? "text-blue-400 translate-x-0.5" : "text-slate-300"}`} />
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Quick Informational / Help panel in Slate colors */}
          <div className="rounded border border-slate-300 bg-slate-50 p-3 space-y-1.5 text-[10px] text-slate-600 shadow-sm leading-normal">
            <h5 className="font-bold text-slate-800 uppercase tracking-widest flex items-center gap-1 leading-none border-b border-slate-250 pb-1.5 mb-1">
              <Scale className="h-3 w-3 text-slate-500" />
              Prior Art Interpretation Rules
            </h5>
            <ol className="list-decimal list-inside space-y-1 text-slate-500 font-sans">
              <li><strong>Anticipation (§102)</strong>: A single active reference explicitly discloses every claimed limitation.</li>
              <li><strong>Obviousness (§103)</strong>: Multiple references are combined to cover all limitations synergistically.</li>
            </ol>
          </div>

        </section>

        {/* Main analytical stage desk */}
        <section className="flex-grow lg:w-3/4 flex flex-col gap-4" aria-label="Analytical Stage">
          
          {/* Workspace Navigation Docket Tabs precisely styled (slate theme) */}
          <div className="flex bg-slate-200 p-1 rounded border border-slate-300 shadow-sm" id="workspace-navigation-tabs">
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
                reports.length === 0 ? "opacity-40 cursor-not-allowed text-slate-400" : ""
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
                reports.length < 2 ? "opacity-40 cursor-not-allowed text-slate-400" : ""
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

          {/* System status / Configuration error banner handler */}
          {systemError && (
            <div className="rounded border border-rose-300 bg-rose-50 p-4 shadow-sm space-y-2 flex items-start gap-3 border-l-4 border-l-rose-500" id="system-failure-banner">
              <AlertOctagon className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h4 className="text-xs font-bold text-rose-950 uppercase tracking-tight">{systemError.title}</h4>
                <p className="text-xs text-rose-900 leading-relaxed font-sans">{systemError.desc}</p>
                <div className="flex items-center gap-1.5 pt-1">
                  <div className="inline-flex items-center gap-1 rounded bg-rose-100 px-2 py-0.5 text-[9px] font-bold text-rose-800 uppercase font-mono">
                    Action Required
                  </div>
                  <span className="text-[10px] text-rose-600 font-sans">
                    Toggle Secrets panel in developer settings, configure 'GEMINI_API_KEY', and retry.
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ACTIVE CONTENT STAGE */}
          <div className="transition-all duration-300">
            {activeTab === "dossier" && (
              <div className="space-y-5">
                
                {/* Visual Intro Splash if no data exists */}
                {reports.length === 0 && (
                  <div className="rounded border border-slate-300 bg-white p-5 shadow-sm space-y-3" id="analyst-intro-splash">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5 text-[9px] font-semibold text-blue-600 uppercase tracking-widest font-mono">
                        <Sparkles className="h-3 w-3" />
                        Analysis Persona Active
                      </div>
                      <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider font-sans">
                        Court-Grade Element-by-Element Evidence Overlap Mapping.
                      </h2>
                      <p className="text-xs text-slate-600 leading-relaxed font-sans">
                        Welcome to the Overlap Evaluation Workspace. This system deconstructs target patent claims into rigid limiting statements, maps active text segments parsed objectively from prior art references, displays technical overlays, and formats strategic responses.
                      </p>
                    </div>

                    <div className="flex border-t border-slate-200 pt-2 items-center gap-2 text-[10px] font-semibold text-slate-500">
                      <span>Quick Guidance:</span>
                      <span className="text-slate-400 font-medium">
                        Click on any preloaded dossier card down below to run an instant deconstruction mapping.
                      </span>
                    </div>
                  </div>
                )}

                <EvaluationForm onEvaluate={handleEvaluate} isLoading={isLoading} />
              </div>
            )}

            {activeTab === "report" && (
              activeReport ? (
                <ReportViewer report={activeReport} onDelete={handleDeleteReport} />
              ) : (
                <div className="text-center py-20 bg-white border border-slate-300 rounded shadow-sm">
                  <p className="text-xs text-slate-400 font-mono">[No active report session found. Select a log entry to view synthesis.]</p>
                </div>
              )
            )}

            {activeTab === "matrix" && (
              <ClaimMatrix reports={reports} />
            )}
          </div>

        </section>

      </main>

      {/* Styled exactly like the Design HTML footer with elegant technical status indicator */}
      <footer className="bg-slate-200 px-4 py-2 flex justify-between items-center border-t border-slate-300 mt-12 w-full">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono text-slate-500">
          <span>ANALYSIS ID: X-9921-BLUEPRINT</span>
          <span>CHECKSUM: 0xA4F21</span>
          <span>TIMESTAMP: 2026-05-22 14:02:11 UTC</span>
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
