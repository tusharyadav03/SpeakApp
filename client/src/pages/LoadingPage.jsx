import React from "react";
import { Mic } from "lucide-react";

export default function LoadingPage({ message = "Loading..." }) {
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6">
      <div className="animate-slide-up text-center">
        {/* Pulsing logo icon */}
        <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-600/20 animate-pulse">
          <Mic size={32} className="text-white" />
        </div>

        {/* Spinner */}
        <div className="relative w-10 h-10 mx-auto mb-5">
          <div className="absolute inset-0 rounded-full border-[3px] border-slate-100" />
          <div className="absolute inset-0 rounded-full border-[3px] border-transparent border-t-blue-600 animate-spin" />
        </div>

        <p className="text-slate-500 text-sm font-medium">{message}</p>
      </div>

      <style>{`
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
