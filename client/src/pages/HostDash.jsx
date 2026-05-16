import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Mic,
  Volume2,
  VolumeX,
  Power,
  Play,
  Square,
  Hand,
  X,
  Check,
  Users,
  MessageSquare,
  UserMinus,
  Monitor,
  Link as LinkIcon,
} from "lucide-react";
import { getSocket, onConnState } from "../config/socket";
import { ICE, optimizeSDP } from "../config/webrtc";
import { AudioReceiver } from "../config/audioFallback";
import {
  Logo,
  Btn,
  Card,
  QR,
  CopyBtn,
  Dot,
  Waveform,
  ConnPill,
  HoldToConfirm,
} from "../components/ui";
import LinkedInBadge from "../components/LinkedInBadge";
import TranscriptPanel from "../components/TranscriptPanel";

export default function HostDash({ room, onEnd }) {
  const [followUp, setFollowUp] = useState(null);
  const [rxns, setRxns] = useState([]);
  const [audioOn, setAudioOn] = useState(true);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const [transcribing, setTranscribing] = useState(false);
  const [speakerSR, setSpeakerSR] = useState(false);
  const [connState, setConnState] = useState("connected");
  const [audioMode, setAudioMode] = useState(null); // 'webrtc' | 'websocket'
  const audio = useRef(null);
  const remoteStream = useRef(null);
  const pc = useRef(null);
  const recognition = useRef(null);
  const iceCandidateBuffer = useRef([]);
  const remoteDescSet = useRef(false);
  const audioReceiver = useRef(null);
  const s = useRef(getSocket());

  // Track connection state
  useEffect(() => onConnState(setConnState), []);

  /* ────────────── audio gate ────────────── */
  const enableAudio = () => {
    const el = audio.current;
    if (!el) return;
    if (!el.srcObject && remoteStream.current) el.srcObject = remoteStream.current;
    el.muted = false;
    const p = el.play();
    if (p && typeof p.then === "function") {
      p.then(() => {
        setAudioBlocked(false);
        setAudioOn(true);
      }).catch((err) => {
        console.warn("enableAudio still blocked:", err.message);
        setAudioBlocked(true);
      });
    }
  };

  /* ────────────── host SR (moderator mic) ────────────── */
  const startTranscription = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      alert("Speech recognition is not supported in this browser. Try Chrome.");
      return;
    }
    if (recognition.current) return;

    let errorRetries = 0;
    const MAX_RETRIES = 5;

    const recog = new SR();
    recog.continuous = true;
    recog.interimResults = false;
    recog.lang = "en-US";
    recog.maxAlternatives = 1;

    recog.onresult = (event) => {
      errorRetries = 0; // reset on successful result
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          const text = event.results[i][0].transcript.trim();
          if (text) {
            s.current.emit("transcript_send", {
              roomId: room.id,
              speaker: room.currentSpeaker?.name || "Host",
              text,
            });
          }
        }
      }
    };

    recog.onerror = (e) => {
      if (["no-speech", "audio-capture", "network"].includes(e.error)) {
        errorRetries++;
        if (errorRetries > MAX_RETRIES) {
          console.warn("SR max retries reached, stopping");
          recognition.current = null;
          setTranscribing(false);
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
        setTranscribing(false);
        alert("Microphone permission needed for live transcription.");
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
      setTranscribing(true);
    } catch (err) {
      console.error("Failed to start transcription:", err);
    }
  }, [room.id, room.currentSpeaker?.name]);

  const stopTranscription = useCallback(() => {
    if (recognition.current) {
      const recog = recognition.current;
      recognition.current = null;
      try {
        recog.stop();
      } catch {}
      setTranscribing(false);
    }
  }, []);

  const hasPermission = useRef(false);
  useEffect(() => {
    if (room.currentSpeaker && recognition.current) stopTranscription();
    // Reset guest SR status when speaker changes
    if (!room.currentSpeaker) setSpeakerSR(false);
  }, [room.currentSpeaker?.id, stopTranscription]);

  /* ────────────── socket + webrtc wiring ────────────── */
  useEffect(() => {
    const sk = s.current;
    sk.on("followup_signal", ({ speakerName }) => setFollowUp(speakerName));
    sk.on("speaker_sr_status", ({ active }) => {
      setSpeakerSR(active);
      // Auto-stop host transcription when guest starts self-transcribing
      if (active && recognition.current) {
        const r = recognition.current;
        recognition.current = null;
        try { r.stop(); } catch {}
        setTranscribing(false);
      }
    });
    sk.on("reaction_received", (emoji) => {
      const id = Date.now() + Math.random();
      setRxns((p) => [...p, { id, emoji, left: Math.random() * 80 + 10 }]);
      setTimeout(() => setRxns((p) => p.filter((r) => r.id !== id)), 3500);
    });
    sk.on("transcript_update", (e) => setTranscript((p) => [...p.slice(-49), e]));

    sk.on("webrtc_offer", async ({ from, offer }) => {
      try {
        // Reset buffer for new connection
        iceCandidateBuffer.current = [];
        remoteDescSet.current = false;

        if (pc.current) {
          try { pc.current.close(); } catch {}
          pc.current = null;
        }
        const c = new RTCPeerConnection(ICE);
        pc.current = c;

        c.ontrack = (e) => {
          const el = audio.current;
          const ms = e.streams[0];
          if (!el || !ms) return;
          remoteStream.current = ms;
          el.srcObject = ms;
          el.muted = false;
          const tryPlay = () => el.play();
          tryPlay()
            .then(() => {
              setAudioBlocked(false);
              setAudioOn(true);
            })
            .catch((err) => {
              console.warn("Unmuted autoplay blocked:", err.message);
              el.muted = true;
              tryPlay().catch(() => {});
              setAudioBlocked(true);
              setAudioOn(false);
            });
        };

        c.onicecandidate = (e) => {
          if (e.candidate)
            sk.emit("webrtc_ice", { roomId: room.id, candidate: e.candidate, to: from });
        };

        let iceRestartCount = 0;
        c.oniceconnectionstatechange = () => {
          if (pc.current !== c) return;
          const state = c.iceConnectionState;
          console.log(`🧊 Host ICE: ${state}`);
          if (state === "connected" || state === "completed") iceRestartCount = 0;
          if (state === "failed") {
            if (iceRestartCount < 3) { iceRestartCount++; c.restartIce(); }
          }
          if (state === "disconnected") {
            setTimeout(() => {
              if (pc.current === c && c.iceConnectionState === "disconnected") c.restartIce();
            }, 3000);
          }
        };

        await c.setRemoteDescription(new RTCSessionDescription(offer));
        remoteDescSet.current = true;
        // Flush any buffered candidates
        while (iceCandidateBuffer.current.length > 0) {
          const cand = iceCandidateBuffer.current.shift();
          try { await c.addIceCandidate(new RTCIceCandidate(cand)); } catch {}
        }
        if (pc.current !== c) return;
        const ans = await c.createAnswer();
        // Optimize SDP: Opus FEC + DTX for resilient audio
        const optimizedAns = { ...ans, sdp: optimizeSDP(ans.sdp) };
        await c.setLocalDescription(optimizedAns);
        setAudioMode('webrtc');
        sk.emit("webrtc_answer", { roomId: room.id, answer: optimizedAns, to: from });
      } catch (err) {
        console.error("WebRTC error:", err);
      }
    });

    sk.on("webrtc_ice", async ({ candidate }) => {
      try {
        if (!candidate) return;
        if (!remoteDescSet.current) {
          iceCandidateBuffer.current.push(candidate);
          return;
        }
        if (pc.current && pc.current.signalingState !== "closed")
          await pc.current.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn("Host ICE candidate error:", err.message);
      }
    });

    // ─── WebSocket audio fallback receiver ───
    sk.on("audio_mode", ({ mode }) => {
      if (mode === 'websocket') {
        console.log("📡 Speaker using WebSocket audio fallback");
        setAudioMode('websocket');
        // Close WebRTC if active
        if (pc.current) { try { pc.current.close(); } catch {} pc.current = null; }
        // Start audio receiver
        if (!audioReceiver.current) {
          audioReceiver.current = new AudioReceiver();
          audioReceiver.current.start();
        }
      }
    });
    sk.on("audio_frame", ({ data }) => {
      if (audioReceiver.current) audioReceiver.current.feed(data);
    });

    // Host reconnection — rejoin room on socket reconnect
    const onReconnect = () => {
      if (room.id) sk.emit("host_rejoin", { roomId: room.id });
    };
    sk.on("connect", onReconnect);

    return () => {
      [
        "followup_signal",
        "speaker_sr_status",
        "reaction_received",
        "transcript_update",
        "webrtc_offer",
        "webrtc_ice",
        "audio_mode",
        "audio_frame",
        "connect",
      ].forEach((e) => sk.off(e));
      if (audioReceiver.current) { audioReceiver.current.stop(); audioReceiver.current = null; }
      if (pc.current) {
        try { pc.current.close(); } catch {}
        pc.current = null;
      }
      if (recognition.current) {
        const r = recognition.current;
        recognition.current = null;
        try { r.stop(); } catch {}
      }
    };
  }, [room?.id]);

  useEffect(() => {
    if (audio.current) {
      audio.current.muted = !audioOn;
      if (audioOn && audio.current.srcObject)
        audio.current.play().catch(() => {});
    }
  }, [audioOn]);

  const joinUrl = `${window.location.origin}?room=${room.id}`;
  const presenterUrl = `${window.location.origin}?presenter=${room.id}`;
  const currentSpeaker = room.currentSpeaker;

  return (
    <div
      className="h-screen flex flex-col overflow-hidden"
      style={{ background: "var(--soft)", color: "var(--ink)" }}
    >
      {/* ────────── Floating reactions ────────── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-40">
        {rxns.map((r) => (
          <div
            key={r.id}
            className="absolute bottom-0 text-5xl float-up"
            style={{ left: `${r.left}%` }}
          >
            {r.emoji}
          </div>
        ))}
      </div>

      {/* ────────── Follow-up modal ────────── */}
      {followUp && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50 p-4"
          style={{ background: "rgba(11,12,16,0.38)", backdropFilter: "blur(3px)" }}
        >
          <Card className="max-w-sm w-full text-center animate-slide-up">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4"
              style={{ background: "color-mix(in oklab, var(--accent) 14%, white)" }}
            >
              <Hand size={22} style={{ color: "var(--accent)" }} />
            </div>
            <h2
              className="text-lg font-bold mb-1"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Follow-up request
            </h2>
            <p className="text-sm mb-5" style={{ color: "var(--muted)" }}>
              <span style={{ color: "var(--accent)", fontWeight: 600 }}>{followUp}</span>{" "}
              wants to continue
            </p>
            <div className="flex gap-3">
              <Btn
                v="outline"
                onClick={() => {
                  s.current.emit("followup_response", {
                    roomId: room.id,
                    approved: false,
                  });
                  setFollowUp(null);
                }}
                className="flex-1"
              >
                <X size={16} /> Decline
              </Btn>
              <Btn
                v="primary"
                onClick={() => {
                  s.current.emit("followup_response", {
                    roomId: room.id,
                    approved: true,
                  });
                  setFollowUp(null);
                }}
                className="flex-1"
              >
                <Check size={16} /> Allow
              </Btn>
            </div>
          </Card>
        </div>
      )}

      <audio ref={audio} autoPlay playsInline muted={!audioOn} />

      {/* ────────── Audio blocked banner ────────── */}
      {audioBlocked && (
        <div
          className="px-4 py-2.5 flex items-center justify-center gap-4 shrink-0 border-b"
          style={{
            background: "#fef3c7",
            color: "#92400e",
            borderColor: "#fde68a",
          }}
        >
          <span className="font-medium text-sm">
            🔇 Browser blocked audio playback
          </span>
          <Btn v="primary" sz="xs" onClick={enableAudio}>
            Enable audio
          </Btn>
        </div>
      )}

      {/* ────────── Host self-transcribe prompt (only between speakers) ────────── */}
      {!room.currentSpeaker && !transcribing && !speakerSR && (
        <div
          className="px-4 py-2.5 flex items-center justify-center gap-4 shrink-0 border-b"
          style={{
            background: "color-mix(in oklab, var(--accent) 10%, white)",
            color: "var(--ink)",
            borderColor: "color-mix(in oklab, var(--accent) 22%, white)",
          }}
        >
          <span className="font-medium text-sm">
            🎙️ Transcribe your own mic (between speakers)
          </span>
          <Btn
            v="accent"
            sz="xs"
            onClick={() => {
              hasPermission.current = true;
              startTranscription();
            }}
          >
            Start my mic
          </Btn>
        </div>
      )}

      {/* ────────── Header ────────── */}
      <header
        className="h-14 flex items-center justify-between px-4 md:px-6 shrink-0 border-b"
        style={{ background: "var(--paper)", borderColor: "var(--line)" }}
      >
        <div className="flex items-center gap-3">
          <Logo sm />
          <div className="h-5 w-px" style={{ background: "var(--line)" }} />
          <span
            className="mono px-2.5 py-1 rounded-lg text-xs font-semibold tracking-wider border"
            style={{
              background: "var(--soft)",
              color: "var(--ink)",
              borderColor: "var(--line)",
            }}
          >
            {room.id}
          </span>
          <span
            className="text-xs hidden md:inline"
            style={{ color: "var(--muted)" }}
          >
            <Users size={12} className="inline mr-1" />
            {room.attendeeCount || 0} joined
          </span>
          <ConnPill state={connState === "connected" ? "good" : connState === "reconnecting" ? "reconnecting" : "lost"} />
        </div>
        <div className="flex items-center gap-1.5">
          <Btn
            v={audioOn ? "primary" : "outline"}
            sz="xs"
            title={audioOn ? "Mute monitor" : "Unmute monitor"}
            onClick={() => {
              if (!audioOn) enableAudio();
              else {
                setAudioOn(false);
                if (audio.current) audio.current.muted = true;
              }
            }}
          >
            {audioOn ? <Volume2 size={14} /> : <VolumeX size={14} />}
          </Btn>
          <Btn
            v={transcribing ? "live" : speakerSR ? "accent" : "outline"}
            sz="xs"
            disabled={speakerSR || (!room.currentSpeaker && !transcribing)}
            title={speakerSR ? "Guest is self-transcribing (using their mic)" : "Transcribe using your mic"}
            onClick={() => {
              if (transcribing) stopTranscription();
              else if (room.currentSpeaker && !speakerSR) {
                hasPermission.current = true;
                startTranscription();
              }
            }}
          >
            <MessageSquare size={14} />
            {speakerSR ? (
              <>
                <Dot kind="live" pulse size={6} />
                <span className="hidden sm:inline">Guest mic</span>
              </>
            ) : transcribing ? (
              <>
                <Dot kind="ink" size={6} />
                <span className="hidden sm:inline">Live</span>
              </>
            ) : (
              <span className="hidden sm:inline">Transcript</span>
            )}
          </Btn>
          <Btn
            v="outline"
            sz="xs"
            title="Open projection window"
            onClick={() => window.open(presenterUrl, "_blank", "noopener")}
          >
            <Monitor size={14} />
            <span className="hidden sm:inline">Project</span>
          </Btn>
          {currentSpeaker && (
            <>
              <Btn
                v="outline"
                sz="xs"
                onClick={() => s.current.emit("end_speech", room.id)}
              >
                <Square size={14} /> End turn
              </Btn>
              <Btn
                v="danger"
                sz="xs"
                title="Remove current speaker"
                onClick={() => s.current.emit("remove_speaker", room.id)}
              >
                <UserMinus size={14} />
              </Btn>
            </>
          )}
          <HoldToConfirm
            label=""
            duration={1500}
            variant="danger"
            sz="xs"
            onConfirm={() => {
              s.current.emit("end_event", room.id);
              onEnd();
            }}
          >
            <Power size={14} />
            <span className="hidden sm:inline text-[11px]">Hold to end</span>
          </HoldToConfirm>
        </div>
      </header>

      {/* ────────── Body: 3 columns ────────── */}
      <div className="flex-1 flex gap-3 p-3 min-h-0">
        {/* LEFT: Queue */}
        <aside
          className="w-72 shrink-0 rounded-[14px] border flex flex-col overflow-hidden hidden lg:flex"
          style={{ background: "var(--paper)", borderColor: "var(--line)" }}
        >
          <div
            className="px-4 py-3 flex items-center gap-2 shrink-0 border-b"
            style={{ borderColor: "var(--line)" }}
          >
            <Users size={15} style={{ color: "var(--accent)" }} />
            <h2
              className="font-semibold text-sm"
              style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
            >
              Queue
            </h2>
            <span
              className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full"
              style={{
                background: "var(--soft)",
                color: "var(--muted)",
                border: "1px solid var(--line)",
              }}
            >
              {room.queue?.length || 0}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-2.5 space-y-2 min-h-0">
            {!room.queue?.length ? (
              <p
                className="text-center py-8 text-sm"
                style={{ color: "var(--muted)" }}
              >
                No one in queue
              </p>
            ) : (
              room.queue.map((p, i) => (
                <div
                  key={p.id}
                  className="rounded-[12px] p-3 border"
                  style={{
                    background: "var(--soft)",
                    borderColor: "var(--line)",
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shrink-0"
                        style={{
                          background:
                            "color-mix(in oklab, var(--accent) 14%, white)",
                          color: "var(--accent)",
                        }}
                      >
                        {i + 1}
                      </div>
                      <div className="min-w-0">
                        <span
                          className="font-semibold text-sm block truncate"
                          style={{ color: "var(--ink)" }}
                        >
                          {p.name}
                        </span>
                        {p.linkedin && (
                          <LinkedInBadge url={p.linkedin} size={32} />
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Btn
                        v="primary"
                        sz="xs"
                        disabled={!!room.currentSpeaker}
                        onClick={() =>
                          s.current.emit("grant_floor", {
                            roomId: room.id,
                            userId: p.id,
                          })
                        }
                      >
                        <Play size={11} />
                      </Btn>
                      <Btn
                        v="danger"
                        sz="xs"
                        onClick={() =>
                          s.current.emit("remove_from_queue", {
                            roomId: room.id,
                            userId: p.id,
                          })
                        }
                      >
                        <X size={11} />
                      </Btn>
                    </div>
                  </div>
                  {p.question && (
                    <div
                      className="mt-2 p-2 rounded-lg text-xs border-l-2"
                      style={{
                        background: "var(--paper)",
                        color: "var(--muted)",
                        borderLeftColor: "var(--accent)",
                      }}
                    >
                      "{p.question}"
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </aside>

        {/* CENTER: Stage */}
        <main
          className="flex-1 rounded-[14px] border flex flex-col items-center justify-center p-6 min-w-0 relative overflow-hidden"
          style={{
            background: "var(--paper)",
            borderColor: "var(--line)",
          }}
        >
          {currentSpeaker ? (
            <div className="text-center w-full max-w-md">
              <div className="flex items-center justify-center mb-4">
                <div
                  className="w-24 h-24 rounded-full flex items-center justify-center live-ring"
                  style={{
                    background: "var(--live)",
                    boxShadow:
                      "0 10px 40px color-mix(in oklab, var(--live) 40%, transparent)",
                  }}
                >
                  <Mic size={40} color="#062a17" />
                </div>
              </div>
              <h2
                className="text-2xl font-extrabold mb-1"
                style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
              >
                {currentSpeaker.name}
              </h2>
              <div className="flex items-center justify-center gap-1.5 mb-3">
                <Dot kind="live" pulse size={8} />
                <p
                  className="text-sm font-semibold tracking-wide"
                  style={{ color: "var(--live)" }}
                >
                  LIVE
                </p>
              </div>
              {currentSpeaker.linkedin && (
                <div className="flex justify-center mb-3">
                  <LinkedInBadge url={currentSpeaker.linkedin} size={40} />
                </div>
              )}
              <div className="mx-auto max-w-xs mb-5">
                <Waveform active color="var(--live)" height={40} bars={36} />
              </div>
              <div
                className="pt-4 flex items-center justify-center gap-3 border-t"
                style={{ borderColor: "var(--line)" }}
              >
                <div
                  className="p-1.5 rounded-lg border"
                  style={{
                    background: "var(--paper)",
                    borderColor: "var(--line)",
                  }}
                >
                  <QR value={joinUrl} size={56} />
                </div>
                <div className="text-left">
                  <p className="text-xs mb-0.5" style={{ color: "var(--muted)" }}>
                    Scan to join
                  </p>
                  <div className="flex items-center gap-1">
                    <code
                      className="mono font-bold text-base"
                      style={{ color: "var(--accent)" }}
                    >
                      {room.id}
                    </code>
                    <CopyBtn text={joinUrl} />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center">
              <div
                className="p-3 rounded-2xl mb-4 inline-block border"
                style={{
                  background: "var(--paper)",
                  borderColor: "var(--line)",
                }}
              >
                <QR value={joinUrl} size={180} />
              </div>
              <h2
                className="text-xl font-extrabold mb-2"
                style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
              >
                Scan to join
              </h2>
              <div className="flex items-center justify-center gap-2 mb-2">
                <code
                  className="mono font-bold text-2xl"
                  style={{ color: "var(--accent)" }}
                >
                  {room.id}
                </code>
                <CopyBtn text={room.id} />
              </div>
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                or share link:
              </p>
              <div className="flex items-center justify-center gap-1.5 mt-1">
                <LinkIcon size={12} style={{ color: "var(--muted)" }} />
                <code
                  className="text-xs break-all max-w-[220px]"
                  style={{ color: "var(--muted)" }}
                >
                  {joinUrl}
                </code>
                <CopyBtn text={joinUrl} />
              </div>
            </div>
          )}
        </main>

        {/* RIGHT: Transcript */}
        <aside
          className="w-[420px] shrink-0 rounded-[14px] border flex flex-col overflow-hidden hidden lg:flex"
          style={{ background: "var(--paper)", borderColor: "var(--line)" }}
        >
          <TranscriptPanel transcript={transcript} compact />
        </aside>
      </div>

      {/* ────────── Mobile fallback ────────── */}
      <div className="lg:hidden flex-1 overflow-auto p-3 space-y-3">
        <Card>
          {currentSpeaker ? (
            <div className="text-center">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-2 live-ring"
                style={{ background: "var(--live)" }}
              >
                <Mic size={28} color="#062a17" />
              </div>
              <h2
                className="text-lg font-extrabold"
                style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
              >
                {currentSpeaker.name}
              </h2>
              <div className="flex items-center justify-center gap-1">
                <Dot kind="live" pulse />
                <span
                  className="text-xs font-semibold"
                  style={{ color: "var(--live)" }}
                >
                  LIVE
                </span>
              </div>
            </div>
          ) : (
            <div className="text-center">
              <div
                className="p-2 rounded-xl mb-3 inline-block border"
                style={{ borderColor: "var(--line)" }}
              >
                <QR value={joinUrl} size={100} />
              </div>
              <p className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
                Room:{" "}
                <code className="mono" style={{ color: "var(--accent)" }}>
                  {room.id}
                </code>{" "}
                <CopyBtn text={joinUrl} />
              </p>
            </div>
          )}
        </Card>

        {/* Mobile queue */}
        {room.queue?.length > 0 && (
          <Card>
            <div className="flex items-center gap-2 mb-3">
              <Users size={14} style={{ color: "var(--accent)" }} />
              <span className="font-semibold text-sm" style={{ fontFamily: "var(--font-display)" }}>
                Queue ({room.queue.length})
              </span>
            </div>
            <div className="space-y-2">
              {room.queue.map((p, i) => (
                <div key={p.id} className="flex items-center justify-between gap-2 p-2 rounded-lg" style={{ background: "var(--soft)" }}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold shrink-0"
                      style={{ background: "color-mix(in oklab, var(--accent) 14%, white)", color: "var(--accent)" }}>
                      {i + 1}
                    </span>
                    <span className="text-sm font-medium truncate">{p.name}</span>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Btn v="primary" sz="xs" disabled={!!room.currentSpeaker}
                      onClick={() => s.current.emit("grant_floor", { roomId: room.id, userId: p.id })}>
                      <Play size={11} />
                    </Btn>
                    <Btn v="danger" sz="xs"
                      onClick={() => s.current.emit("remove_from_queue", { roomId: room.id, userId: p.id })}>
                      <X size={11} />
                    </Btn>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        <TranscriptPanel transcript={transcript} compact />
      </div>
    </div>
  );
}
