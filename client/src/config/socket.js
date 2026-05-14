import { io } from "socket.io-client";
import { API } from "./api";

let _socket = null;
let _connState = "connecting"; // "connected" | "reconnecting" | "disconnected"
const _listeners = new Set();

/** Subscribe to connection state changes */
export function onConnState(fn) {
  _listeners.add(fn);
  fn(_connState); // fire immediately with current state
  return () => _listeners.delete(fn);
}

function _setConnState(s) {
  if (s === _connState) return;
  _connState = s;
  _listeners.forEach((fn) => { try { fn(s); } catch {} });
}

export function getConnState() { return _connState; }

export function getSocket() {
  if (!_socket) {
    _socket = io(API, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity, // never stop trying
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
      timeout: 20000,
      autoConnect: true,
    });

    _socket.on("connect", () => {
      console.log("✅ Connected:", _socket.id);
      _setConnState("connected");
    });
    _socket.on("disconnect", (reason) => {
      console.warn("⚠️ Disconnected:", reason);
      _setConnState(reason === "io server disconnect" ? "disconnected" : "reconnecting");
    });
    _socket.on("reconnect_attempt", (n) => {
      _setConnState("reconnecting");
    });
    _socket.on("reconnect_failed", () => {
      _setConnState("disconnected");
    });
    _socket.on("connect_error", (e) => {
      console.error("❌ Socket error:", e.message);
    });

    _socket.io.on("reconnect", () => {
      console.log("🔄 Reconnected:", _socket.id);
      _setConnState("connected");
    });
  }
  return _socket;
}
