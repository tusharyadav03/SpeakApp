import React, { useState, useEffect, useRef, useCallback } from "react";
import { Mic, Send, Hand, Square, X, LogOut } from "lucide-react";
import { getSocket, onConnState } from "../config/socket";
import { ICE, optimizeSDP, turnReady } from "../config/webrtc";
import { AudioSender } from "../config/audioFallback";
import {
  Btn,
  Card,
  LinkedInIcon,
  Dot,
  Waveform,
  ConnPill,
  HoldToConfirm,
} from "../components/ui";
import TranscriptPanel from "../components/TranscriptPanel";

/* ─────────────────────────────────────────────────────────────
   Phone-frame shell (attendee view lives inside)
   ───────────────────────────────────────────────────────────── */
function PhoneShell({ children, tone = "paper" }) {
  const bgMap = {
    paper: "var(--paper)",
    soft: "var(--soft)",
    live: "var(--live)",
    ink: "var(--ink)",
  };
  return (
    <div
      className="min-h-screen w-full flex items-start md:items-center justify-center px-4 py-6"
      style={{ background: "var(--soft)" }}
    >
      <div
        className="w-full max-w-[420px] rounded-[28px] overflow-hidden border shadow-sm flex flex-col"
        style={{
          background: bgMap[tone],
          borderColor: "var(--line)",
          minHeight: "min(92vh, 820px)",
          color: tone === "live" ? "#062a17" : tone === "ink" ? "#fff" : "var(--ink)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default function Attendee({ room, user, onExit }) {
  const [q, setQ] = useState("");
  const [fuStatus, setFuStatus] = useState(null);
  const [transcript, setTranscript] = useState([]);
  const [canRejoin, setCanRejoin] = useState(false);
  const [handoffCountdown, setHandoffCountdown] = useState(null);
  const [connState, setConnState] = useState("connected");
  const [hostGone, setHostGone] = useState(false);
  const [audioMode, setAudioMode] = useState(null); // 'webrtc' | 'websocket' | null
  const pc = useRef(null);
  const stream = useRef(null);
  const recognition = useRef(null);
  const iceCandidateBuffer = useRef([]);
  const remoteDescSet = useRef(false);
  const audioSender = useRef(null);
  const rtcTimeout = useRef(null);
  const s = useRef(getSocket());

  // Track connection state for ConnPill
  useEffect(() => onConnState(setConnState), []);

  /* ─── Speaker-side SR ─── */
  const startSR = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      console.warn("SpeechRecognition not supported in this browser");
      return;
    }
    if (recognition.current) return;

    let errorRetries = 0;
    const MAX_RETRIES = 8;

    const recog = new SR();
    recog.continuous = true;
    recog.interimResults = false;
    recog.lang = "en-US";
    recog.maxAlternatives = 1;

    recog.onresult = (event) => {
      errorRetries = 0; // reset on success
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          const text = event.results[i][0].transcript.trim();
          if (text)
            s.current.emit("transcript_send", {
              roomId: room.id,
              speaker: user?.name || "Speaker",
              text,
            });
        }
      }
    };

    recog.onerror = (e) => {
      if (["no-speech", "audio-capture", "network"].includes(e.error)) {
        errorRetries++;
        if (errorRetries > MAX_RETRIES) {
          console.warn("Guest SR max retries reached");
          recognition.current = null;
          s.current.emit("sr_active", { roomId: room.id, active: false });
          return;
        }
        setTimeout(() => {
          try {
            if (recognition.current === recog) recog.start();
          } catch {}
        }, 500 + errorRetries * 200);
      }
      if (e.error === "not-allowed") {
        recognition.current = null;
        s.current.emit("sr_active", { roomId: room.id, active: false });
      }
    };

    recog.onend = () => {
      if (recognition.current === recog) {
        try {
          recog.start();
        } catch {}
      }
    };

    try {
      recog.start();
      recognition.current = recog;
      // Tell server guest SR is active — host mic should be suppressed
      s.current.emit("sr_active", { roomId: room.id, active: true });
    } catch (err) {
      console.error("SR start failed:", err);
    }
  }, [room.id, user?.name]);

  const stopSR = useCallback(() => {
    if (recognition.current) {
      const r = recognition.current;
      recognition.current = null;
      try {
        r.stop();
      } catch {}
      // Tell server guest SR stopped
      s.current.emit("sr_active", { roomId: room.id, active: false });
    }
  }, [room.id]);

  const myId = s.current?.id;
  const inQueue = room.queue?.some((x) => x.id === myId);
  const qPos = (room.queue?.findIndex((x) => x.id === myId) ?? -1) + 1;
  const speaking = room.currentSpeaker?.id === myId;

  /* ─── WebSocket audio fallback ─── */
  const startWSAudio = useCallback(async () => {
    console.log("🔄 Falling back to WebSocket audio...");
    // Clean up WebRTC
    if (pc.current) { try { pc.current.close(); } catch {} pc.current = null; }
    if (stream.current) { stream.current.getTracks().forEach(t => t.stop()); stream.current = null; }

    const sender = new AudioSender(s.current, room.id);
    const ok = await sender.start();
    if (ok) {
      audioSender.current = sender;
      setAudioMode('websocket');
      s.current.emit('audio_mode', { roomId: room.id, mode: 'websocket' });
    }
  }, [room.id]);

  /* ─── WebRTC (primary) ─── */
  const startRTC = useCallback(async () => {
    try {
      // Reset candidate buffer
      iceCandidateBuffer.current = [];
      remoteDescSet.current = false;

      // ── Anti-echo mic constraints ──
      // echoCancellation: browser AEC removes speaker output picked up by mic
      // noiseSuppression: kills ambient room noise / PA bleed
      // autoGainControl: prevents mic gain from amplifying echo
      // googEchoCancellation2 + googAutoGainControl2: Chrome-specific enhanced AEC
      const ms = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: true },
          channelCount: 1,
          sampleRate: 48000,
          // Chrome-specific enhanced echo cancellation
          googEchoCancellation: { ideal: true },
          googExperimentalEchoCancellation: { ideal: true },
          googAutoGainControl: { ideal: true },
          googNoiseSuppression: { ideal: true },
          googHighpassFilter: { ideal: true },
          googExperimentalNoiseSuppression: { ideal: true },
        },
      });
      stream.current = ms;

      // Close any existing PC before creating new one
      if (pc.current) { try { pc.current.close(); } catch {} pc.current = null; }

      const c = new RTCPeerConnection(ICE);
      pc.current = c;

      // ── Voice Activity Detection gate ──
      // Only send audio when user is actually speaking (reduces echo + bandwidth)
      const audioCtx = new AudioContext();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      const source = audioCtx.createMediaStreamSource(ms);
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      // Track if voice is active — mute track when silent
      const audioTrack = ms.getAudioTracks()[0];
      let silenceFrames = 0;
      const VAD_THRESHOLD = 15; // amplitude threshold
      const SILENCE_FRAMES_TO_MUTE = 20; // ~600ms of silence before muting
      const vadInterval = setInterval(() => {
        if (!audioTrack || audioTrack.readyState === 'ended') { clearInterval(vadInterval); return; }
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        if (avg < VAD_THRESHOLD) {
          silenceFrames++;
          if (silenceFrames > SILENCE_FRAMES_TO_MUTE && audioTrack.enabled) {
            audioTrack.enabled = false; // mute during silence — kills echo tail
          }
        } else {
          silenceFrames = 0;
          if (!audioTrack.enabled) audioTrack.enabled = true;
        }
      }, 30);

      // Store cleanup refs
      c._vadCleanup = () => { clearInterval(vadInterval); audioCtx.close().catch(() => {}); };

      ms.getTracks().forEach((t) => c.addTrack(t, ms));

      c.onicecandidate = (e) => {
        if (e.candidate)
          s.current.emit("webrtc_ice", {
            roomId: room.id,
            candidate: e.candidate,
            to: null,
          });
      };

      let iceRestartCount = 0;
      const MAX_ICE_RESTARTS = 3;

      c.oniceconnectionstatechange = () => {
        if (pc.current !== c) return;
        const state = c.iceConnectionState;
        console.log(`🧊 ICE state: ${state}`);

        if (state === "connected" || state === "completed") {
          iceRestartCount = 0;
          setAudioMode('webrtc');
          // Clear fallback timeout — WebRTC connected
          if (rtcTimeout.current) { clearTimeout(rtcTimeout.current); rtcTimeout.current = null; }
        }
        if (state === "failed") {
          if (iceRestartCount < MAX_ICE_RESTARTS) {
            iceRestartCount++;
            console.warn(`ICE failed, restart ${iceRestartCount}/${MAX_ICE_RESTARTS}`);
            c.restartIce();
          } else {
            // WebRTC exhausted → fallback to WebSocket audio
            console.warn("ICE exhausted → WebSocket audio fallback");
            startWSAudio();
          }
        }
        if (state === "disconnected") {
          setTimeout(() => {
            if (pc.current === c && c.iceConnectionState === "disconnected") {
              console.warn("ICE still disconnected, restarting...");
              c.restartIce();
            }
          }, 3000);
        }
      };

      // Create offer with Opus optimization
      const offer = await c.createOffer();
      if (pc.current !== c) return;
      // Optimize SDP: enable Opus FEC + DTX for resilient audio
      const optimizedOffer = { ...offer, sdp: optimizeSDP(offer.sdp) };
      await c.setLocalDescription(optimizedOffer);
      s.current.emit("webrtc_offer", { roomId: room.id, offer: optimizedOffer });

      // Auto-fallback timeout: if WebRTC doesn't connect in 10s, go WebSocket
      rtcTimeout.current = setTimeout(() => {
        if (pc.current === c && c.iceConnectionState !== 'connected' && c.iceConnectionState !== 'completed') {
          console.warn("WebRTC connection timeout (10s) → WebSocket fallback");
          startWSAudio();
        }
      }, 10000);

      startSR();
    } catch (err) {
      console.error("Microphone/WebRTC error:", err);
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        alert("Microphone access was denied. Please allow microphone permission in your browser settings and try again.");
      } else if (err.name === "NotFoundError") {
        alert("No microphone found. Please connect a microphone and try again.");
      } else {
        // Mic works but WebRTC failed — try WebSocket fallback
        console.warn("WebRTC setup failed, trying WebSocket fallback...");
        startWSAudio();
      }
    }
  }, [room.id, startSR, startWSAudio]);

  const stopRTC = useCallback(() => {
    stopSR();
    if (rtcTimeout.current) { clearTimeout(rtcTimeout.current); rtcTimeout.current = null; }
    if (audioSender.current) { audioSender.current.stop(); audioSender.current = null; }
    if (stream.current) {
      stream.current.getTracks().forEach((t) => t.stop());
      stream.current = null;
    }
    if (pc.current) {
      if (pc.current._vadCleanup) pc.current._vadCleanup(); // clean up VAD
      pc.current.close();
      pc.current = null;
    }
    setAudioMode(null);
  }, [stopSR]);

  /* ─── socket wiring ─── */
  useEffect(() => {
    const sk = s.current;
    let isSpeaking = false;
    let countdownT = null;

    sk.on("floor_granted", () => {
      isSpeaking = true;
      setCanRejoin(false);
      // "Going live" 3-sec countdown (prototype handoff)
      setHandoffCountdown(3);
      if (countdownT) clearInterval(countdownT);
      countdownT = setInterval(() => {
        setHandoffCountdown((c) => {
          if (c === null) return null;
          if (c <= 1) {
            clearInterval(countdownT);
            countdownT = null;
            return null;
          }
          return c - 1;
        });
      }, 1000);
      // Start RTC immediately — we WANT mic capture to happen during the countdown
      // so there's no dead air when it hits zero
      startRTC();
    });
    sk.on("followup_approved", () => setFuStatus("approved"));
    sk.on("followup_declined", () => {
      isSpeaking = false;
      setFuStatus("declined");
      stopRTC();
      setTimeout(() => setFuStatus(null), 3000);
    });
    sk.on("speech_ended", () => {
      setFuStatus(null);
      setHandoffCountdown(null);
      if (!isSpeaking) stopRTC();
    });
    sk.on("speech_done_can_rejoin", () => {
      isSpeaking = false;
      setCanRejoin(true);
      setHandoffCountdown(null);
      stopRTC();
    });
    sk.on("removed_from_speaking", () => {
      isSpeaking = false;
      setFuStatus(null);
      setCanRejoin(false);
      setHandoffCountdown(null);
      stopRTC();
    });
    sk.on("removed_from_queue", () => {});
    sk.on("host_disconnected", () => setHostGone(true));
    sk.on("host_reconnected", () => setHostGone(false));
    sk.on("transcript_update", (e) =>
      setTranscript((p) => [...p.slice(-29), e])
    );
    sk.on("webrtc_answer", async ({ answer }) => {
      try {
        if (pc.current && pc.current.signalingState !== "closed") {
          await pc.current.setRemoteDescription(new RTCSessionDescription(answer));
          remoteDescSet.current = true;
          // Flush buffered ICE candidates
          while (iceCandidateBuffer.current.length > 0) {
            const c = iceCandidateBuffer.current.shift();
            try { await pc.current.addIceCandidate(new RTCIceCandidate(c)); } catch {}
          }
        }
      } catch (err) {
        console.error("WebRTC answer error:", err);
      }
    });
    sk.on("webrtc_ice", async ({ candidate }) => {
      try {
        if (!candidate) return;
        if (!remoteDescSet.current) {
          // Buffer until remote description is set
          iceCandidateBuffer.current.push(candidate);
          return;
        }
        if (pc.current && pc.current.signalingState !== "closed")
          await pc.current.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn("ICE candidate error:", err.message);
      }
    });
    // Handle socket reconnection — re-join room
    const onReconnect = () => {
      if (room.id) {
        sk.emit("join_room_attendee", { roomId: room.id, user });
      }
    };
    sk.on("connect", onReconnect);

    return () => {
      [
        "floor_granted",
        "followup_approved",
        "followup_declined",
        "speech_ended",
        "speech_done_can_rejoin",
        "removed_from_speaking",
        "removed_from_queue",
        "host_disconnected",
        "host_reconnected",
        "transcript_update",
        "webrtc_answer",
        "webrtc_ice",
        "connect",
      ].forEach((e) => sk.off(e));
      if (countdownT) clearInterval(countdownT);
      stopRTC();
    };
  }, [startRTC, stopRTC, room.id, user]);

  const reactions = ["🔥", "❤️", "👍", "👏", "🎉", "💡"];

  /* ═════════════════════════════════════════════════════════════
     STATE: Handoff countdown — 3-2-1 "you're going live"
     ═════════════════════════════════════════════════════════════ */
  if (speaking && handoffCountdown !== null) {
    return (
      <PhoneShell tone="ink">
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <p
            className="uppercase tracking-[0.25em] text-xs font-semibold mb-6"
            style={{ color: "rgba(255,255,255,0.6)" }}
          >
            You're going live
          </p>
          <div
            className="text-[180px] leading-none font-extrabold"
            style={{
              fontFamily: "var(--font-display)",
              color: "var(--live)",
              textShadow: "0 8px 60px color-mix(in oklab, var(--live) 50%, transparent)",
            }}
          >
            {handoffCountdown}
          </div>
          <p
            className="mt-6 text-sm"
            style={{ color: "rgba(255,255,255,0.55)" }}
          >
            Take a breath. Speak clearly.
          </p>
        </div>
      </PhoneShell>
    );
  }

  /* ═════════════════════════════════════════════════════════════
     STATE: Speaking
     ═════════════════════════════════════════════════════════════ */
  if (speaking) {
    return (
      <PhoneShell tone="live">
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div
            className="w-28 h-28 rounded-full flex items-center justify-center mb-5 live-ring"
            style={{
              background: "#fff",
              boxShadow: "0 12px 40px rgba(0,0,0,0.15)",
            }}
          >
            <Mic size={50} style={{ color: "var(--live)" }} />
          </div>
          <h2
            className="text-3xl font-extrabold mb-2"
            style={{ fontFamily: "var(--font-display)", color: "#062a17" }}
          >
            You're live
          </h2>
          <p className="mb-6 text-sm" style={{ color: "#062a17", opacity: 0.7 }}>
            Your voice is streaming to the room
            {audioMode === 'websocket' && <span className="block text-xs mt-1 opacity-60">(relay mode — slightly higher latency)</span>}
          </p>

          <div className="w-full max-w-[220px] mb-6">
            <Waveform active color="#062a17" bars={30} height={36} />
          </div>

          {fuStatus === "pending" && (
            <div
              className="rounded-xl px-3 py-2 mb-4 text-sm"
              style={{
                background: "rgba(255,255,255,0.2)",
                border: "1px solid rgba(255,255,255,0.3)",
                color: "#062a17",
              }}
            >
              Waiting for host approval…
            </div>
          )}
          {fuStatus === "approved" && (
            <div
              className="rounded-xl px-3 py-2 mb-4 text-sm font-semibold"
              style={{
                background: "#fff",
                color: "#062a17",
              }}
            >
              ✓ You may continue
            </div>
          )}
          {fuStatus === "declined" && (
            <div
              className="rounded-xl px-3 py-2 mb-4 text-sm"
              style={{
                background: "rgba(239,68,68,0.18)",
                color: "#7f1d1d",
                border: "1px solid rgba(239,68,68,0.25)",
              }}
            >
              Follow-up declined
            </div>
          )}

          <div className="space-y-3 w-full max-w-[260px]">
            {fuStatus !== "pending" && (
              <button
                onClick={() => {
                  s.current.emit("signal_followup", room.id);
                  setFuStatus("pending");
                }}
                className="w-full rounded-[12px] py-3 font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                style={{
                  background: "rgba(255,255,255,0.22)",
                  color: "#062a17",
                  border: "1px solid rgba(255,255,255,0.32)",
                }}
              >
                <Hand size={18} /> Request follow-up
              </button>
            )}
            <HoldToConfirm
              label="Hold to end turn"
              duration={1200}
              variant="ink"
              onConfirm={() => {
                s.current.emit("end_speech", room.id);
                stopRTC();
              }}
              className="w-full"
              sz="lg"
            >
              <Square size={18} /> Hold to end turn
            </HoldToConfirm>
          </div>
        </div>
      </PhoneShell>
    );
  }

  /* ═════════════════════════════════════════════════════════════
     STATE: Post-speech rejoin
     ═════════════════════════════════════════════════════════════ */
  if (canRejoin && !inQueue) {
    return (
      <PhoneShell>
        <div className="flex-1 flex flex-col items-center justify-center p-6">
          <Card className="w-full text-center animate-slide-up" style={{ background: "var(--paper)" }}>
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
              style={{
                background: "color-mix(in oklab, var(--accent) 14%, white)",
              }}
            >
              <Hand size={26} style={{ color: "var(--accent)" }} />
            </div>
            <h2
              className="text-xl font-extrabold mb-2"
              style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
            >
              Your turn ended
            </h2>
            <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>
              Would you like to ask a follow-up?
            </p>
            <div className="space-y-2.5">
              <Btn
                v="primary"
                sz="lg"
                onClick={() => {
                  s.current.emit("rejoin_queue", { roomId: room.id, user });
                  setCanRejoin(false);
                }}
                className="w-full"
              >
                <Hand size={18} /> Rejoin queue
              </Btn>
              <Btn
                v="outline"
                sz="lg"
                onClick={() => setCanRejoin(false)}
                className="w-full"
              >
                Stay as audience
              </Btn>
            </div>
          </Card>
        </div>
      </PhoneShell>
    );
  }

  /* ═════════════════════════════════════════════════════════════
     STATE: Main view (idle or in-queue)
     ═════════════════════════════════════════════════════════════ */
  return (
    <PhoneShell>
      {/* ── Phone header ── */}
      <header
        className="px-5 pt-5 pb-3 flex justify-between items-center border-b"
        style={{ borderColor: "var(--line)" }}
      >
        <div className="min-w-0">
          <h1
            className="font-extrabold text-base truncate"
            style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
          >
            {room.name}
          </h1>
          <p
            className="text-xs flex items-center gap-1.5 mt-0.5"
            style={{ color: "var(--muted)" }}
          >
            {room.currentSpeaker ? (
              <>
                <Dot kind="live" pulse size={6} />
                <span className="truncate">
                  {room.currentSpeaker.name} speaking
                </span>
              </>
            ) : (
              "Waiting for speaker"
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ConnPill state={connState === "connected" ? "good" : connState === "reconnecting" ? "reconnecting" : "lost"} />
          <button
            onClick={onExit}
            className="p-2 rounded-lg"
            style={{ color: "var(--muted)" }}
            title="Exit"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {/* ── Host disconnected warning ── */}
      {hostGone && (
        <div className="px-5 py-2.5 text-center text-sm font-medium border-b"
          style={{ background: "#fef3c7", color: "#92400e", borderColor: "#fde68a" }}>
          Host connection lost. Waiting for reconnection...
        </div>
      )}

      {/* ── Live caption ribbon ── */}
      {room.currentSpeaker && transcript.length > 0 && (
        <div
          className="px-5 py-2.5 border-b text-[13px] line-clamp-2"
          style={{
            background: "color-mix(in oklab, var(--accent) 8%, white)",
            borderColor: "var(--line)",
            color: "var(--ink)",
          }}
        >
          <span
            className="uppercase text-[10px] font-bold tracking-wider mr-2"
            style={{ color: "var(--accent)" }}
          >
            Live caption
          </span>
          {transcript[transcript.length - 1]?.text}
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto px-5 py-5">
        {inQueue ? (
          <>
            <div
              className="rounded-[14px] border p-6 text-center mb-4"
              style={{ background: "var(--paper)", borderColor: "var(--line)" }}
            >
              <p
                className="text-[11px] uppercase font-bold tracking-[0.15em] mb-2"
                style={{ color: "var(--muted)" }}
              >
                Your position
              </p>
              <div
                className="text-[84px] leading-none font-extrabold mb-1"
                style={{ fontFamily: "var(--font-display)", color: "var(--accent)" }}
              >
                {qPos}
              </div>
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                {qPos === 1
                  ? "You're next!"
                  : `${qPos - 1} ${qPos - 1 === 1 ? "person" : "people"} ahead`}
              </p>
              {room.queue && (
                <p className="text-xs mt-2" style={{ color: "var(--muted)" }}>
                  {room.queue.length} total in queue
                </p>
              )}
            </div>

            <div
              className="rounded-[14px] border p-4 mb-4"
              style={{ background: "var(--paper)", borderColor: "var(--line)" }}
            >
              <label
                className="text-[13px] font-medium mb-2 block"
                style={{ color: "var(--muted)" }}
              >
                Your question (optional)
              </label>
              <textarea
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="w-full rounded-[12px] p-3 text-sm outline-none resize-none"
                style={{
                  background: "var(--soft)",
                  border: "1px solid var(--line)",
                  color: "var(--ink)",
                }}
                rows={3}
                placeholder="What do you want to ask?"
              />
              <Btn
                v="primary"
                sz="md"
                onClick={() => {
                  if (q.trim()) {
                    s.current.emit("submit_question", {
                      roomId: room.id,
                      text: q,
                    });
                    setQ("");
                  }
                }}
                className="w-full mt-3"
              >
                <Send size={14} /> Submit question
              </Btn>
            </div>

            <div className="text-center mb-5">
              <button
                onClick={() => s.current.emit("leave_queue", room.id)}
                className="text-sm font-semibold"
                style={{ color: "#ef4444" }}
              >
                Leave queue
              </button>
            </div>

            <TranscriptPanel transcript={transcript} compact />
          </>
        ) : (
          <>
            <div
              className="rounded-[14px] border p-5 text-center mb-4"
              style={{ background: "var(--paper)", borderColor: "var(--line)" }}
            >
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3"
                style={{
                  background: "color-mix(in oklab, var(--accent) 14%, white)",
                }}
              >
                <span
                  className="text-xl font-bold"
                  style={{ color: "var(--accent)" }}
                >
                  {user.name?.charAt(0)?.toUpperCase() || "?"}
                </span>
              </div>
              <h3
                className="font-extrabold text-lg"
                style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
              >
                {user.name}
              </h3>
              {user.linkedin && (
                <a
                  href={
                    user.linkedin.startsWith("http")
                      ? user.linkedin
                      : `https://linkedin.com/in/${user.linkedin}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1 text-sm mt-1.5"
                  style={{ color: "var(--accent)" }}
                >
                  <LinkedInIcon size={14} /> LinkedIn profile
                </a>
              )}
            </div>

            <Btn
              v="accent"
              sz="lg"
              onClick={() =>
                s.current.emit("join_queue", { roomId: room.id, user })
              }
              className="w-full mb-6 py-4 text-base"
            >
              <Mic size={20} /> Raise hand to speak
            </Btn>

            <div className="text-center mb-6">
              <p
                className="text-[11px] font-bold uppercase tracking-[0.15em] mb-3"
                style={{ color: "var(--muted)" }}
              >
                Reactions
              </p>
              <div className="flex justify-center gap-2 flex-wrap">
                {reactions.map((e) => (
                  <button
                    key={e}
                    onClick={() =>
                      s.current.emit("send_reaction", {
                        roomId: room.id,
                        emoji: e,
                      })
                    }
                    className="w-11 h-11 rounded-xl text-xl active:scale-90 transition border"
                    style={{
                      background: "var(--paper)",
                      borderColor: "var(--line)",
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>

            <TranscriptPanel transcript={transcript} compact />
          </>
        )}
      </div>
    </PhoneShell>
  );
}
