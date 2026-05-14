import React, { useEffect, useState, useRef } from "react";
import { Mic } from "lucide-react";
import { getSocket } from "../config/socket";
import { QR, Logo, Dot, Waveform } from "../components/ui";

/* ─────────────────────────────────────────────────────────────
   Presenter — the big-screen projection view for the venue.
   Listens passively to room_data + transcript_update. Does NOT
   capture mic or join as attendee — it's a display-only observer.
   Opened via /?presenter=ROOMCODE
   ───────────────────────────────────────────────────────────── */
export default function Presenter({ roomId: initialRoomId }) {
  const [room, setRoom] = useState(null);
  const [transcript, setTranscript] = useState([]);
  const [elapsed, setElapsed] = useState(0);
  const s = useRef(getSocket());
  const startAt = useRef(null);

  const roomId = (initialRoomId || "").toUpperCase();
  const joinUrl = `${window.location.origin}?room=${roomId}`;

  useEffect(() => {
    const sk = s.current;
    const ensureJoin = () => sk.emit("presenter_join", { roomId });

    sk.on("connect", ensureJoin);
    if (sk.connected) ensureJoin();

    const onRoomData = (d) => setRoom((p) => ({ ...(p || {}), ...d }));
    const onTranscript = (e) => setTranscript((p) => [...p.slice(-19), e]);
    const onEnd = () => setRoom(null);

    sk.on("room_data", onRoomData);
    sk.on("transcript_update", onTranscript);
    sk.on("event_ended", onEnd);

    return () => {
      sk.off("connect", ensureJoin);
      sk.off("room_data", onRoomData);
      sk.off("transcript_update", onTranscript);
      sk.off("event_ended", onEnd);
    };
  }, [roomId]);

  /* Live timer for current speaker */
  useEffect(() => {
    if (room?.currentSpeaker) {
      startAt.current = Date.now();
      const id = setInterval(
        () => setElapsed(Math.floor((Date.now() - startAt.current) / 1000)),
        500
      );
      return () => clearInterval(id);
    }
    startAt.current = null;
    setElapsed(0);
  }, [room?.currentSpeaker?.id]);

  const fmt = (n) =>
    `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

  const currentSpeaker = room?.currentSpeaker;
  const queue = room?.queue || [];
  const latestCaption = transcript[transcript.length - 1]?.text;

  return (
    <div
      className="relative w-screen h-screen overflow-hidden flex flex-col stage-grain"
      style={{
        background:
          "radial-gradient(circle at 20% 20%, #1a1f2e 0%, #0b0c10 55%, #05070b 100%)",
        color: "#fff",
        fontFamily: "var(--font-body)",
      }}
    >
      {/* ── Top bar ── */}
      <header className="flex items-center justify-between px-8 py-5 shrink-0 z-10">
        <div className="flex items-center gap-4">
          <Logo />
          <div className="h-6 w-px bg-white/15" />
          <span
            className="mono px-3 py-1 rounded-lg text-sm font-semibold tracking-widest"
            style={{
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "#fff",
            }}
          >
            {roomId}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {currentSpeaker ? (
            <span
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold"
              style={{
                background: "var(--live)",
                color: "#062a17",
              }}
            >
              <Dot kind="ink" pulse size={8} /> LIVE · {fmt(elapsed)}
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm"
              style={{
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.12)",
              }}
            >
              <Dot kind="muted" size={8} /> Standing by
            </span>
          )}
        </div>
      </header>

      {/* ── Center stage ── */}
      <main className="flex-1 flex items-center justify-center px-12 relative z-10">
        {currentSpeaker ? (
          <div className="text-center w-full max-w-4xl">
            <div className="flex items-center justify-center mb-10">
              <div
                className="w-40 h-40 rounded-full flex items-center justify-center live-ring"
                style={{
                  background: "var(--live)",
                  boxShadow:
                    "0 30px 100px color-mix(in oklab, var(--live) 60%, transparent)",
                }}
              >
                <Mic size={72} color="#062a17" />
              </div>
            </div>
            <h1
              className="text-7xl md:text-8xl font-extrabold leading-none mb-4 tracking-tight"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {currentSpeaker.name}
            </h1>
            {currentSpeaker.question && (
              <p
                className="text-2xl mb-6 max-w-2xl mx-auto"
                style={{ color: "rgba(255,255,255,0.75)" }}
              >
                "{currentSpeaker.question}"
              </p>
            )}
            <div className="max-w-lg mx-auto mb-6">
              <Waveform active color="var(--live)" bars={42} height={70} />
            </div>
            {latestCaption && (
              <div
                className="mt-8 mx-auto max-w-3xl px-6 py-4 rounded-2xl text-xl md:text-2xl leading-snug"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "rgba(255,255,255,0.92)",
                }}
              >
                {latestCaption}
              </div>
            )}
          </div>
        ) : (
          <div className="text-center w-full max-w-3xl">
            <div
              className="inline-block p-6 rounded-3xl mb-8"
              style={{
                background: "#fff",
                boxShadow: "0 30px 80px rgba(0,0,0,0.5)",
              }}
            >
              <QR value={joinUrl} size={360} />
            </div>
            <h1
              className="text-6xl md:text-7xl font-extrabold leading-none mb-4"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Scan to join
            </h1>
            <p
              className="text-xl md:text-2xl mb-6"
              style={{ color: "rgba(255,255,255,0.7)" }}
            >
              or visit{" "}
              <span className="mono" style={{ color: "var(--live)" }}>
                {window.location.host}
              </span>{" "}
              · room code{" "}
              <span className="mono font-bold" style={{ color: "var(--live)" }}>
                {roomId}
              </span>
            </p>
          </div>
        )}
      </main>

      {/* ── Bottom: queue ticker ── */}
      <footer
        className="shrink-0 z-10 px-8 py-4 border-t"
        style={{
          borderColor: "rgba(255,255,255,0.08)",
          background: "rgba(0,0,0,0.35)",
          backdropFilter: "blur(8px)",
        }}
      >
        <div className="flex items-center gap-4">
          <span
            className="text-xs font-bold uppercase tracking-[0.2em] shrink-0"
            style={{ color: "rgba(255,255,255,0.55)" }}
          >
            Next up
          </span>
          {queue.length > 0 ? (
            <div className="flex-1 overflow-hidden">
              <div className="ticker-track">
                {[...queue, ...queue].map((p, i) => (
                  <span
                    key={`${p.id}-${i}`}
                    className="inline-flex items-center gap-3 mx-8 text-lg"
                  >
                    <span
                      className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-sm"
                      style={{
                        background: "var(--live)",
                        color: "#062a17",
                      }}
                    >
                      {(i % queue.length) + 1}
                    </span>
                    <span className="font-semibold">{p.name}</span>
                    {p.question && (
                      <span style={{ color: "rgba(255,255,255,0.55)" }}>
                        — "{p.question}"
                      </span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <span
              className="text-sm"
              style={{ color: "rgba(255,255,255,0.45)" }}
            >
              Queue is empty — raise your hand to go first.
            </span>
          )}
        </div>
      </footer>
    </div>
  );
}
