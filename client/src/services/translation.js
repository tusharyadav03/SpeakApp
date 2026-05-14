import { API } from "../config/api";

let translateQueue = Promise.resolve();

export async function translateText(text, targetLang) {
  if (!text || targetLang === "en") return text;

  const result = await new Promise((resolve) => {
    translateQueue = translateQueue.then(async () => {
      await new Promise((r) => setTimeout(r, 100));
      try {
        const r = await fetch(`${API}/api/translate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, target: targetLang }),
        });
        if (r.ok) {
          const d = await r.json();
          if (d.translated && d.translated.toLowerCase() !== text.toLowerCase()) {
            resolve(d.translated);
            return;
          }
        }
      } catch {}
      // Fallback: MyMemory direct (CORS-friendly)
      try {
        const tl = targetLang === "no" ? "nb" : targetLang === "lb" ? "de" : targetLang;
        const r = await fetch(
          `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 500))}&langpair=en|${tl}&de=speakapp@conference.io`
        );
        if (r.ok) {
          const d = await r.json();
          const result = d.responseData?.translatedText;
          if (result && !result.includes("MYMEMORY WARNING") && result.toLowerCase() !== text.toLowerCase()) {
            resolve(result);
            return;
          }
        }
      } catch {}
      resolve(text);
    });
  });
  return result;
}

export async function translateAndFilter(originalText, targetLang) {
  if (!originalText || targetLang === "en") return { translated: originalText, beeped: false };

  const result = await new Promise((resolve) => {
    translateQueue = translateQueue.then(async () => {
      await new Promise((r) => setTimeout(r, 100));
      try {
        const r = await fetch(`${API}/api/translate-filter`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: originalText, target: targetLang }),
        });
        if (r.ok) {
          const d = await r.json();
          resolve({ translated: d.translated || originalText, beeped: d.beeped || false });
          return;
        }
      } catch {}
      // Fallback: regular translate (won't filter but at least translates)
      try {
        const tl = targetLang === "no" ? "nb" : targetLang === "lb" ? "de" : targetLang;
        const r = await fetch(
          `https://api.mymemory.translated.net/get?q=${encodeURIComponent(originalText.slice(0, 500))}&langpair=en|${tl}&de=speakapp@conference.io`
        );
        if (r.ok) {
          const d = await r.json();
          const result = d.responseData?.translatedText;
          if (result && !result.includes("MYMEMORY WARNING")) {
            resolve({ translated: result, beeped: false });
            return;
          }
        }
      } catch {}
      resolve({ translated: originalText, beeped: false });
    });
  });
  return result;
}
