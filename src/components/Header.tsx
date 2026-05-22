/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { Scale } from "lucide-react";

interface HeaderProps {
  activeReport?: {
    claimNumber: string;
    referenceCitation: string;
  };
}

export function Header({ activeReport }: HeaderProps) {
  return (
    <header className="bg-slate-900 text-white px-4 py-3 sm:px-6 flex flex-col sm:flex-row justify-between items-start sm:items-center shadow-md border-b border-slate-950">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center font-bold text-base text-white shadow-inner">
          E
        </div>
        <div>
          <h1 className="text-xs font-bold tracking-widest uppercase font-sans">
            Prior Art Overlap Evaluator
          </h1>
          <p className="text-[10px] text-slate-400 font-mono leading-none mt-0.5">
            v4.2 // Senior Patent Analyst Persona Active
          </p>
        </div>
      </div>
      
      <div className="flex gap-4 sm:gap-6 items-center mt-2 sm:mt-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-800 w-full sm:w-auto">
        <div className="text-left sm:text-right flex-1 sm:flex-none">
          <p className="text-[9px] uppercase text-slate-400 tracking-tighter font-mono">
            Target Claim
          </p>
          <p className="text-xs font-bold font-sans text-slate-200">
            {activeReport ? activeReport.claimNumber : "Not Selected"}
          </p>
        </div>
        <div className="w-[1px] h-6 bg-slate-800 shrink-0 hidden sm:block"></div>
        <div className="text-left sm:text-right flex-1 sm:flex-none text-blue-400">
          <p className="text-[9px] uppercase text-slate-400 tracking-tighter font-mono">
            Active Reference
          </p>
          <p className="text-xs font-bold font-sans">
            {activeReport ? activeReport.referenceCitation : "Not Selected"}
          </p>
        </div>
      </div>
    </header>
  );
}

export default Header;
