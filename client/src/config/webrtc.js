// ─── ICE Configuration with multi-provider TURN fallback ─────────────────────
// Strategy: Try Cloudflare TURN first (free), then Metered.ca (free tier),
// then fall back to STUN-only + WebSocket audio fallback.

export let ICE = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require",
};

export let turnReady = false;

// ─── Opus codec optimization ─────────────────────────────────────────────────
// Apply to SDP before setLocalDescription to force Opus with FEC + DTX
export function optimizeSDP(sdp) {
  // Enable Opus FEC (Forward Error Correction) — recovers from packet loss
  // Enable DTX (Discontinuous Transmission) — saves bandwidth during silence
  // Set maxaveragebitrate to 32kbps — speech doesn't need more
  return sdp.replace(
    /a=fmtp:111 /g,
    'a=fmtp:111 useinbandfec=1;usedtx=1;maxaveragebitrate=32000;'
  );
}

// ─── Connection quality monitor ──────────────────────────────────────────────
// Returns { packetsLost, jitter, roundTripTime, bytesReceived }
export async function getConnectionStats(pc) {
  if (!pc || pc.connectionState === 'closed') return null;
  try {
    const stats = await pc.getStats();
    let result = { packetsLost: 0, jitter: 0, roundTripTime: 0, bytesReceived: 0, quality: 'good' };
    stats.forEach(report => {
      if (report.type === 'inbound-rtp' && report.kind === 'audio') {
        result.packetsLost = report.packetsLost || 0;
        result.jitter = report.jitter || 0;
        result.bytesReceived = report.bytesReceived || 0;
      }
      if (report.type === 'candidate-pair' && report.state === 'succeeded') {
        result.roundTripTime = report.currentRoundTripTime || 0;
      }
    });
    // Quality assessment
    if (result.jitter > 0.1 || result.roundTripTime > 0.5) result.quality = 'poor';
    else if (result.jitter > 0.05 || result.roundTripTime > 0.2) result.quality = 'fair';
    return result;
  } catch { return null; }
}

// ─── TURN credential providers ───────────────────────────────────────────────
async function tryCloudflare() {
  const r = await fetch("https://speed.cloudflare.com/turn-creds");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const creds = await r.json();
  const turnUrls = creds.urls?.filter(u => u.startsWith("turn:") || u.startsWith("turns:"));
  if (!turnUrls?.length) throw new Error("No TURN URLs");
  return { urls: turnUrls, username: creds.username, credential: creds.credential };
}

async function tryMetered() {
  // Metered.ca free tier: 500GB/month — enough for dev/small events
  // Replace with your API key from https://www.metered.ca/stun-turn
  const API_KEY = ''; // Set your Metered.ca API key here if you have one
  if (!API_KEY) throw new Error("No Metered API key");
  const r = await fetch(`https://speakapp.metered.live/api/v1/turn/credentials?apiKey=${API_KEY}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const servers = await r.json();
  return servers; // Metered returns array of {urls, username, credential}
}

async function refreshTurnCredentials() {
  // Try providers in order
  const providers = [
    { name: 'Cloudflare', fn: tryCloudflare },
    { name: 'Metered', fn: tryMetered },
  ];

  for (const { name, fn } of providers) {
    try {
      const creds = fn === tryMetered ? await fn() : await fn();
      const turnServers = Array.isArray(creds)
        ? creds
        : [{ urls: creds.urls, username: creds.username, credential: creds.credential }];

      ICE = {
        ...ICE,
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun.cloudflare.com:3478" },
          ...turnServers,
        ],
      };
      turnReady = true;
      console.log(`✅ TURN ready via ${name}`);
      return;
    } catch (e) {
      console.warn(`⚠️ ${name} TURN failed:`, e.message);
    }
  }

  console.warn("⚠️ All TURN providers failed — STUN-only (WebSocket fallback available)");
  turnReady = false;
}

// Fetch on load + retry with backoff
refreshTurnCredentials().then(() => {
  if (!turnReady) setTimeout(refreshTurnCredentials, 3000);
});
// Refresh every 20 minutes (creds expire)
setInterval(refreshTurnCredentials, 20 * 60 * 1000);
