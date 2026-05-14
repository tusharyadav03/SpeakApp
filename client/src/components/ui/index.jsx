import React, { useState, useRef, useEffect, useCallback } from "react";
import { Wifi, WifiOff, Copy, Check } from "lucide-react";

/* ─────────────────────────────────────────────────────────────
   Logo  —  warm paper/ink look (prototype v2)
   ───────────────────────────────────────────────────────────── */
export const Logo = ({ sm }) => (
  <div className="flex items-center gap-2.5 select-none">
    <div
      className={`${sm ? "w-8 h-8 text-sm" : "w-9 h-9 text-base"} rounded-xl flex items-center justify-center font-bold text-white shadow-sm`}
      style={{ background: "var(--ink)" }}
    >
      S
    </div>
    <span
      className={`${sm ? "text-lg" : "text-xl"} tracking-tight font-extrabold`}
      style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
    >
      Speak<span style={{ color: "var(--accent)" }}>App</span>
    </span>
  </div>
);

/* ─────────────────────────────────────────────────────────────
   Card  —  paper surface with soft border
   ───────────────────────────────────────────────────────────── */
export const Card = ({ children, className = "", style = {} }) => (
  <div
    className={`rounded-[14px] border p-5 ${className}`}
    style={{
      background: "var(--paper)",
      borderColor: "var(--line)",
      ...style,
    }}
  >
    {children}
  </div>
);

/* ─────────────────────────────────────────────────────────────
   Btn  —  variants remapped to prototype tokens
   primary  = ink / paper
   accent   = accent / paper
   outline  = paper / line-border
   ghost    = transparent
   danger   = red
   live     = live-green
   secondary (legacy) → outline
   success  (legacy) → accent
   ───────────────────────────────────────────────────────────── */
export const Btn = ({
  children,
  v = "primary",
  sz = "md",
  disabled,
  onClick,
  className = "",
  type = "button",
  style = {},
  title,
}) => {
  const base =
    "font-semibold rounded-[12px] transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed select-none cursor-pointer active:scale-[0.98]";

  const variantStyle = {
    primary: {
      background: "var(--ink)",
      color: "var(--paper)",
      border: "1px solid var(--ink)",
    },
    accent: {
      background: "var(--accent)",
      color: "#fff",
      border: "1px solid var(--accent)",
    },
    outline: {
      background: "var(--paper)",
      color: "var(--ink)",
      border: "1px solid var(--line)",
    },
    ghost: {
      background: "transparent",
      color: "var(--muted)",
      border: "1px solid transparent",
    },
    danger: {
      background: "#fee2e2",
      color: "#b91c1c",
      border: "1px solid #fecaca",
    },
    live: {
      background: "var(--live)",
      color: "#062a17",
      border: "1px solid var(--live)",
    },
    /* legacy aliases so older pages keep working */
    secondary: {
      background: "var(--paper)",
      color: "var(--ink)",
      border: "1px solid var(--line)",
    },
    success: {
      background: "var(--accent)",
      color: "#fff",
      border: "1px solid var(--accent)",
    },
  };

  const ss = {
    xs: "px-2.5 py-1.5 text-xs",
    sm: "px-3 py-1.5 text-[13px]",
    md: "px-4 py-2 text-sm",
    lg: "px-5 py-2.5 text-[15px]",
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${base} ${ss[sz] || ss.md} ${className}`}
      style={{ ...(variantStyle[v] || variantStyle.primary), ...style }}
    >
      {children}
    </button>
  );
};

/* ─────────────────────────────────────────────────────────────
   Field
   ───────────────────────────────────────────────────────────── */
export const Field = ({ label, className = "", ...p }) => (
  <div className={`w-full ${className}`}>
    {label && (
      <label
        className="block text-[13px] font-medium mb-1.5"
        style={{ color: "var(--muted)" }}
      >
        {label}
      </label>
    )}
    <input
      className="w-full px-3.5 py-2.5 rounded-[12px] outline-none transition text-sm"
      style={{
        background: "var(--paper)",
        border: "1px solid var(--line)",
        color: "var(--ink)",
      }}
      onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
      onBlur={(e) => (e.target.style.borderColor = "var(--line)")}
      {...p}
    />
  </div>
);

/* ─────────────────────────────────────────────────────────────
   QR  —  external renderer, kept for reliability
   ───────────────────────────────────────────────────────────── */
export const QR = ({ value, size = 200 }) => (
  <img
    src={`https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(
      value
    )}&bgcolor=FFFFFF&color=0b0c10&margin=8`}
    alt="QR"
    className="rounded-xl"
    style={{ width: size, height: size, background: "#fff" }}
  />
);

/* ─────────────────────────────────────────────────────────────
   Status banner  —  socket connection indicator
   ───────────────────────────────────────────────────────────── */
export const Status = ({ ok }) => (
  <div
    className={`fixed top-4 right-4 z-50 px-3.5 py-2 rounded-full text-xs font-semibold flex items-center gap-2 shadow-sm border ${
      ok ? "" : "animate-pulse"
    }`}
    style={{
      background: ok ? "color-mix(in oklab, var(--live) 18%, white)" : "#fef3c7",
      color: ok ? "#065f46" : "#92400e",
      borderColor: ok ? "color-mix(in oklab, var(--live) 40%, white)" : "#fde68a",
    }}
  >
    {ok ? <Wifi size={13} /> : <WifiOff size={13} />}
    {ok ? "Connected" : "Connecting..."}
  </div>
);

/* ─────────────────────────────────────────────────────────────
   CopyBtn
   ───────────────────────────────────────────────────────────── */
export const CopyBtn = ({ text }) => {
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setOk(true);
        setTimeout(() => setOk(false), 1600);
      }}
      className="p-1.5 rounded-lg transition"
      style={{ background: "transparent" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--soft)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {ok ? (
        <Check size={16} style={{ color: "var(--live)" }} />
      ) : (
        <Copy size={16} style={{ color: "var(--muted)" }} />
      )}
    </button>
  );
};

/* ─────────────────────────────────────────────────────────────
   LinkedInIcon
   ───────────────────────────────────────────────────────────── */
export const LinkedInIcon = ({ size = 16, className = "" }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
    <rect width="4" height="12" x="2" y="9" />
    <circle cx="4" cy="4" r="2" />
  </svg>
);

/* ─────────────────────────────────────────────────────────────
   Dot  —  colored status dot with optional pulse
   kind: "ink" | "accent" | "live" | "danger" | "muted"
   ───────────────────────────────────────────────────────────── */
export const Dot = ({ kind = "live", pulse = false, size = 8, className = "" }) => {
  const colors = {
    ink: "var(--ink)",
    accent: "var(--accent)",
    live: "var(--live)",
    danger: "#ef4444",
    muted: "var(--muted)",
  };
  return (
    <span
      className={`inline-block rounded-full ${pulse ? "live-ring" : ""} ${className}`}
      style={{
        width: size,
        height: size,
        background: colors[kind] || colors.live,
      }}
    />
  );
};

/* ─────────────────────────────────────────────────────────────
   ConnPill  —  connection state indicator (good / reconnecting / lost)
   ───────────────────────────────────────────────────────────── */
export const ConnPill = ({ state = "good" }) => {
  const map = {
    good: { text: "Stable", kind: "live", pulse: false },
    reconnecting: { text: "Reconnecting…", kind: "accent", pulse: true },
    lost: { text: "Offline", kind: "danger", pulse: true },
  };
  const s = map[state] || map.good;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium border"
      style={{
        background: "var(--paper)",
        borderColor: "var(--line)",
        color: "var(--ink)",
      }}
    >
      <Dot kind={s.kind} pulse={s.pulse} />
      {s.text}
    </span>
  );
};

/* ─────────────────────────────────────────────────────────────
   Waveform  —  animated audio bars
   ───────────────────────────────────────────────────────────── */
export const Waveform = ({
  bars = 28,
  color = "var(--live)",
  active = true,
  height = 32,
}) => {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), 110);
    return () => clearInterval(id);
  }, [active]);

  return (
    <div
      className="flex items-end gap-[3px]"
      style={{ height }}
      aria-hidden="true"
    >
      {Array.from({ length: bars }).map((_, i) => {
        const seed = (i * 37 + tick * 13) % 100;
        const h = active ? 20 + (seed % 80) : 20;
        return (
          <span
            key={i}
            style={{
              width: 3,
              height: `${h}%`,
              background: color,
              borderRadius: 2,
              transition: "height 120ms ease",
              opacity: active ? 1 : 0.35,
            }}
          />
        );
      })}
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────
   HoldToConfirm  —  press-and-hold for destructive / stage actions
   Calls onConfirm() after the user holds for `duration` ms.
   Cancels if pointer leaves or releases early.
   ───────────────────────────────────────────────────────────── */
export const HoldToConfirm = ({
  label = "Hold to confirm",
  duration = 1500,
  onConfirm,
  variant = "danger", // "danger" | "accent" | "live" | "ink"
  sz = "md",
  disabled = false,
  className = "",
  children,
}) => {
  const [pct, setPct] = useState(0);
  const [holding, setHolding] = useState(false);
  const startedAt = useRef(0);
  const raf = useRef(null);
  const done = useRef(false);

  const stop = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    if (!done.current) setPct(0);
    setHolding(false);
  }, []);

  const start = useCallback(() => {
    if (disabled) return;
    done.current = false;
    startedAt.current = performance.now();
    setHolding(true);
    const step = (now) => {
      const p = Math.min(1, (now - startedAt.current) / duration);
      setPct(p);
      if (p >= 1) {
        done.current = true;
        raf.current = null;
        setHolding(false);
        onConfirm && onConfirm();
        return;
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, [disabled, duration, onConfirm]);

  useEffect(() => () => raf.current && cancelAnimationFrame(raf.current), []);

  const bgVar = {
    danger: "#ef4444",
    accent: "var(--accent)",
    live: "var(--live)",
    ink: "var(--ink)",
  }[variant];

  const ss = {
    xs: "px-2.5 py-1.5 text-xs",
    sm: "px-3 py-2 text-[13px]",
    md: "px-4 py-2.5 text-sm",
    lg: "px-5 py-3 text-[15px]",
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onMouseDown={start}
      onMouseUp={stop}
      onMouseLeave={stop}
      onTouchStart={(e) => {
        e.preventDefault();
        start();
      }}
      onTouchEnd={stop}
      onTouchCancel={stop}
      className={`relative overflow-hidden font-semibold rounded-[12px] border select-none transition-all disabled:opacity-40 ${ss[sz] || ss.md} ${className}`}
      style={{
        background: "var(--paper)",
        borderColor: "var(--line)",
        color: "var(--ink)",
      }}
    >
      <span
        className="absolute inset-y-0 left-0 pointer-events-none"
        style={{
          width: `${pct * 100}%`,
          background: bgVar,
          opacity: holding ? 0.9 : 0.75,
          transition: holding ? "none" : "width 220ms ease-out",
        }}
      />
      <span
        className="relative z-10 flex items-center justify-center gap-2"
        style={{
          color: pct > 0.45 ? "#fff" : "var(--ink)",
          transition: "color 120ms ease",
        }}
      >
        {children || label}
      </span>
    </button>
  );
};
