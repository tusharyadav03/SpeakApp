import React from "react";
import { Mic, Monitor, Smartphone, LogIn, LogOut, BarChart3, Globe, Wifi, Users } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Logo, Btn, Status } from "../components/ui";

export default function Landing({ ok, nav }) {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <Status ok={ok} />
      <nav className="w-full px-6 py-4 flex justify-between items-center max-w-6xl mx-auto">
        <Logo />
        <div className="flex items-center gap-2">
          {user ? (
            <>
              {["admin", "superadmin"].includes(user.role) && <Btn v="ghost" sz="sm" onClick={() => nav("admin")}><BarChart3 size={16} /> Admin</Btn>}
              <span className="text-slate-500 text-sm hidden sm:inline">{user.name}</span>
              <Btn v="ghost" sz="sm" onClick={logout}><LogOut size={16} /></Btn>
            </>
          ) : (
            <Btn v="ghost" sz="sm" onClick={() => nav("login")}><LogIn size={16} /> Sign in</Btn>
          )}
        </div>
      </nav>

      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-20">
        <div className="animate-slide-up text-center max-w-2xl">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-sm font-medium mb-8">
            <Mic size={14} />
            Real-time conference Q&A platform
          </div>
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight text-slate-900 mb-5 leading-[1.1]">
            Every voice<br />
            <span className="text-blue-600">deserves to be heard</span>
          </h1>
          <p className="text-lg md:text-xl text-slate-500 mb-10 max-w-lg mx-auto leading-relaxed">
            Stream audio directly from phones to venue speakers. No app downloads, no microphone queues. Just scan & speak.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Btn sz="lg" onClick={() => nav("host")} className="px-8 py-3.5 text-base shadow-md shadow-blue-600/20">
              <Monitor size={18} /> Host an Event
            </Btn>
            <Btn v="outline" sz="lg" onClick={() => nav("join")} className="px-8 py-3.5 text-base">
              <Smartphone size={18} /> Join Event
            </Btn>
          </div>
        </div>

        <div className="mt-16 flex flex-wrap items-center justify-center gap-8 text-sm text-slate-400">
          <div className="flex items-center gap-2"><Globe size={16} className="text-blue-500" /> 27 languages</div>
          <div className="flex items-center gap-2"><Wifi size={16} className="text-emerald-500" /> WebRTC audio</div>
          <div className="flex items-center gap-2"><Users size={16} className="text-violet-500" /> No app needed</div>
        </div>
      </div>
    </div>
  );
}
