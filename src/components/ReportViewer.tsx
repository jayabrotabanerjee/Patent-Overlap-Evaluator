/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { 
  FileText, Shield, CheckCircle2, AlertTriangle, XCircle, 
  Trash2, Copy, Check, Download, Layers, Calendar, Gavel, FileCheck
} from "lucide-react";
import { EvaluationReport, LimitationMapping } from "../types";

interface ReportViewerProps {
  report: EvaluationReport;
  onDelete: (id: string) => void;
}

export function ReportViewer({ report, onDelete }: ReportViewerProps) {
  const [filter, setFilter] = useState<string>("all");
  const [copied, setCopied] = useState<boolean>(false);

  // Statistics calculation
  const totalElements = report.mapping.length;
  const disclosedCount = report.mapping.filter(
    (m) => m.finding === "Disclosed" || m.finding === "Inherently Disclosed"
  ).length;
  const partialCount = report.mapping.filter((m) => m.finding === "Partially Disclosed").length;
  const notFoundCount = report.mapping.filter((m) => m.finding === "Not Found").length;
  
  const coveragePercent = totalElements > 0 ? Math.round((disclosedCount / totalElements) * 100) : 0;

  // Filter elements
  const filteredMapping = report.mapping.filter((m) => {
    if (filter === "all") return true;
    if (filter === "disclosed") return m.finding === "Disclosed" || m.finding === "Inherently Disclosed";
    if (filter === "partial") return m.finding === "Partially Disclosed";
    if (filter === "missing") return m.finding === "Not Found";
    return true;
  });

  // Get color and styles for the overall strength category block
  const getStrengthStyle = (conclusion: string) => {
    const text = conclusion.toLowerCase();
    if (text.includes("102") || text.includes("anticipatory")) {
      return {
        bg: "bg-emerald-600 border-emerald-800 text-white",
        bar: "bg-emerald-500",
        label: "Anticipatory (§102) Reference",
        icon: <FileCheck className="h-5 w-5 text-emerald-100" />
      };
    } else if (text.includes("primary") || text.includes("strong")) {
      return {
        bg: "bg-blue-600 border-blue-800 text-white",
        bar: "bg-blue-500",
        label: "Strong Obviousness Primary Reference",
        icon: <CheckCircle2 className="h-5 w-5 text-blue-100" />
      };
    } else if (text.includes("secondary") || text.includes("component") || text.includes("103")) {
      return {
        bg: "bg-amber-600 border-amber-800 text-white",
        bar: "bg-amber-500",
        label: "Secondary Obviousness (§103) Component",
        icon: <AlertTriangle className="h-5 w-5 text-amber-100" />
      };
    } else {
      return {
        bg: "bg-slate-700 border-slate-900 text-white",
        bar: "bg-slate-500",
        label: "Weak / Irrelevant",
        icon: <XCircle className="h-5 w-5 text-slate-100" />
      };
    }
  };

  const strengthStyle = getStrengthStyle(report.strengthJudgment.conclusion);

  // Badge mapping for high density table finding cells
  const getFindingBadge = (finding: LimitationMapping["finding"]) => {
    switch (finding) {
      case "Disclosed":
        return (
          <span className="inline-flex px-2 py-0.5 bg-green-100 text-green-700 rounded text-[9px] font-bold uppercase border border-green-200 tracking-wider">
            Disclosed
          </span>
        );
      case "Inherently Disclosed":
        return (
          <span className="inline-flex px-2 py-0.5 bg-green-100 text-green-700 rounded text-[9px] font-bold uppercase border border-green-200 tracking-wider">
            Inherently
          </span>
        );
      case "Partially Disclosed":
        return (
          <span className="inline-flex px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-[9px] font-bold uppercase border border-amber-200 tracking-wider">
            Partial
          </span>
        );
      case "Not Found":
        return (
          <span className="inline-flex px-2 py-0.5 bg-red-100 text-red-700 rounded text-[9px] font-bold uppercase border border-red-200 tracking-wider">
            Not Found
          </span>
        );
      default:
        return (
          <span className="inline-flex px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-[9px] font-bold uppercase border border-slate-200 tracking-wider">
            {finding}
          </span>
        );
    }
  };

  // Clipboard copy
  const copyToClipboard = () => {
    const textToCopy = `### OVERLAP EVALUATION REPORT
Target Claim: ${report.claimNumber}
Prior Art Reference: ${report.referenceCitation}

1. ELEMENT-BY-ELEMENT MAPPING:
${report.mapping.map(m => `Claim Limitation ${m.limitationId}: "${m.limitation}"\n  Finding: ${m.finding}\n  Prior Art Disclosure: ${m.disclosure}\n`).join("\n")}

2. OVERALL STRENGTH OF REFERENCE JUDGMENT:
Conclusion: ${report.strengthJudgment.conclusion}
Rationale: ${report.strengthJudgment.rationale}
Strategic Recommendation: ${report.strengthJudgment.strategicRecommendation}
`;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Download markdown format
  const downloadMarkdown = () => {
    const markdownContent = `# Overlap Evaluation Report
**Analyzed On:** ${report.timestamp}
**Target Claim:** ${report.claimNumber}
**Prior Art Reference Citation:** ${report.referenceCitation}

## 1. Executive Summary
- **Element Coverage:** ${disclosedCount} of ${totalElements} completely disclosed (${coveragePercent}% overlap).
- **Strength Certification:** ${report.strengthJudgment.conclusion}

## 2. Element-by-Element Chart Matrix
| Limitation ID | Claim Limitation | Prior Art Disclosure | Evaluation Status |
|---------------|------------------|----------------------|-------------------|
${report.mapping.map(m => `| ${m.limitationId} | ${m.limitation.replace(/\n/g, ' ')} | ${m.disclosure.replace(/\n/g, ' ')} | ${m.finding} |`).join("\n")}

## 3. Comprehensive Analytical Rationale
${report.strengthJudgment.rationale}

## 4. Professional Strategy & Next Search Steps
${report.strengthJudgment.strategicRecommendation}

---
*Report synthesized by Google AI Studio Prior Art Overlap Evaluator.*
`;
    const blob = new Blob([markdownContent], { type: "text/markdown;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `Overlap_Report_${report.claimNumber.replace(/\s+/g, '_')}_vs_${report.referenceCitation.replace(/[\s',.]+/g, '_')}.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-stretch" id={`report-viewer-${report.id}`}>
      
      {/* Left: Element-by-Element Mapping Table (Snug High-Density structure) */}
      <section className="col-span-1 md:col-span-8 bg-white border border-slate-300 rounded-lg shadow-sm flex flex-col overflow-hidden">
        
        {/* Table Inner Admin Controls & Title Block */}
        <div className="bg-slate-50 border-b border-slate-300 px-4 py-2.5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
          <div>
            <span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">
              1. Element-by-Element Mapping
            </span>
            <div className="text-[10px] text-slate-400 font-mono mt-0.5">
              Target: {report.claimNumber} // Ref: {report.referenceCitation}
            </div>
          </div>

          <div className="flex flex-wrap gap-1 bg-slate-250 p-1 rounded-md text-[10px] font-semibold border border-slate-300">
            <button
              onClick={() => setFilter("all")}
              id={`btn-filter-all-${report.id}`}
              className={`rounded px-2 py-0.5 transition-all cursor-pointer ${
                filter === "all" ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              All ({totalElements})
            </button>
            <button
              onClick={() => setFilter("disclosed")}
              id={`btn-filter-disclosed-${report.id}`}
              className={`rounded px-2 py-0.5 transition-all cursor-pointer ${
                filter === "disclosed" ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Found ({disclosedCount})
            </button>
            {partialCount > 0 && (
              <button
                onClick={() => setFilter("partial")}
                id={`btn-filter-partial-${report.id}`}
                className={`rounded px-2 py-0.5 transition-all cursor-pointer ${
                  filter === "partial" ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Partial ({partialCount})
              </button>
            )}
            <button
              onClick={() => setFilter("missing")}
              id={`btn-filter-missing-${report.id}`}
              className={`rounded px-2 py-0.5 transition-all cursor-pointer ${
                filter === "missing" ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Gaps ({notFoundCount})
            </button>
          </div>
        </div>

        {/* Claim Charts Matrix Table structured precisely like the design HTML */}
        <div className="flex-grow overflow-x-auto">
          <table className="w-full text-left border-collapse table-fixed min-w-[600px]">
            <thead>
              <tr className="bg-slate-50 text-[10px] uppercase text-slate-500 border-b border-slate-300">
                <th className="w-1/3 px-4 py-2 font-bold font-sans">Claim Limitation</th>
                <th className="px-4 py-2 font-bold font-sans">Prior Art Disclosure (with Citation)</th>
                <th className="w-24 px-4 py-2 font-bold font-sans text-center">Finding</th>
              </tr>
            </thead>
            <tbody className="text-xs divide-y divide-slate-100">
              {filteredMapping.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-12 text-center text-slate-400 font-mono italic">
                    [No limitations match the active filter criteria.]
                  </td>
                </tr>
              ) : (
                filteredMapping.map((item) => (
                  <tr key={item.limitationId} className="hover:bg-slate-50/50 transition duration-150">
                    <td className="px-4 py-3 align-top font-semibold text-slate-800 bg-slate-50/40 border-r border-slate-100 leading-normal font-sans">
                      <span className="font-mono text-[10px] text-indigo-700 font-bold block mb-1">
                        [{item.limitationId}]
                      </span>
                      {item.limitation}
                    </td>
                    <td className="px-4 py-3 align-top font-mono text-slate-600 text-[11px] leading-relaxed">
                      "{item.disclosure}"
                      <div className="mt-1.5 text-blue-600 font-bold uppercase text-[9px] font-mono tracking-tight flex items-center gap-1">
                        <span>-</span>
                        <span>{report.referenceCitation} // {item.limitationId}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top text-center">
                      {getFindingBadge(item.finding)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Right: Synthesis Sidebar (Snug design standard with dynamic actions tab) */}
      <aside className="col-span-1 md:col-span-4 bg-slate-50 border border-slate-300 rounded-lg shadow-sm flex flex-col justify-between overflow-hidden">
        <div className="p-4 sm:p-5 flex-1 space-y-5">
          
          {/* Section Heading */}
          <div>
            <h2 className="text-[10px] font-bold uppercase text-slate-500 tracking-widest mb-2 flex items-center gap-1">
              <Shield className="h-3.5 w-3.5" />
              2. Strength of Reference Judgment
            </h2>
            
            {/* Flat high-density styled judgment band */}
            <div className={`p-4 rounded border-b-4 ${strengthStyle.bg} shadow-md flex items-start gap-2.5`}>
              <div className="mt-1">{strengthStyle.icon}</div>
              <div>
                <p className="text-[9px] uppercase opacity-75 font-mono tracking-tight">Final Conclusion</p>
                <p className="text-base font-black leading-tight sm:text-lg">
                  {report.strengthJudgment.conclusion}
                </p>
              </div>
            </div>
          </div>

          {/* Rationale and Strategy text snug lines */}
          <div className="space-y-4">
            <div>
              <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-1">
                Analytical Rationale
              </p>
              <p className="text-xs leading-relaxed text-slate-700 whitespace-pre-line bg-white/60 p-2.5 rounded border border-slate-200 shadow-sm">
                {report.strengthJudgment.rationale}
              </p>
            </div>

            <div>
              <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-1">
                Strategic Advice
              </p>
              <div className="p-2.5 bg-white border border-slate-200 rounded text-xs text-slate-600 italic leading-relaxed shadow-sm">
                {report.strengthJudgment.strategicRecommendation}
              </div>
            </div>
          </div>

          {/* Key metrics intensity bar precisely scaled from HTML */}
          <div className="space-y-1.5 pt-1 border-t border-slate-200">
            <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">
              Overlap Intensity
            </p>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden flex">
                <div 
                  className={`h-full transition-all duration-300 ${strengthStyle.bar}`}
                  style={{ width: `${coveragePercent}%` }}
                />
              </div>
              <span className="text-[11px] font-mono font-bold text-slate-800 shrink-0">
                {coveragePercent}% Match
              </span>
            </div>
            <div className="flex justify-between text-[9px] font-mono text-slate-400">
              <span>{disclosedCount} covered elements</span>
              <span>{notFoundCount} remaining gaps</span>
            </div>
          </div>

        </div>

        {/* Action utility toolbar */}
        <div className="p-3.5 bg-slate-100 border-t border-slate-250 flex flex-col gap-2">
          <div className="flex gap-2">
            <button
              onClick={copyToClipboard}
              id={`btn-copy-report-${report.id}`}
              className="flex-1 flex items-center justify-center gap-1.5 rounded bg-white border border-slate-300 py-1.5 text-[10px] font-bold uppercase text-slate-700 hover:bg-slate-50 transition cursor-pointer"
              title="Copy findings text"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 text-green-600" />
                  <span className="text-green-700">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  <span>Copy Report</span>
                </>
              )}
            </button>

            <button
              onClick={downloadMarkdown}
              id={`btn-download-report-${report.id}`}
              className="flex-1 flex items-center justify-center gap-1.5 rounded bg-white border border-slate-300 py-1.5 text-[10px] font-bold uppercase text-slate-700 hover:bg-slate-50 transition cursor-pointer"
              title="Export Markdown File"
            >
              <Download className="h-3 w-3" />
              <span>Export Chart</span>
            </button>
          </div>

          <button
            onClick={() => onDelete(report.id)}
            id={`btn-delete-report-${report.id}`}
            className="w-full flex items-center justify-center gap-1.5 rounded bg-rose-50 border border-rose-200 py-2 text-[10px] font-bold uppercase text-rose-700 hover:bg-rose-100 transition cursor-pointer mt-1"
          >
            <Trash2 className="h-3 w-3" />
            <span>Delete Dossier</span>
          </button>
        </div>

      </aside>

    </div>
  );
}

export default ReportViewer;
