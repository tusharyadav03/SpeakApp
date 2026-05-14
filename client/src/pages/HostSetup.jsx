import React, { useState } from "react";
import { Monitor, ArrowLeft, Play, WifiOff } from "lucide-react";
import { Btn, Field, Status } from "../components/ui";

export default function HostSetup({ onBack, onCreate, ok }) {
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <Status ok={ok} />
      <div className="max-w-sm w-full animate-slide-up">
        <button onClick={onBack} className="mb-8 text-slate-400 hover:text-slate-700 flex items-center gap-2 text-sm font-medium"><ArrowLeft size={16} /> Back</button>
        <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center mb-5"><Monitor size={24} className="text-blue-600" /></div>
        <h2 className="text-2xl font-bold text-slate-900 mb-1">Create Event</h2>
        <p className="text-slate-500 mb-6 text-sm">Set up your Q&A session</p>
        <div className="space-y-4">
          <Field label="Event name" placeholder="e.g. Tech Conference Q&A" value={name} onChange={(e) => setName(e.target.value)} />
          <Field label="Your name" placeholder="e.g. Jane Smith" value={host} onChange={(e) => setHost(e.target.value)} />
          <Btn onClick={() => { if (!name.trim()) return alert("Enter event name"); onCreate({ name: name.trim(), hostName: host.trim() || "Host" }); }} disabled={!ok} className="w-full" sz="lg">
            <Play size={18} /> Launch Event
          </Btn>
          {!ok && <p className="text-amber-600 text-sm text-center flex items-center justify-center gap-1"><WifiOff size={14} /> Connecting to server...</p>}
        </div>
      </div>
    </div>
  );
}
