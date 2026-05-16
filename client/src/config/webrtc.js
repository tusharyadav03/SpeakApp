// ─── ICE Configuration with multi-provider TURN ──────────────────────────────
// Strategy: Try Cloudflare TURN first (free, undocumented), then Metered.ca
// (free tier 500GB/mo), then Open Relay Project. WebRTC is the ONLY audio path
// — no Socket.IO fallback. TURN MUST work for cross-network users.

export let ICE = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
    // Open Relay Project — free, no signup, works everywhere
    // https://www.metered.ca/tools/openrelay/
    {
      urls: "stun:openrelay.metered.ca:80",
    },
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turns:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require",
};

export let turnReady = true; // Open Relay is always available

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
    if (result.jitter > 0.1 || result.roundTripTime > 0.5) result.quality = 'poor';
    else if (result.jitter > 0.05 || result.roundTripTime > 0.2) result.quality = 'fair';
    return result;
  } catch { return null; }
}

// ─── Enhanced TURN: try Cloudflare + Metered on top of Open Relay ────────────
async function tryCloudflare() {
  const r = await fetch("https://speed.cloudflare.com/turn-creds");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const creds = await r.json();
  const turnUrls = creds.urls?.filter(u => u.startsWith("turn:") || u.startsWith("turns:"));
  if (!turnUrls?.length) throw new Error("No TURN URLs");
  return { urls: turnUrls, username: creds.username, credential: creds.credential };
}

async function tryMetered() {
  const API_KEY = ''; // Set your Metered.ca API key here if you have one
  if (!API_KEY) throw new Error("No Metered API key");
  const r = await fetch(`https://speakapp.metered.live/api/v1/turn/credentials?apiKey=${API_KEY}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.json();
}

async function enhanceTurnCredentials() {
  // Open Relay is already in the base config and always works.
  // Try to ADD better providers on top (Cloudflare, Metered).
  const providers = [
    { name: 'Cloudflare', fn: tryCloudflare },
    { name: 'Metered', fn: tryMetered },
  ];

  for (const { name, fn } of providers) {
    try {
      const creds = await fn();
      const turnServers = Array.isArray(creds)
        ? creds
        : [{ urls: creds.urls, username: creds.username, credential: creds.credential }];

      // Prepend better providers BEFORE Open Relay (browser tries in order)
      const openRelayServers = ICE.iceServers.filter(
        s => JSON.stringify(s).includes('openrelay') || JSON.stringify(s).includes('stun')
      );
      ICE = {
        ...ICE,
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun.cloudflare.com:3478" },
          ...turnServers,
          ...openRelayServers.filter(s => JSON.stringify(s).includes('openrelay')),
        ],
      };
      console.log(`✅ Enhanced TURN via ${name} (+ Open Relay backup)`);
      return;
    } catch (e) {
      console.warn(`⚠️ ${name} TURN failed:`, e.message);
    }
  }

  console.log("ℹ️ Using Open Relay TURN only (works for all networks)");
}

// Enhance on load (non-blocking — Open Relay already works)
enhanceTurnCredentials();
// Refresh every 20 minutes (Cloudflare creds expire)
setInterval(enhanceTurnCredentials, 20 * 60 * 1000);
