import React, { useState } from "react";
import { ArrowLeft, AlertCircle } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Logo, Btn, Field } from "../components/ui";

export default function Register({ onBack, onSwitch }) {
  const { register } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async (e) => { e.preventDefault(); setErr(""); setBusy(true); try { await register(name, email, pw); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-sm w-full animate-slide-up">
        <button onClick={onBack} className="mb-8 text-slate-400 hover:text-slate-700 flex items-center gap-2 text-sm font-medium"><ArrowLeft size={16} /> Back</button>
        <Logo />
        <h2 className="text-2xl font-bold text-slate-900 mt-6 mb-1">Create account</h2>
        <p className="text-slate-500 mb-6 text-sm">Start hosting events in minutes</p>
        {err && <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-red-600 text-sm flex items-center gap-2"><AlertCircle size={16} /> {err}</div>}
        <form onSubmit={go} className="space-y-4">
          <Field label="Full name" placeholder="Jane Smith" value={name} onChange={(e) => setName(e.target.value)} required />
          <Field label="Email" type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Field label="Password" type="password" placeholder="Min 6 characters" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={6} />
          <Btn type="submit" disabled={busy} className="w-full">{busy ? "Creating..." : "Create Account"}</Btn>
        </form>
        <p className="text-center text-slate-400 mt-6 text-sm">Already have an account? <button onClick={onSwitch} className="text-blue-600 hover:underline font-medium">Sign in</button></p>
      </div>
    </div>
  );
}
