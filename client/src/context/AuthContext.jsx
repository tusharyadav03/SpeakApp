import React, { useState, useEffect, createContext, useContext } from "react";
import { API } from "../config/api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => {
    try { return localStorage.getItem("sa_token"); } catch { return null; }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return void setLoading(false);
    fetch(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setUser(d.user))
      .catch(() => { try { localStorage.removeItem("sa_token"); } catch {} setToken(null); })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, pw) => {
    const r = await fetch(`${API}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    try { localStorage.setItem("sa_token", d.token); } catch {}
    setToken(d.token); setUser(d.user);
  };

  const register = async (name, email, pw) => {
    const r = await fetch(`${API}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email, password: pw }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    try { localStorage.setItem("sa_token", d.token); } catch {}
    setToken(d.token); setUser(d.user);
  };

  const logout = () => { try { localStorage.removeItem("sa_token"); } catch {} setToken(null); setUser(null); };

  return <AuthCtx.Provider value={{ user, token, loading, login, register, logout }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
