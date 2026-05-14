import React, { useState, useEffect, useRef } from "react";
import { MessageSquare, Volume2, VolumeX, Globe } from "lucide-react";
import { LANGUAGES } from "../config/languages";
import { translateText, translateAndFilter } from "../services/translation";
import { playBeep, speakText, stopAllTTS } from "../services/tts";
import LangSelect from "./LangSelect";

export default function TranscriptPanel({ transcript, compact = false }) {
  const [lang, setLang] = useState("en");
  const [translated, setTranslated] = useState({});
  const [audioOn, setAudioOn] = useState(false);
  const spokenIds = useRef(new Set());
  const scrollRef = useRef(null);

  // Preload voices
  useEffect(() => {
    if (window.speechSynthesis) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }
  }, []);

  // Auto-scroll
  useEffect(() => {
    setTimeout(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, 50);
  }, [transcript, translated]);

  // Play beep when profanity is detected
  const lastBeepId = useRef(null);
  useEffect(() => {
    if (transcript.length === 0) return;
    const last = transcript[transcript.length - 1];
    if (last.beeped && last.id !== lastBeepId.current) {
      lastBeepId.current = last.id;
      playBeep();
    }
  }, [transcript.length]);

  // Reset when language changes
  useEffect(() => {
    setTranslated({});
    spokenIds.current.clear();
    stopAllTTS();
    setAudioOn(false);
  }, [lang]);

  // Translate new entries when they arrive
  useEffect(() => {
    transcript.forEach((entry) => {
      const key = `${entry.id}-${lang}`;

      if (lang === "en") {
        if (audioOn && !spokenIds.current.has(key)) {
          spokenIds.current.add(key);
          speakText(entry.text, "en", entry.beeped || false);
        }
        return;
      }

      if (translated[key] !== undefined) return;

      setTranslated((prev) => ({ ...prev, [key]: null }));

      if (entry.beeped && entry.originalText) {
        translateAndFilter(entry.originalText, lang).then(({ translated: result }) => {
          setTranslated((prev) => ({ ...prev, [key]: result }));
          if (audioOn && !spokenIds.current.has(key)) {
            spokenIds.current.add(key);
            speakText(result, lang, true);
          }
        });
      } else {
        translateText(entry.text, lang).then((result) => {
          setTranslated((prev) => ({ ...prev, [key]: result }));
          if (audioOn && !spokenIds.current.has(key)) {
            spokenIds.current.add(key);
            speakText(result, lang, false);
          }
        });
      }
    });
  }, [transcript.length, lang, audioOn]);

  // When audio is toggled on, speak most recent entry
  useEffect(() => {
    if (!audioOn) { stopAllTTS(); spokenIds.current.clear(); return; }
    const last = transcript[transcript.length - 1];
    if (last) {
      const key = `${last.id}-${lang}`;
      if (lang === "en") {
        if (!spokenIds.current.has(key)) {
          spokenIds.current.add(key);
          speakText(last.text, "en", last.beeped || false);
        }
      } else {
        const t = translated[key];
        if (t && !spokenIds.current.has(key)) {
          spokenIds.current.add(key);
          speakText(t, lang, last.beeped || false);
        }
      }
    }
  }, [audioOn]);

  return (
    <div className={`flex flex-col ${compact ? "" : "p-4"} h-full`}>
      <div className="flex items-center justify-between mb-3 shrink-0">
        <h3 className="font-semibold flex items-center gap-2 text-sm text-slate-700">
          <MessageSquare size={14} className="text-blue-500" />
          Transcript
          {transcript.length > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-medium text-emerald-600">LIVE</span>
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (!audioOn) {
                if (window.speechSynthesis) {
                  const u = new SpeechSynthesisUtterance("");
                  u.volume = 0;
                  window.speechSynthesis.speak(u);
                }
              }
              setAudioOn(!audioOn);
            }}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              audioOn
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : "bg-slate-100 text-slate-500 border border-slate-200 hover:text-slate-700"
            }`}
          >
            {audioOn ? <Volume2 size={12} /> : <VolumeX size={12} />}
            {audioOn ? "Audio ON" : "Listen"}
          </button>
          <LangSelect value={lang} onChange={setLang} />
        </div>
      </div>
      <div className="mb-2 text-xs flex items-center gap-1.5 shrink-0 text-blue-500">
        <Globe size={11} /> {LANGUAGES.find((l) => l.code === lang)?.label || lang}
        {audioOn && <span className="ml-1 text-emerald-600">• Audio on</span>}
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-2 min-h-0">
        {!transcript.length ? (
          <p className="text-sm text-slate-400 italic">Transcript appears here when someone speaks...</p>
        ) : transcript.map((e, i) => {
          const key = `${e.id}-${lang}`;
          const t = lang === "en" ? e.text : translated[key];
          return (
            <div key={e.id || i} className={`rounded-xl p-3 ${
              e.beeped ? "bg-red-50 border border-red-200" : "bg-slate-50 border border-slate-100"
            }`}>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-xs text-blue-600">{e.speaker}</span>
                {e.beeped && <span className="text-[10px] font-medium text-red-500">• filtered</span>}
              </div>
              {t === null || t === undefined ? (
                <p className="mt-1 text-sm text-slate-400 italic animate-pulse">Translating...</p>
              ) : (
                <p className="mt-1 text-sm text-slate-700">{t}</p>
              )}
              {lang !== "en" && t && t !== e.text && (
                <p className="mt-1 text-xs text-slate-400 italic">{e.text}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
