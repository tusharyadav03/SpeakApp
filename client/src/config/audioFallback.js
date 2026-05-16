// ─── WebSocket Audio Fallback ────────────────────────────────────────────────
// When WebRTC fails (NAT traversal, TURN unavailable), stream audio over
// Socket.IO binary frames. Higher latency (~200-400ms) but works everywhere.
//
// Flow: getUserMedia → AudioWorklet/ScriptProcessor → PCM → Socket.IO → Host
// Host: Socket.IO → AudioContext → speakers

const SAMPLE_RATE = 16000; // 16kHz mono — speech quality, low bandwidth
const FRAME_SIZE = 4096;   // ~256ms per frame at 16kHz

// ─── Sender (Attendee) ──────────────────────────────────────────────────────
export class AudioSender {
  constructor(socket, roomId) {
    this.socket = socket;
    this.roomId = roomId;
    this.ctx = null;
    this.stream = null;
    this.processor = null;
    this.active = false;
  }

  async start() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: SAMPLE_RATE },
      });

      this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      const source = this.ctx.createMediaStreamSource(this.stream);

      // Use ScriptProcessorNode (deprecated but universal)
      // AudioWorklet would be better but needs separate file + HTTPS
      this.processor = this.ctx.createScriptProcessor(FRAME_SIZE, 1, 1);
      this.active = true;

      this.processor.onaudioprocess = (e) => {
        if (!this.active) return;
        const pcm = e.inputBuffer.getChannelData(0);
        // Convert Float32 → Int16 for bandwidth (halves size)
        const int16 = new Int16Array(pcm.length);
        for (let i = 0; i < pcm.length; i++) {
          const s = Math.max(-1, Math.min(1, pcm[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        this.socket.emit('audio_frame', { roomId: this.roomId, data: int16.buffer });
      };

      source.connect(this.processor);
      this.processor.connect(this.ctx.destination); // required for onaudioprocess to fire
      console.log('🎙️ WebSocket audio fallback started');
      return true;
    } catch (err) {
      console.error('AudioSender start failed:', err);
      return false;
    }
  }

  stop() {
    this.active = false;
    if (this.processor) { this.processor.disconnect(); this.processor = null; }
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    if (this.ctx) { this.ctx.close().catch(() => {}); this.ctx = null; }
    console.log('🎙️ WebSocket audio fallback stopped');
  }
}

// ─── Receiver (Host) ─────────────────────────────────────────────────────────
export class AudioReceiver {
  constructor() {
    this.ctx = null;
    this.nextPlayTime = 0;
    this.active = false;
  }

  start() {
    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    this.nextPlayTime = this.ctx.currentTime;
    this.active = true;
    console.log('🔊 WebSocket audio receiver started');
  }

  // Feed Int16 PCM buffer
  feed(arrayBuffer) {
    if (!this.active || !this.ctx) return;
    const int16 = new Int16Array(arrayBuffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7FFF);
    }

    const buffer = this.ctx.createBuffer(1, float32.length, SAMPLE_RATE);
    buffer.getChannelData(0).set(float32);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);

    // Schedule playback to avoid gaps
    const now = this.ctx.currentTime;
    if (this.nextPlayTime < now) this.nextPlayTime = now;
    source.start(this.nextPlayTime);
    this.nextPlayTime += buffer.duration;
  }

  stop() {
    this.active = false;
    if (this.ctx) { this.ctx.close().catch(() => {}); this.ctx = null; }
    console.log('🔊 WebSocket audio receiver stopped');
  }
}
