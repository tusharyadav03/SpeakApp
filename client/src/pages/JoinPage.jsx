import React, { useState } from "react";
import { Smartphone, ArrowLeft, WifiOff } from "lucide-react";
import { Btn, Field, Status, LinkedInIcon } from "../components/ui";

export default function JoinPage({ onBack, onJoin, ok }) {
  const [code, setCode] = useState(new URLSearchParams(window.location.search).get("room") || "");
  const [name, setName] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [anon, setAnon] = useState(false);
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <Status ok={ok} />
      <div className="max-w-sm w-full animate-slide-up">
        <button onClick={onBack} className="mb-8 text-slate-400 hover:text-slate-700 flex items-center gap-2 text-sm font-medium"><ArrowLeft size={16} /> Back</button>
        <div className="w-12 h-12 bg-violet-50 rounded-2xl flex items-center justify-center mb-5"><Smartphone size={24} className="text-violet-600" /></div>
        <h2 className="text-2xl font-bold text-slate-900 mb-1">Join Event</h2>
        <p className="text-slate-500 mb-6 text-sm">Enter the room code to participate</p>
        <div className="space-y-4">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            className="w-full bg-slate-50 border-2 border-slate-200 p-4 text-center text-3xl font-mono uppercase text-slate-900 rounded-xl outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 tracking-[0.3em]"
            placeholder="CODE"
            maxLength={4}
          />
          {!anon && (
            <>
              <Field placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
              <div className="relative">
                <Field
                  placeholder="LinkedIn URL (optional)"
                  value={linkedin}
                  onChange={(e) => setLinkedin(e.target.value)}
                />
                <LinkedInIcon size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-400 pointer-events-none" />
              </div>
            </>
          )}
          <label className="flex items-center gap-3 text-sm text-slate-500 cursor-pointer select-none">
            <input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
            Join anonymously
          </label>
          <Btn onClick={() => {
            if (!code.trim()) return alert("Enter code");
            const n = anon ? `Guest_${Math.random().toString(36).slice(2, 6)}` : name.trim();
            if (!anon && !n) return alert("Enter name");
            const li = anon ? "" : linkedin.trim();
            onJoin(code.trim(), { name: n, linkedin: li });
          }} disabled={!ok} className="w-full" sz="lg">
            Enter Room
          </Btn>
          {!ok && <p className="text-amber-600 text-sm text-center flex items-center justify-center gap-1"><WifiOff size={14} /> Connecting to server...</p>}
        </div>
      </div>
    </div>
  );
}
