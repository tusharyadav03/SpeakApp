import React, { useState } from "react";
import { ArrowLeft, AlertCircle } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Logo, Btn, Field } from "../components/ui";

export default function Login({ onBack, onSwitch }) {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async (e) => { e.preventDefault(); setErr(""); setBusy(true); try { await login(email, pw); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-sm w-full animate-slide-up">
        <button onClick={onBack} className="mb-8 text-slate-400 hover:text-slate-700 flex items-center gap-2 text-sm font-medium"><ArrowLeft size={16} /> Back</button>
        <Logo />
        <h2 className="text-2xl font-bold text-slate-900 mt-6 mb-1">Welcome back</h2>
        <p className="text-slate-500 mb-6 text-sm">Sign in to manage your events</p>
        {err && <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-red-600 text-sm flex items-center gap-2"><AlertCircle size={16} /> {err}</div>}
        <form onSubmit={go} className="space-y-4">
          <Field label="Email" type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Field label="Password" type="password" placeholder="••••••••" value={pw} onChange={(e) => setPw(e.target.value)} required />
          <Btn type="submit" disabled={busy} className="w-full">{busy ? "Signing in..." : "Sign In"}</Btn>
        </form>
        <p className="text-center text-slate-400 mt-6 text-sm">No account? <button onClick={onSwitch} className="text-blue-600 hover:underline font-medium">Create one</button></p>
        <div className="mt-6 pt-6 border-t border-slate-200"><p className="text-center text-slate-400 text-xs">Demo: <code className="text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">admin@speakapp.io</code> / <code className="text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">admin123</code></p></div>
      </div>
    </div>
  );
}
