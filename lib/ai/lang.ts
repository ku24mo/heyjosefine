import { CONFIG } from "@/lib/config";

/**
 * Cheap deterministic language detection — no model call. Conservative by
 * design: we only flip on real confidence (≥2 distinct markers across his
 * recent messages). An English user who types one "hola" or "oi" doesn't
 * flip her. Extend the scorers for future languages.
 */

export type UserLanguage = "en" | "es" | "pt";

// Distinctive Spanish words — deliberately skipping ultra-generic ones
// (de, en, y, un) that also appear in English names/textese.
const SPANISH_WORDS =
  /\b(hola+|eres|estás|estas|estoy|está|dónde|donde|qué|que tal|cómo|como estas|cuándo|cuando|porqué|porque|cuál|cual|cuánto|cuanto|gracias|hablas|español|buenas|buenos|días|noches|hermosa|preciosa|guapa|amor|contigo|conmigo|quiero|quieres|puedes|tienes|mándame|mandame|envíame|enviame|también|tambien|ahora|entonces|pero|porque|mucho|poco|tú|usted|ustedes|vosotros|mi amor|te quiero|me gustas|te amo|adiós|adios|hasta luego|nos vemos|bien|mal|sí|claro|vale|oye|mira|dime|venga|ja(ja)+|je(je)+)(?=$|[^\wáéíóúüñãõçâêôà])/i;

// Structural markers — inverted punctuation and ñ are near-certain.
const SPANISH_CHARS = /[¿¡ñ]/;

// Distinctive Portuguese (BR) words — você/obrigado/ã-words are near-certain.
// Deliberately excludes words shared with Spanish (foto, agora, vamos,
// linda) so an ES message can't score PT hits. A single hit never flips.
const PORTUGUESE_WORDS =
  /\b(você|voce|vc|obrigad[oa]|olá|ola|oi+|tudo (bem|bom|legal)|onde|quando|como vai|por que|porquê|quero|quer|pode|podes|gostosa|gostoso|gata|gato|comigo|então|entao|também|tambem|muito|muita|pouco|pouca|não|nao|sim|bom dia|boa tarde|boa noite|beleza|valeu|fala|diga|tchau|até (logo|mais)|ate (logo|mais)|saudade|gatinha|gatinho|prazer|meu bem|kkk+|rsrs|mds|nossa|e ai|eae|de boa|ta bom|bora|coisa|coisas|sei la|sei lá|pois é|maneiro|maneira|topa|topar)(?=$|[^\wáéíóúüñãõçâêôà])/i;

// Structural — ã/õ are near-certain Portuguese; ç shared with French but
// no FR traffic yet, and it's one marker not two.
const PORTUGUESE_CHARS = /[ãõç]/;

function markersIn(text: string, words: RegExp, chars: RegExp): number {
  let hits = 0;
  const wordMatches = text.match(new RegExp(words.source, "gi"));
  if (wordMatches) hits += new Set(wordMatches.map((w) => w.toLowerCase())).size;
  const charMatches = text.match(new RegExp(chars.source, "g"));
  if (charMatches) hits += Math.min(2, charMatches.length);
  return hits;
}

/**
 * Language of his recent writing. Callers pass their recent user texts
 * (oldest→newest); the newest message matters most but history stabilizes
 * against a one-off "hola" or "oi". Spanish wins ties — it shipped first
 * and its traffic is larger.
 */
export function detectUserLanguage(
  recentUserTexts: string[]
): UserLanguage {
  if (!CONFIG.lang.spanishEnabled && !CONFIG.lang.portugueseEnabled)
    return "en";
  const window = recentUserTexts.slice(-10);
  if (!window.length) return "en";

  let es = 0;
  let pt = 0;
  for (const t of window) {
    if (CONFIG.lang.spanishEnabled) es += markersIn(t, SPANISH_WORDS, SPANISH_CHARS);
    if (CONFIG.lang.portugueseEnabled) pt += markersIn(t, PORTUGUESE_WORDS, PORTUGUESE_CHARS);
  }
  // A single current message rich in one language flips on its own.
  const last = window[window.length - 1];
  if (markersIn(last, SPANISH_WORDS, SPANISH_CHARS) >= 2) return "es";
  if (markersIn(last, PORTUGUESE_WORDS, PORTUGUESE_CHARS) >= 2) return "pt";

  if (es >= 2 && es >= pt) return "es";
  if (pt >= 2) return "pt";
  return "en";
}
