import React, { useState, useEffect, useRef, useCallback } from "react";
import { getSocket } from "./config/socket";
import "./config/webrtc"; // initialize TURN credentials on load
import { AuthProvider, useAuth } from "./context/AuthContext";

// Pages
import Landing from "./pages/Landing";
import HostSetup from "./pages/HostSetup";
import HostDash from "./pages/HostDash";
import JoinPage from "./pages/JoinPage";
import Attendee from "./pages/Attendee";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Admin from "./pages/Admin";
import Presenter from "./pages/Presenter";
import LoadingPage from "./pages/LoadingPage";

// Loading messages per view
const LOADING_MESSAGES = {
  landing: "Loading SpeakApp...",
  host: "Preparing event setup...",
  dash: "Loading dashboard...",
  join: "Preparing to join...",
  att: "Connecting to event...",
  login: "Loading sign in...",
  register: "Loading registration...",
  admin: "Loading admin panel...",
  presenter: "Loading projection...",
};

// Detect presenter mode from URL — takes over the whole app
const PRESENTER_ROOM = new URLSearchParams(window.location.search).get("presenter");

function WaitingRoom({ data, onCancel }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--soft)" }}>
      <div className="max-w-sm w-full text-center animate-slide-up">
        <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5"
          style={{ background: "color-mix(in oklab, var(--accent) 14%, white)" }}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
        </div>
        <h2 className="text-2xl font-extrabold mb-2" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>
          Waiting for approval
        </h2>
        <p className="text-sm mb-1" style={{ color: "var(--muted)" }}>
          Requesting to join <strong style={{ color: "var(--ink)" }}>{data?.roomName || "event"}</strong>
        </p>
        <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>
          The host will accept your request shortly
        </p>
        <div className="flex justify-center mb-4">
          <div className="flex gap-1.5">
            {[0, 1, 2].map(i => (
              <div key={i} className="w-2.5 h-2.5 rounded-full animate-pulse"
                style={{ background: "var(--accent)", animationDelay: `${i * 0.3}s` }} />
            ))}
          </div>
        </div>
        <button onClick={onCancel} className="text-sm font-semibold" style={{ color: "var(--muted)" }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Routes({ view, room, attUser, ok, nav, home, create, join, waitingRoom }) {
  const { user } = useAuth();
  switch (view) {
    case "landing": return <Landing ok={ok} nav={nav} />;
    case "host": return <HostSetup onBack={home} onCreate={create} ok={ok} />;
    case "dash": return room ? <HostDash room={room} onEnd={home} /> : <Landing ok={ok} nav={nav} />;
    case "join": return <JoinPage onBack={home} onJoin={join} ok={ok} />;
    case "waiting": return <WaitingRoom data={waitingRoom} onCancel={home} />;
    case "att": return room ? <Attendee room={room} user={attUser} onExit={home} /> : <Landing ok={ok} nav={nav} />;
    case "login": return <Login onBack={home} onSwitch={() => nav("register")} />;
    case "register": return <Register onBack={home} onSwitch={() => nav("login")} />;
    case "admin": return user && ["admin", "superadmin"].includes(user.role) ? <Admin onBack={home} /> : <Login onBack={home} onSwitch={() => nav("register")} />;
    default: return <Landing ok={ok} nav={nav} />;
  }
}

export default function App() {
  const [view, setView] = useState("landing");
  const [room, setRoom] = useState(null);
  const [attUser, setAttUser] = useState({ name: "", linkedin: "" });
  const [ok, setOk] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [waitingRoom, setWaitingRoom] = useState(null); // { roomId, roomName, hostName }
  const sk = useRef(null);

  // Navigate with a brief loading transition
  const nav = useCallback((v) => {
    // Skip loading for instant views (same view, or server-driven transitions)
    if (v === view) return setView(v);
    setLoadingMsg(LOADING_MESSAGES[v] || "Loading...");
    setLoading(true);
    // Brief delay so the loading page is visible, then swap
    setTimeout(() => {
      setView(v);
      setLoading(false);
    }, 400);
  }, [view]);

  const home = useCallback(() => nav("landing"), [nav]);

  useEffect(() => {
    const s = getSocket();
    sk.current = s;

    const onConnect = () => setOk(true);
    const onDisconnect = (reason) => {
      setOk(false);
      // Don't alert on normal disconnects — socket.io will auto-reconnect
      if (reason === "io server disconnect") {
        // Server forced disconnect — likely event ended or server restarted
        console.warn("Server disconnected");
      }
    };
    const onEventCreated = (d) => {
      setRoom(d);
      setLoadingMsg("Launching event...");
      setLoading(true);
      setTimeout(() => { setView("dash"); setLoading(false); }, 400);
    };
    const onRoomData = (d) => setRoom((p) => ({ ...p, ...d }));
    const onEventEnded = ({ reason } = {}) => {
      alert(`Event ended${reason ? ": " + reason : ""}`);
      setView("landing");
      setRoom(null);
    };
    const onError = (m) => {
      if (typeof m === "string") alert(m);
      else console.error("Socket error:", m);
    };

    // ── Waiting room flow ──
    const onJoinPending = (data) => {
      setWaitingRoom(data);
      setLoading(false);
      setView("waiting");
    };
    const onJoinApproved = (roomData) => {
      setWaitingRoom(null);
      setRoom(roomData);
      setLoadingMsg("Joining event...");
      setLoading(true);
      setTimeout(() => { setView("att"); setLoading(false); }, 400);
    };
    const onJoinRejected = ({ reason }) => {
      setWaitingRoom(null);
      alert(reason || "Your join request was declined.");
      setView("join");
    };

    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    s.on("event_created", onEventCreated);
    s.on("room_data", onRoomData);
    s.on("event_ended", onEventEnded);
    s.on("error", onError);
    s.on("join_pending", onJoinPending);
    s.on("join_approved", onJoinApproved);
    s.on("join_rejected", onJoinRejected);

    setOk(s.connected);
    if (new URLSearchParams(window.location.search).get("room")) setView("join");

    return () => {
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      s.off("event_created", onEventCreated);
      s.off("room_data", onRoomData);
      s.off("event_ended", onEventEnded);
      s.off("error", onError);
      s.off("join_pending", onJoinPending);
      s.off("join_approved", onJoinApproved);
      s.off("join_rejected", onJoinRejected);
    };
  }, []);

  const create = (d) => { if (!ok) return alert("Connecting..."); sk.current.emit("create_event", d); };
  const join = (code, u) => {
    if (!ok) return alert("Connecting...");
    setAttUser(u);
    sk.current.emit("join_room_attendee", { roomId: code.toUpperCase(), user: u });
    setLoadingMsg("Requesting to join...");
    setLoading(true);
    // Server will respond with join_pending → waiting room, or join_approved → att view
  };

  // Presenter mode short-circuits everything — it's a display-only view
  if (PRESENTER_ROOM) {
    return (
      <AuthProvider>
        <Presenter roomId={PRESENTER_ROOM} />
      </AuthProvider>
    );
  }

  return (
    <AuthProvider>
      {loading
        ? <LoadingPage message={loadingMsg} />
        : <Routes view={view} room={room} attUser={attUser} ok={ok} nav={nav} home={home} create={create} join={join} waitingRoom={waitingRoom} />
      }
    </AuthProvider>
  );
}
