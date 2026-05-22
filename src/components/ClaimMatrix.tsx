/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { 
  Sparkles, Check, AlertTriangle, X, HelpCircle, Merge, 
  GitMerge, AlertCircle, ArrowUpRight
} from "lucide-react";
import { EvaluationReport, LimitationMapping } from "../types";

interface ClaimMatrixProps {
  reports: EvaluationReport[];
}

export function ClaimMatrix({ reports }: ClaimMatrixProps) {
  if (reports.length < 2) {
    return (
      <div className="rounded-xl border-2 border-dashed border-slate-350 bg-slate-50 p-8 text-center max-w-xl mx-auto space-y-4 shadow-sm" id="matrix-empty-state">
        <GitMerge className="mx-auto h-12 w-12 text-slate-400" />
        <div>
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-widest font-sans">
            Multi-Reference Matrix Disabled
          </h3>
          <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto leading-normal">
            Please run an overlap evaluation on at least **two** different prior art references to build a side-by-side matrices mapping and obviousness combination prospectus.
          </p>
        </div>
        <div className="text-[10px] text-slate-400 font-mono italic">
          Try loading the "Smart Irrigation Controller" example, analyze it, and then load "Alt Remote Forecast Controller" to see a complete combination map.
        </div>
      </div>
    );
  }

  // Find report with deepest level of details
  const baseReport = reports.reduce((prev, current) => 
    current.mapping.length > prev.mapping.length ? current : prev
  , reports[0]);

  const limitations = baseReport.mapping;

  // Custom high density matrix cell renderer
  const renderCellStatus = (report: EvaluationReport, limitationId: string) => {
    const match = report.mapping.find(
      (m) => m.limitationId.toLowerCase() === limitationId.toLowerCase()
    );

    if (!match) {
      return (
        <div className="flex flex-col items-center justify-center p-2 bg-slate-100 rounded text-[9px] text-slate-400 font-mono h-full border border-slate-200">
          <HelpCircle className="h-3 w-3 text-slate-400 mb-0.5" />
          <span>Unparsed</span>
        </div>
      );
    }

    if (match.finding === "Disclosed" || match.finding === "Inherently Disclosed") {
      return (
        <div className="flex flex-col items-center p-1.5 rounded bg-green-50 text-center text-[10px] text-green-800 border border-green-200 h-full justify-between gap-1 shadow-sm">
          <div className="flex items-center gap-1 font-extrabold text-[9px] text-green-700 uppercase tracking-wider">
            <Check className="h-3 w-3 stroke-[3px]" />
            <span>FOUND</span>
          </div>
          <p className="font-mono text-[9px] text-slate-500 line-clamp-2 leading-relaxed italic" title={match.disclosure}>
            "{match.disclosure}"
          </p>
        </div>
      );
    } else if (match.finding === "Partially Disclosed") {
      return (
        <div className="flex flex-col items-center p-1.5 rounded bg-amber-50 text-center text-[10px] text-amber-800 border border-amber-200 h-full justify-between gap-1 shadow-sm">
          <div className="flex items-center gap-1 font-extrabold text-[9px] text-amber-700 uppercase tracking-wider">
            <AlertTriangle className="h-3 w-3 stroke-[3px]" />
            <span>PARTIAL</span>
          </div>
          <p className="font-mono text-[9px] text-slate-500 line-clamp-2 leading-relaxed italic" title={match.disclosure}>
            "{match.disclosure}"
          </p>
        </div>
      );
    } else {
      return (
        <div className="flex flex-col items-center justify-center p-2 rounded bg-red-50 text-center text-[10px] text-red-800 border border-red-200 h-full shadow-sm">
          <div className="flex items-center gap-1 font-extrabold text-[9px] text-red-700 uppercase tracking-wider">
            <X className="h-3 w-3 stroke-[3px]" />
            <span>GAP</span>
          </div>
        </div>
      );
    }
  };

  // Build obviousness recommendations
  const buildCombinationProposals = () => {
    const proposals: string[] = [];
    const unmappedLimits: string[] = [];
    const coveragePerRef: { [ref: string]: string[] } = {};

    reports.forEach((rep) => {
      coveragePerRef[rep.referenceCitation] = rep.mapping
        .filter((m) => m.finding === "Disclosed" || m.finding === "Inherently Disclosed" || m.finding === "Partially Disclosed")
        .map((m) => m.limitationId);
    });

    limitations.forEach((lim) => {
      const coveredBy = reports.filter((rep) => {
        const match = rep.mapping.find((m) => m.limitationId === lim.limitationId);
        return match && (match.finding === "Disclosed" || match.finding === "Inherently Disclosed");
      }).map((rep) => rep.referenceCitation);

      if (coveredBy.length === 0) {
        unmappedLimits.push(lim.limitationId);
      }
    });

    if (reports.length >= 2) {
      for (let i = 0; i < reports.length; i++) {
        for (let j = i + 1; j < reports.length; j++) {
          const refA = reports[i];
          const refB = reports[j];

          const matchedA = coveragePerRef[refA.referenceCitation] || [];
          const matchedB = coveragePerRef[refB.referenceCitation] || [];

          const combinedCoverage = Array.from(new Set([...matchedA, ...matchedB]));
          const missingIds = limitations
            .map((l) => l.limitationId)
            .filter((id) => !combinedCoverage.includes(id));

          if (missingIds.length === 0) {
            proposals.push(
              `✨ **Perfect Obviousness Alliance Found**: Combining prior art references **${refA.referenceCitation}** and **${refB.referenceCitation}** completely maps 100% of the limitations of the target claim. Recommend drafting a combined §103 obviousness defense using ${refA.referenceCitation} as the primary basis (covering elements ${matchedA.join(", ")}) and ${refB.referenceCitation} as secondary (specifically to disclose elements ${matchedB.filter(x => !matchedA.includes(x)).join(", ")}).`
            );
          } else if (combinedCoverage.length > matchedA.length && combinedCoverage.length > matchedB.length) {
            proposals.push(
              `🔗 **Synergistic Combination**: Merging **${refA.referenceCitation}** and **${refB.referenceCitation}** improves coverage substantially from ${matchedA.length}/${limitations.length} elements to ${combinedCoverage.length}/${limitations.length} (Element limitations covered: ${combinedCoverage.sort().join(", ")}). Outstanding gaps remain for: [${missingIds.join(", ")}].`
            );
          }
        }
      }
    }

    return { proposals, unmappedLimits };
  };

  const { proposals, unmappedLimits } = buildCombinationProposals();

  return (
    <div className="space-y-5" id="patent-claims-matrix-dashboard">
      
      {/* Intro descriptive card element */}
      <div className="rounded-lg border border-slate-300 bg-white p-4 shadow-sm space-y-2">
        <div className="flex items-center gap-2">
          <div className="rounded bg-indigo-50 p-1">
            <Merge className="h-4 w-4 text-indigo-600" />
          </div>
          <h3 className="text-xs font-bold text-slate-900 font-sans uppercase tracking-widest">
            Global Patent Overlap Claims Matrix
          </h3>
        </div>
        <p className="text-xs text-slate-500 leading-normal max-w-4xl font-sans">
          Visualizing overlap indicators across multiple evaluated references side-by-side. 
          Use this interactive matrix to formulate solid 35 U.S.C. §103 invalidity combinations.
        </p>
      </div>

      {/* Main Grid table container */}
      <div className="rounded-lg border border-slate-300 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse table-fixed min-w-[700px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-300 text-[10px] text-slate-500 uppercase tracking-wider">
                <th className="w-24 px-4 py-2 font-bold font-sans">Limit ID</th>
                <th className="px-4 py-2 font-bold font-sans w-1/3">Parsed Claim Limitation</th>
                {reports.map((report) => (
                  <th 
                    key={report.id} 
                    className="px-4 py-2 font-bold font-sans text-center border-l border-slate-200 bg-slate-50/50"
                  >
                    <div className="truncate text-slate-900 text-xs font-bold" title={report.referenceCitation}>
                      {report.referenceCitation}
                    </div>
                    <div className="text-[9px] font-mono text-slate-400 mt-0.5">
                      {report.claimNumber}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-xs divide-y divide-slate-200">
              {limitations.map((lim) => (
                <tr key={lim.limitationId} className="hover:bg-slate-50/50 transition duration-150">
                  <td className="px-4 py-3 align-top font-bold text-slate-900 font-mono bg-slate-50/50">
                    {lim.limitationId}
                  </td>
                  <td className="px-4 py-3 align-top font-sans text-slate-700 leading-relaxed text-[11px] border-r border-slate-100">
                    {lim.limitation}
                  </td>
                  {reports.map((report) => (
                    <td key={report.id} className="p-2 align-top border-l border-slate-150 max-w-[200px]" style={{ height: "1px" }}>
                      <div className="h-full">
                        {renderCellStatus(report, lim.limitationId)}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Obviousness combination prospectus card matching dark high density theme */}
      <div className="rounded-lg border border-slate-950 bg-slate-900 text-slate-100 p-4 sm:p-5 shadow-lg space-y-3">
        <div className="flex items-center gap-2 border-b border-slate-800 pb-2.5">
          <Sparkles className="h-4 w-4 text-theme text-blue-400" />
          <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-200">
            Obviousness Combination Proposer Prospectus
          </h4>
        </div>

        {proposals.length === 0 ? (
          <div className="flex items-start gap-2 text-xs text-slate-400 font-sans">
            <AlertCircle className="h-3.5 w-3.5 text-blue-400 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              No multi-reference combinations currently map 100% of the limitations. 
              {unmappedLimits.length > 0 && (
                <span className="font-mono text-[11px] text-slate-350 block mt-1">
                  Alert: Limitations [{unmappedLimits.join(", ")}] have no discovered disclosures in any analyzed reference. Additional prior art searches should target these specific features.
                </span>
              )}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {proposals.map((prop, idx) => (
              <div 
                key={idx} 
                className="rounded bg-slate-800 p-3 border border-slate-700 text-xs leading-relaxed font-sans text-slate-200 hover:border-slate-600 transition"
              >
                <div className="flex gap-2.5">
                  <div className="h-5 w-5 bg-blue-500/10 rounded border border-blue-400/30 text-blue-400 flex items-center justify-center shrink-0 mt-0.5 text-[10px] font-mono">
                    {idx + 1}
                  </div>
                  <div className="space-y-1">
                    <p className="text-slate-150 leading-relaxed font-sans">{prop.replace(/\*\*/g, '')}</p>
                    <div className="flex items-center gap-1 text-[9px] text-blue-400 font-mono font-bold hover:underline cursor-pointer tracking-wider pt-1 uppercase">
                      <span>Draft COMBINED §103 INVALIDITY MATRIX CHART</span>
                      <ArrowUpRight className="h-2.5 w-2.5" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

export default ClaimMatrix;
