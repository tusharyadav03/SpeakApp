import React from "react";
import { ChevronDown } from "lucide-react";
import { LANGUAGES } from "../config/languages";

export default function LangSelect({ value, onChange }) {
  return (
    <div className="relative inline-flex items-center">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent border border-slate-200 text-slate-700 text-xs font-medium rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-500 appearance-none pr-7 cursor-pointer min-w-[130px]"
        style={{ colorScheme: 'light' }}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>{l.label}</option>
        ))}
      </select>
      <ChevronDown size={12} className="absolute right-2 text-slate-400 pointer-events-none" />
    </div>
  );
}
