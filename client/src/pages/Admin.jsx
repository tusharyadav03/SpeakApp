import React, { useState, useEffect } from "react";
import { ArrowLeft, Users, Monitor, TrendingUp } from "lucide-react";
import { API } from "../config/api";
import { useAuth } from "../context/AuthContext";
import { Logo, Btn, Card } from "../components/ui";

export default function Admin({ onBack }) {
  const { token } = useAuth();
  const [stats, setStats] = useState(null);
  useEffect(() => {
    fetch(`${API}/api/admin/stats`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json()).then(setStats).catch(() => {});
  }, [token]);
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6">
        <Logo sm />
        <Btn v="ghost" sz="sm" onClick={onBack}><ArrowLeft size={16} /> Back</Btn>
      </header>
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-900 mb-6">Dashboard</h1>
        <div className="grid grid-cols-3 gap-4">
          {[
            { i: Users, l: "Total Users", v: stats?.totalUsers || 0, color: "blue" },
            { i: Monitor, l: "Events Created", v: stats?.totalEvents || 0, color: "violet" },
            { i: TrendingUp, l: "Active Now", v: stats?.activeEvents || 0, color: "emerald" },
          ].map((x, i) => (
            <Card key={i}>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${x.color === "blue" ? "bg-blue-50 text-blue-600" : x.color === "violet" ? "bg-violet-50 text-violet-600" : "bg-emerald-50 text-emerald-600"}`}>
                <x.i size={20} />
              </div>
              <div className="text-2xl font-bold text-slate-900">{x.v}</div>
              <div className="text-sm text-slate-500 mt-1">{x.l}</div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
