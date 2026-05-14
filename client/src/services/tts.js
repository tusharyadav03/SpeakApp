export const TTS_LANG_MAP = {
  en: "en-US", fr: "fr-FR", de: "de-DE", es: "es-ES", it: "it-IT",
  pt: "pt-PT", nl: "nl-NL", pl: "pl-PL", ro: "ro-RO", sv: "sv-SE",
  da: "da-DK", fi: "fi-FI", no: "nb-NO", el: "el-GR", cs: "cs-CZ",
  hu: "hu-HU", bg: "bg-BG", hr: "hr-HR", sk: "sk-SK", sl: "sl-SI",
  et: "et-EE", lv: "lv-LV", lt: "lt-LT", lb: "de-DE", ru: "ru-RU",
  uk: "uk-UA", tr: "tr-TR",
};

let ttsQueue = [];
let ttsSpeaking = false;

export function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = 1000;
    gain.gain.value = 0.3;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.stop(ctx.currentTime + 0.4);
    setTimeout(() => ctx.close(), 500);
  } catch {}
}

function findVoice(langCode) {
  const voices = window.speechSynthesis.getVoices();
  const langPrefix = (TTS_LANG_MAP[langCode] || langCode).split("-")[0];
  return voices.find((v) => v.lang.startsWith(langPrefix) && v.name.toLowerCase().includes("google")) ||
         voices.find((v) => v.lang.startsWith(langPrefix) && v.name.toLowerCase().includes("microsoft")) ||
         voices.find((v) => v.lang.startsWith(langPrefix));
}

function makeUtterance(text, langCode) {
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = TTS_LANG_MAP[langCode] || langCode;
  utter.rate = 0.9;
  utter.pitch = 1.0;
  utter.volume = 1.0;
  const voice = findVoice(langCode);
  if (voice) utter.voice = voice;
  return utter;
}

export function speakText(text, langCode, shouldBeep = false) {
  if (!text && !shouldBeep) return;

  if (shouldBeep && text && window.speechSynthesis) {
    const parts = text.split(/(\S\*{2,}\S?)/g).filter(Boolean);
    let hasContent = false;
    for (const part of parts) {
      if (/\S\*{2,}/.test(part)) {
        ttsQueue.push({ type: "beep" });
      } else {
        const clean = part.trim();
        if (clean) {
          hasContent = true;
          ttsQueue.push({ type: "speech", utter: makeUtterance(clean, langCode) });
        }
      }
    }
    if (!hasContent && ttsQueue.length === 0) {
      ttsQueue.push({ type: "beep" });
    }
  } else if (shouldBeep && !text) {
    ttsQueue.push({ type: "beep" });
  } else if (text && window.speechSynthesis) {
    ttsQueue.push({ type: "speech", utter: makeUtterance(text, langCode) });
  }

  processNextTTS();
}

function processNextTTS() {
  if (ttsSpeaking || ttsQueue.length === 0) return;
  ttsSpeaking = true;

  const item = ttsQueue.shift();

  if (item.type === "beep") {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = 1000;
      gain.gain.value = 0.5;
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.stop(ctx.currentTime + 0.5);
      setTimeout(() => { ctx.close(); ttsSpeaking = false; processNextTTS(); }, 550);
    } catch {
      ttsSpeaking = false;
      processNextTTS();
    }
  } else if (item.type === "speech" && item.utter) {
    item.utter.onend = () => { ttsSpeaking = false; processNextTTS(); };
    item.utter.onerror = () => { ttsSpeaking = false; processNextTTS(); };
    if (window.speechSynthesis) window.speechSynthesis.speak(item.utter);
    else { ttsSpeaking = false; processNextTTS(); }
  } else {
    ttsSpeaking = false;
    processNextTTS();
  }
}

export function stopAllTTS() {
  ttsQueue = [];
  ttsSpeaking = false;
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}
