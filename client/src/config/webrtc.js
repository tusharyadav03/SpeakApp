// Default config with STUN only (TURN added dynamically)
export let ICE = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require",
};

let _turnReady = false;

async function refreshTurnCredentials() {
  try {
    const r = await fetch("https://speed.cloudflare.com/turn-creds");
    if (r.ok) {
      const creds = await r.json();
      const turnUrls = creds.urls.filter(u => u.startsWith("turn:") || u.startsWith("turns:"));
      if (turnUrls.length > 0) {
        ICE = {
          ...ICE,
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun.cloudflare.com:3478" },
            { urls: turnUrls, username: creds.username, credential: creds.credential },
          ],
        };
        _turnReady = true;
        console.log("✅ TURN credentials refreshed:", turnUrls.length, "servers");
        return;
      }
    }
    throw new Error("No TURN URLs in response");
  } catch (e) {
    console.warn("⚠️ Cloudflare TURN failed:", e.message, "- using STUN-only (may fail behind strict NAT)");
    _turnReady = false;
  }
}

// Fetch on load + retry once after 3s if first attempt fails
refreshTurnCredentials().then(() => {
  if (!_turnReady) setTimeout(refreshTurnCredentials, 3000);
});
// Refresh every 20 minutes (creds expire)
setInterval(refreshTurnCredentials, 20 * 60 * 1000);
