import React, { useState, useEffect, useRef } from 'react';
import { 
  Mic, Users, Ban, ArrowRight, Smartphone, Monitor, QrCode, X, Activity, 
  Copy, CheckCircle, Volume2, Loader2, Play, AlertCircle
} from 'lucide-react';
import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, Auth, User } from 'firebase/auth';
import { 
  getFirestore, collection, doc, setDoc, onSnapshot, 
  deleteDoc, serverTimestamp, updateDoc, getDoc, Firestore, arrayUnion, DocumentData 
} from 'firebase/firestore';

// ==========================================
// FIREBASE CONFIGURATION
// ==========================================

const firebaseConfig = {
  apiKey: "AIzaSyDL2MwaeVJ9imxUixulOypO_xcLLZZO6jg",
  authDomain: "speakapp-demo.firebaseapp.com",
  projectId: "speakapp-demo",
  storageBucket: "speakapp-demo.firebasestorage.app",
  messagingSenderId: "791410371678",
  appId: "1:791410371678:web:e722a1fe00b87556ee98cf"
};

const appId = 'demo-event-001';

// WebRTC Configuration with TURN servers
const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { 
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject"
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject"
    }
  ],
  iceCandidatePoolSize: 10
};

//Types
interface QueueItem {
  id: string;
  userId: string;
  name: string;
  timestamp?: any;
}

interface SessionData {
  currentSpeakerId: string | null;
  currentSpeakerName: string | null;
  status: 'idle' | 'speaking';
}

// ==========================================
// INITIALIZE FIREBASE
// ==========================================

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  console.log("✅ Firebase initialized");
} catch (error) {
  console.error("❌ Firebase error:", error);
}

// ==========================================
// AUDIO VISUALIZER COMPONENT
// ==========================================

const AudioVisualizer = ({ stream, label, height = "h-20" }: { stream: MediaStream | null, label?: string, height?: string }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  useEffect(() => {
    if (!stream) {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (audioContextRef.current?.state !== 'closed') {
        audioContextRef.current?.close();
      }
      return;
    }

    const init = async () => {
      try {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContext) return;
        
        if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
          const ctx = new AudioContext();
          audioContextRef.current = ctx;
          
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 32;
          analyserRef.current = analyser;

          const source = ctx.createMediaStreamSource(stream);
          source.connect(analyser);
        }

        const canvas = canvasRef.current;
        if (!canvas) return;
        const canvasCtx = canvas.getContext('2d');
        const analyser = analyserRef.current;

        const draw = () => {
          animationRef.current = requestAnimationFrame(draw);
          if (!analyser) return;
          
          const bufferLength = analyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          analyser.getByteFrequencyData(dataArray);

          canvasCtx!.clearRect(0, 0, canvas.width, canvas.height);
          
          const barWidth = (canvas.width / bufferLength) * 0.8;
          let x = 0;

          for (let i = 0; i < bufferLength; i++) {
            const barHeight = (dataArray[i] / 255) * canvas.height;
            const opacity = (dataArray[i] / 255) + 0.2;
            canvasCtx!.fillStyle = `rgba(99, 102, 241, ${opacity})`;
            canvasCtx!.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
            x += (canvas.width / bufferLength);
          }
        };
        draw();
      } catch (err) {
        console.warn("Visualizer error:", err);
      }
    };

    init();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [stream]);

  return (
    <div className={`w-full ${height} bg-slate-100/50 rounded-xl border border-slate-200 overflow-hidden relative flex items-center justify-center`}>
      {stream ? (
        <canvas ref={canvasRef} width={300} height={80} className="w-full h-full" />
      ) : (
        <div className="flex items-center gap-2 text-slate-400 text-xs font-bold uppercase tracking-widest animate-pulse">
          <Activity size={14} /> {label || "Waiting for audio..."}
        </div>
      )}
    </div>
  );
};

// ==========================================
// MAIN APP COMPONENT
// ==========================================

export default function SpeakApp() {
  // const HOST_UID = "OeK3WtLvcMTSABVoDoUSmxYLl3e2";
  const [user, setUser] = useState<User | null>(null);
  // const isHostUser = user?.uid === HOST_UID;
  const [view, setView] = useState<'landing' | 'attendee_setup' | 'dashboard' | 'host'>('landing');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [sessionData, setSessionData] = useState<SessionData>({ 
    currentSpeakerId: null, 
    currentSpeakerName: null,
    status: 'idle' 
  });
  
  const [attendeeName, setAttendeeName] = useState('');
  const [loading, setLoading] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  
  // WebRTC State
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'failed' | 'waiting_for_click'>('disconnected');
  const [connectionError, setConnectionError] = useState('');
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const [mediaStreamForViz, setMediaStreamForViz] = useState<MediaStream | null>(null);
  const candidateQueue = useRef<RTCIceCandidateInit[]>([]);
  const isMounted = useRef(true);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 3;

  // Initialize Auth
  useEffect(() => {
    isMounted.current = true;
    
    if (!auth) {
      setInitError("Firebase not initialized");
      return;
    }

    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
        console.log("✅ Signed in");
      } catch (err: any) {
        console.error("❌ Auth error:", err);
        setInitError(err.message);
      }
    };

    initAuth();

    const unsub = onAuthStateChanged(auth, (currentUser) => {
      console.log("👤 User:", currentUser?.uid);
      setUser(currentUser);
    });

    return () => { 
      unsub(); 
      isMounted.current = false; 
    };
  }, []);

  // Listen to Queue & Session
  useEffect(() => {
    if (!user || !db) return;

    console.log("📡 Setting up listeners...");

    const queueRef = collection(db, 'artifacts', appId, 'public', 'data', 'queue');
    const qSub = onSnapshot(queueRef, 
      (snapshot) => {
        const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as QueueItem));
        items.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));
        if (isMounted.current) setQueue(items);
      },
      (error) => console.error("❌ Queue error:", error)
    );

    const sessionRef = doc(db, 'artifacts', appId, 'public', 'data', 'session_control', 'main');
    const sSub = onSnapshot(sessionRef, 
      async (docSnap) => {
        if (docSnap.exists() && isMounted.current) {
          setSessionData(docSnap.data() as SessionData);
        } else if (!docSnap.exists()) {
          // Use sessionRef directly instead of docSnap.ref to avoid TS narrowing 'docSnap' to 'never'
          await setDoc(sessionRef, { 
            status: 'idle', 
            currentSpeakerId: null, 
            currentSpeakerName: null 
          }).catch(err => console.error("❌ Session doc error:", err));
        }
      },
      (error) => console.error("❌ Session error:", error)
    );

    return () => { 
      qSub(); 
      sSub(); 
    };
  }, [user]);

  // HOST WebRTC
  useEffect(() => {
    const isHost = view === 'host';
    const isSpeaking = sessionData.status === 'speaking';
    let pc: RTCPeerConnection | null = null;
    
    if (!isHost || !isSpeaking) {
      setConnectionStatus('disconnected');
      setMediaStreamForViz(null);
      return;
    }

    let unsubSignaling = () => {};
    let unsubCandidates = () => {};

    const startHost = async () => {
      console.log("🎯 HOST: Starting for speaker", sessionData.currentSpeakerId);
      if (isMounted.current) {
        setConnectionStatus('connecting');
        setConnectionError('');
      }
      candidateQueue.current = [];
      
      try {
        pc = new RTCPeerConnection(rtcConfig);

        pc.oniceconnectionstatechange = () => {
          console.log("🌐 HOST ICE:", pc!.iceConnectionState);
          if (pc!.iceConnectionState === 'connected' || pc!.iceConnectionState === 'completed') {
            if (isMounted.current) {
              setConnectionStatus('connected');
              setConnectionError('');
              reconnectAttempts.current = 0;
            }
          } else if (pc!.iceConnectionState === 'failed') {
            console.error("❌ HOST failed");
            if (reconnectAttempts.current < maxReconnectAttempts) {
              reconnectAttempts.current++;
              if (isMounted.current) setConnectionError(`Retrying ${reconnectAttempts.current}/${maxReconnectAttempts}...`);
            }
          }
        };

        pc.ontrack = (event) => {
          console.log("✅ HOST: Got stream");
          const stream = event.streams[0];
          
          if (isMounted.current) {
            setMediaStreamForViz(stream);
            setConnectionStatus('connected');
          }
          if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = stream;
            remoteAudioRef.current.play().catch(e => {
              console.warn("⚠️ Autoplay blocked");
              if (isMounted.current) setConnectionStatus('waiting_for_click');
            });
          }
        };

        pc.onicecandidate = async (event) => {
          if (event.candidate) {
            try {
              const candidatesRef = doc(db, 'artifacts', appId, 'public', 'data', 'signaling', 'host_candidates');
              // Use arrayUnion to avoid race conditions when multiple candidates are generated quickly
              await updateDoc(candidatesRef, { candidates: arrayUnion(event.candidate.toJSON()) });
            } catch (err) {
              console.error("❌ Host candidate error:", err);
            }
          }
        };

        // IMPORTANT: Do not clear candidates here as it creates a race condition with nextSpeaker clearing
        // We assume nextSpeaker has already cleared them.
        
        const offer = await pc.createOffer({ offerToReceiveAudio: true });
        await pc.setLocalDescription(offer);

        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'signaling', 'connection'), { 
          type: 'offer', sdp: offer.sdp 
        });

        unsubSignaling = onSnapshot(
          doc(db, 'artifacts', appId, 'public', 'data', 'signaling', 'connection'), 
          async (snap) => {
            const data = snap.data();
            if (data?.type === 'answer' && pc?.signalingState === 'have-local-offer') {
              console.log("✅ HOST: Got answer");
              try {
                await pc.setRemoteDescription(new RTCSessionDescription(data as RTCSessionDescriptionInit));
                while (candidateQueue.current.length > 0) {
                  const c = candidateQueue.current.shift();
                  await pc.addIceCandidate(new RTCIceCandidate(c!)).catch(console.warn);
                }
              } catch (err) {
                console.error("❌ Remote desc error:", err);
              }
            }
          }
        );

        unsubCandidates = onSnapshot(
          doc(db, 'artifacts', appId, 'public', 'data', 'signaling', 'guest_candidates'), 
          (snap) => {
            const candidates = snap.data()?.candidates || [];
            candidates.forEach((c: any) => {
              if (pc?.remoteDescription && pc?.remoteDescription.type) {
                pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.warn);
              } else {
                candidateQueue.current.push(c);
              }
            });
          }
        );

      } catch (err) {
        console.error("❌ Host setup error:", err);
        if (isMounted.current) {
          setConnectionStatus('failed');
          setConnectionError('Connection failed');
        }
      }
    };

    startHost();

    // Cleanup function ensuring we close the SPECIFIC pc created in this effect run
    return () => {
      unsubSignaling();
      unsubCandidates();
      if (pc) {
        console.log("🧹 HOST cleanup: closing connection");
        pc.close();
        pc = null;
      }
    };
  }, [view, sessionData.status, sessionData.currentSpeakerId]); // Correct dependencies

  // GUEST WebRTC
  const amISpeaking = user && sessionData.currentSpeakerId === user.uid;
  
  useEffect(() => {
    let pc: RTCPeerConnection | null = null;

    if (!amISpeaking) {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
        localStreamRef.current = null;
        if (isMounted.current) setMediaStreamForViz(null);
      }
      return;
    }

    let unsubSignaling = () => {};
    let unsubCandidates = () => {};

    const startGuest = async () => {
      console.log("🎤 GUEST: Starting...");
      if (isMounted.current) {
        setConnectionStatus('connecting');
        setConnectionError('');
      }
      candidateQueue.current = [];
      
      try {
        pc = new RTCPeerConnection(rtcConfig);

        pc.oniceconnectionstatechange = () => {
          console.log("🌐 GUEST ICE:", pc!.iceConnectionState);
          if (pc!.iceConnectionState === 'connected' || pc!.iceConnectionState === 'completed') {
            if (isMounted.current) {
              setConnectionStatus('connected');
              setConnectionError('');
              reconnectAttempts.current = 0;
            }
          } else if (pc!.iceConnectionState === 'failed') {
            console.error("❌ GUEST failed");
            if (isMounted.current) {
              setConnectionStatus('failed');
              setConnectionError('Connection failed. Check microphone permissions.');
            }
          }
        };

        const stream = await navigator.mediaDevices.getUserMedia({ 
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
        });
        console.log("🎙️ GUEST: Got mic");
        localStreamRef.current = stream;
        if (isMounted.current) setMediaStreamForViz(stream);
        
        stream.getTracks().forEach(track => pc!.addTrack(track, stream));

        pc.onicecandidate = async (event) => {
          if (event.candidate) {
            try {
              const candidatesRef = doc(db, 'artifacts', appId, 'public', 'data', 'signaling', 'guest_candidates');
              // Use arrayUnion for atomic updates
              await updateDoc(candidatesRef, { candidates: arrayUnion(event.candidate.toJSON()) });
            } catch (err) {
              console.error("❌ Guest candidate error:", err);
            }
          }
        };

        unsubSignaling = onSnapshot(
          doc(db, 'artifacts', appId, 'public', 'data', 'signaling', 'connection'), 
          async (snap) => {
            const data = snap.data();
            if (data?.type === 'offer' && pc?.signalingState === 'stable') {
              console.log("✅ GUEST: Got offer");
              try {
                await pc.setRemoteDescription(new RTCSessionDescription(data as RTCSessionDescriptionInit));
                
                while (candidateQueue.current.length > 0) {
                  const c = candidateQueue.current.shift();
                  await pc.addIceCandidate(new RTCIceCandidate(c!)).catch(console.warn);
                }

                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                await updateDoc(
                  doc(db, 'artifacts', appId, 'public', 'data', 'signaling', 'connection'), 
                  { type: 'answer', sdp: answer.sdp }
                );
                if (isMounted.current) setConnectionStatus('connected');
              } catch (err) {
                console.error("❌ Offer error:", err);
              }
            }
          }
        );

        unsubCandidates = onSnapshot(
          doc(db, 'artifacts', appId, 'public', 'data', 'signaling', 'host_candidates'), 
          (snap) => {
             const candidates = snap.data()?.candidates || [];
             candidates.forEach((c: any) => {
              if (pc?.remoteDescription && pc?.remoteDescription.type) {
                pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.warn);
              } else {
                candidateQueue.current.push(c);
              }
            });
          }
        );

      } catch (err: any) {
        console.error("❌ Guest setup error:", err);
        if (isMounted.current) {
          setConnectionStatus('failed');
          if (err.name === 'NotAllowedError') {
            setConnectionError('Microphone access denied. Please allow microphone in browser settings.');
          } else {
            setConnectionError('Failed to access microphone: ' + err.message);
          }
        }
      }
    };

    startGuest();

    return () => {
      unsubSignaling();
      unsubCandidates();
      if (pc) {
        pc.close();
        pc = null;
      }
    };
  }, [amISpeaking]);

  // Actions
  const handleJoin = async () => {
    if (!attendeeName.trim() || !user) return;
    setLoading(true);
    try {
      await setDoc(
        doc(db, 'artifacts', appId, 'public', 'data', 'queue', user.uid),
        { name: attendeeName.trim(), userId: user.uid, timestamp: serverTimestamp() }
      );
      setView('dashboard');
    } catch (err: any) {
      alert("Failed to join: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLeave = async () => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'queue', user.uid));
      setView('landing');
      setAttendeeName('');
    } catch (err) {
      console.error("❌ Leave error:", err);
    }
  };

  const nextSpeaker = async () => {
    if (queue.length === 0) return;
    const next = queue[0];
    try {
      // 1. Clear signaling docs first to avoid ghost candidates
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'signaling', 'connection'), {});
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'signaling', 'host_candidates'), { candidates: [] });
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'signaling', 'guest_candidates'), { candidates: [] });
      
      // 2. Set new speaker. This will trigger the Host useEffect which will create a NEW PC
      // because sessionData.currentSpeakerId changes.
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'session_control', 'main'), {
        currentSpeakerId: next.userId, 
        currentSpeakerName: next.name, 
        status: 'speaking'
      });
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'queue', next.userId));
    } catch (err: any) {
      alert("Failed: " + err.message);
    }
  };

  const endSession = async () => {
    try {
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'session_control', 'main'), {
        currentSpeakerId: null, currentSpeakerName: null, status: 'idle'
      });
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'signaling', 'connection'), {});
    } catch (err) {
      console.error("❌ End error:", err);
    }
  };

  const unlockHostAudio = () => {
    if (remoteAudioRef.current) {
      remoteAudioRef.current.play().catch(() => {});
      setAudioUnlocked(true);
    }
  };

  const copyLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // Fallback
      try {
        const textArea = document.createElement("textarea");
        textArea.value = url;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (e) {
        console.error("Copy failed", e);
      }
    });
  };

  // Error State
  if (initError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-red-50 p-6">
        <div className="max-w-md bg-white rounded-2xl shadow-xl p-8 border-2 border-red-200">
          <div className="flex items-center gap-3 mb-4">
            <AlertCircle className="text-red-600" size={24} />
            <h1 className="text-2xl font-black text-red-900">Error</h1>
          </div>
          <p className="text-red-700 mb-6">{initError}</p>
          <button 
            onClick={() => window.location.reload()} 
            className="w-full py-3 bg-red-600 text-white font-bold rounded-xl"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }

  // Loading
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <Loader2 className="animate-spin text-indigo-600 mx-auto mb-4" size={48} />
          <p className="text-slate-600 font-medium">Connecting...</p>
        </div>
      </div>
    );
  }

  // LANDING
  if (view === 'landing') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 flex flex-col p-6">
        <div className="flex-1 flex flex-col items-center justify-center space-y-10">
          <div className="w-full max-w-2xl bg-green-50 border-2 border-green-200 rounded-2xl p-4">
            <div className="flex items-center gap-3">
              <CheckCircle className="text-green-600" size={24} />
              <div>
                <p className="font-bold text-green-900">🎉 SpeakApp is Live with Audio!</p>
                <p className="text-sm text-green-700">
                  Firebase + WebRTC Ready • {queue.length} in queue
                </p>
              </div>
            </div>
          </div>

          <div className="w-28 h-28 bg-white rounded-3xl flex items-center justify-center shadow-xl shadow-indigo-100 border border-white rotate-3 hover:rotate-0 transition-transform">
            <Mic className="text-indigo-600 w-14 h-14" />
          </div>

          <div className="text-center space-y-3">
            <h1 className="text-5xl font-black tracking-tighter text-slate-900">SpeakApp</h1>
            <p className="text-lg text-slate-500 font-medium">The microphone is in your pocket.</p>
          </div>

          <div className="w-full max-w-xs space-y-4">
            <button 
              onClick={() => setView('attendee_setup')}
              className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold text-lg shadow-lg shadow-indigo-200 hover:bg-indigo-700 active:scale-95 transition-all flex items-center justify-center gap-3"
            >
              <Smartphone size={20}/> Join as Attendee
            </button>
          
  <button 
    onClick={() => setView('host')}
    className="w-full py-4 bg-white text-slate-700 border border-slate-200 rounded-2xl font-bold text-lg shadow-sm hover:bg-slate-50 active:scale-95 transition-all flex items-center justify-center gap-3"
  >
    <Monitor size={20}/> Host Dashboard
  </button>


          </div>
        </div>
      </div>
    );
  }

  // ATTENDEE SETUP
  if (view === 'attendee_setup') {
    return (
      <div className="min-h-screen bg-white flex flex-col p-6">
        <button 
          onClick={() => setView('landing')}
          className="text-left mb-8 text-slate-400 font-bold hover:text-slate-600 flex items-center gap-2"
        >
          <ArrowRight className="rotate-180" size={20}/> Back
        </button>
        <div className="flex-1 flex flex-col justify-center max-w-md mx-auto w-full space-y-6">
          <div>
            <h1 className="text-3xl font-black mb-2">Join Queue</h1>
            <p className="text-slate-500">Enter your name to get started.</p>
          </div>
          <input 
            type="text"
            value={attendeeName}
            onChange={(e) => setAttendeeName(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleJoin()}
            className="w-full p-4 text-xl border-2 border-slate-200 rounded-2xl focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 outline-none"
            placeholder="e.g. Alice"
            autoFocus
            maxLength={50}
          />
          <button 
            onClick={handleJoin}
            disabled={!attendeeName.trim() || loading}
            className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-100 disabled:text-slate-400 text-white text-xl font-bold rounded-2xl shadow-xl transition-all flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : null}
            {loading ? 'Joining...' : 'Join Queue'}
          </button>
        </div>
      </div>
    );
  }

  // HOST DASHBOARD
  if (view === 'host') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

        {!audioUnlocked && sessionData.status === 'speaking' && (
          <div 
            onClick={unlockHostAudio}
            className="bg-rose-600 text-white p-4 text-center font-bold cursor-pointer hover:bg-rose-700 flex items-center justify-center gap-2 shadow-md sticky top-0 z-50 animate-pulse"
          >
            <Volume2 className="animate-bounce" /> CLICK TO ENABLE SPEAKERS
          </div>
        )}

        <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center shadow-sm">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-lg text-white">
              <Monitor size={20} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800">Host Dashboard</h1>
              <div className="flex items-center gap-2 mt-1">
                <span className={`w-2 h-2 rounded-full ${
                  connectionStatus === 'connected' ? 'bg-green-500' : 
                  connectionStatus === 'connecting' ? 'bg-amber-500 animate-pulse' :
                  connectionStatus === 'failed' ? 'bg-red-500' :
                  'bg-slate-300'
                }`}></span>
                <span className="text-xs text-slate-500 uppercase">
                  {connectionStatus === 'connected' ? 'CONNECTED' : 
                   connectionStatus === 'connecting' ? 'CONNECTING' :
                   connectionStatus === 'failed' ? 'FAILED' :
                   connectionStatus === 'waiting_for_click' ? 'CLICK ABOVE' :
                   'STANDBY'}
                </span>
              </div>
            </div>
          </div>
          <button 
            onClick={() => setView('landing')}
            className="text-sm font-bold text-slate-400 hover:text-slate-600"
          >
            Exit
          </button>
        </header>

        {connectionError && (
          <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-amber-800 text-sm">
              <AlertCircle size={16} />
              <span>{connectionError}</span>
            </div>
          </div>
        )}

        <main className="flex-1 p-6 max-w-6xl mx-auto w-full grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* QUEUE */}
          <div className="lg:col-span-1 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 border-b bg-slate-50/50 flex justify-between items-center">
              <h2 className="font-bold text-slate-700 flex items-center gap-2">
                <Users size={18} /> Queue
              </h2>
              <span className="bg-indigo-100 text-indigo-700 px-2.5 py-0.5 rounded-full text-xs font-extrabold">
                {queue.length}
              </span>
            </div>
            <div className="p-2 space-y-1 max-h-96 overflow-y-auto">
              {queue.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <QrCode size={32} className="mx-auto mb-4 opacity-40" />
                  <p className="text-sm">Waiting for audience...</p>
                </div>
              ) : (
                queue.map((person, i) => (
                  <div 
                    key={person.id}
                    className="flex items-center justify-between p-3 hover:bg-slate-50 rounded-xl group"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${
                        i === 0 ? 'bg-amber-100 text-amber-700 ring-2 ring-amber-200' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {i + 1}
                      </div>
                      <span className="font-bold text-slate-700 text-sm">{person.name}</span>
                    </div>
                    <button 
                      onClick={() => deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'queue', person.userId))}
                      className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100"
                    >
                      <X size={14}/>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* STAGE */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-8 flex flex-col items-center justify-center text-center min-h-96">
              {sessionData.status === 'speaking' ? (
                <>
                  <div className="mb-6">
                    <div className="w-32 h-32 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center text-5xl font-black text-white shadow-xl ring-8 ring-indigo-50">
                      {sessionData.currentSpeakerName?.charAt(0).toUpperCase() || '?'}
                    </div>
                  </div>
                  
                  <h2 className="text-3xl font-black text-slate-900 mb-2">
                    {sessionData.currentSpeakerName}
                  </h2>
                  <p className="text-slate-500 font-medium mb-8">is speaking</p>
                  
                  <div className="w-full max-w-md mb-8">
                    <AudioVisualizer 
                      stream={mediaStreamForViz} 
                      label={connectionStatus === 'connected' ? "Receiving Audio" : "Waiting..."} 
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4 w-full max-w-md">
                    <button 
                      onClick={endSession}
                      className="py-3 bg-white border-2 border-slate-100 hover:border-slate-200 text-slate-600 font-bold rounded-xl flex items-center justify-center gap-2"
                    >
                      <Ban size={18}/> End
                    </button>
                    <button 
                      onClick={nextSpeaker}
                      disabled={queue.length === 0}
                      className="py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold rounded-xl flex items-center justify-center gap-2"
                    >
                      Next <ArrowRight size={18}/>
                    </button>
                  </div>
                </>
              ) : (
                <div className="opacity-40 flex flex-col items-center">
                  <Mic size={64} className="mb-4 text-slate-300" />
                  <h2 className="text-2xl font-bold text-slate-400">Stage Empty</h2>
                  {queue.length > 0 && (
                    <button 
                      onClick={nextSpeaker}
                      className="mt-8 px-8 py-3 bg-indigo-600 text-white font-bold rounded-full shadow-xl animate-bounce flex items-center gap-2"
                    >
                      <Play size={16} fill="currentColor" /> Call Next
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="bg-slate-900 text-white rounded-2xl p-5 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-lg">Join Session</h3>
                <p className="text-slate-400 text-sm mb-3">Share link</p>
                <button 
                  onClick={copyLink}
                  className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-xs font-bold flex items-center gap-2"
                >
                  {copied ? <CheckCircle size={14}/> : <Copy size={14}/>} 
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div className="bg-white p-1.5 rounded-xl">
                <img 
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(window.location.href)}`}
                  className="w-16 h-16"
                  alt="QR"
                />
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // SPEAKING STATE
  const myPos = queue.findIndex(i => i.userId === user?.uid) + 1;

  if (amISpeaking) {
    return (
      <div className="min-h-screen relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-600 to-purple-700" />
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center p-8 text-center space-y-10 min-h-screen">
          
          <div className="w-32 h-32 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center shadow-2xl border border-white/20 animate-pulse">
            <Mic className="text-white w-16 h-16" />
          </div>
          
          <div className="space-y-2">
            <h1 className="text-5xl font-black text-white">Speak Now</h1>
            <p className="text-indigo-100 text-lg">You are live on stage</p>
            {connectionStatus !== 'connected' && (
              <p className="text-amber-200 text-sm font-bold mt-4 flex items-center justify-center gap-2">
                <Loader2 size={14} className="animate-spin" />
                Connecting...
              </p>
            )}
          </div>

          <div className="w-full max-w-xs">
            <AudioVisualizer stream={mediaStreamForViz} label="Microphone Active" />
            <div className="mt-6 flex items-center justify-center gap-2 text-indigo-200 text-xs font-bold uppercase tracking-widest">
              <div className="w-2 h-2 bg-red-400 rounded-full animate-ping" /> 
              {connectionStatus === 'connected' ? 'Connected' : 'Connecting...'}
            </div>
          </div>

          {connectionError && (
            <div className="bg-red-500/20 backdrop-blur-sm border border-red-300/30 text-white px-6 py-3 rounded-xl text-sm max-w-md">
              {connectionError}
            </div>
          )}

        </div>
      </div>
    );
  }

  // QUEUE STATE
  if (myPos > 0) {
    return (
      <div className={`min-h-screen flex flex-col ${myPos === 1 ? 'bg-amber-400' : 'bg-slate-50'}`}>
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-8">
          
          {myPos === 1 ? (
            <div>
              <div className="bg-white/20 p-6 rounded-full inline-block mb-6">
                <Users size={48} />
              </div>
              <h1 className="text-6xl font-black tracking-tighter mb-4">Get Ready</h1>
              <p className="text-xl font-bold opacity-80 uppercase tracking-widest">You are next</p>
            </div>
          ) : (
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Your Position</p>
              <div className="text-[8rem] leading-none font-black text-slate-900">
                {myPos}
              </div>
              <p className="text-lg font-medium text-slate-500">in line</p>
            </div>
          )}

          <div className="w-full max-w-sm bg-white rounded-2xl p-6 shadow-xl border border-slate-100">
            <h3 className="font-bold text-slate-700 mb-4">Queue Status</h3>
            <div className="space-y-2 text-left text-sm text-slate-600">
              <p>✓ In queue</p>
              <p>✓ Total: {queue.length} waiting</p>
              <p>✓ Real-time updates</p>
            </div>
          </div>

          <button 
            onClick={handleLeave}
            className="px-6 py-3 bg-white border border-slate-200 text-slate-500 font-bold rounded-xl hover:bg-slate-50"
          >
            Leave Queue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <Loader2 className="animate-spin text-indigo-600" size={48} />
    </div>
  );
}