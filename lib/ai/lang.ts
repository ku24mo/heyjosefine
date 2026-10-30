import { CONFIG } from "@/lib/config";

/**
 * Cheap deterministic language detection — no model call. Conservative by
 * design: we only flip to Spanish on real confidence (≥2 distinct markers
 * across his recent messages). An English user who types one "hola" or
 * "por qué" doesn't flip her. Extend the scorer for future languages.
 */

export type UserLanguage = "en" | "es";

// Distinctive Spanish words — deliberately skipping ultra-generic ones
// (de, en, y, un) that also appear in English names/textese.
const SPANISH_WORDS =
  /\b(hola+|eres|estás|estas|estoy|está|dónde|donde|qué|que tal|cómo|como estas|cuándo|cuando|porqué|porque|cuál|cual|cuánto|cuanto|gracias|hablas|español|buenas|buenos|días|noches|hermosa|preciosa|guapa|amor|contigo|conmigo|quiero|quieres|puedes|tienes|mándame|mandame|envíame|enviame|también|tambien|ahora|entonces|pero|porque|mucho|poco|tú|usted|ustedes|vosotros|mi amor|te quiero|me gustas|te amo|adiós|adios|hasta luego|nos vemos|bien|mal|sí|claro|vale|oye|mira|dime|venga|ja(ja)+|je(je)+)(?=$|[^\wáéíóúüñ])/i;

// Structural markers — inverted punctuation and ñ are near-certain.
const SPANISH_CHARS = /[¿¡ñ]/;

function markersIn(text: string): number {
  let hits = 0;
  const wordMatches = text.match(new RegExp(SPANISH_WORDS.source, "gi"));
  if (wordMatches) hits += new Set(wordMatches.map((w) => w.toLowerCase())).size;
  const charMatches = text.match(new RegExp(SPANISH_CHARS.source, "g"));
  if (charMatches) hits += Math.min(2, charMatches.length);
  return hits;
}

/**
 * Language of his recent writing. Callers pass their recent user texts
 * (oldest→newest); the newest message matters most but history stabilizes
 * against a one-off "hola".
 */
export function detectUserLanguage(
  recentUserTexts: string[]
): UserLanguage {
  if (!CONFIG.lang.spanishEnabled) return "en";
  const window = recentUserTexts.slice(-10);
  if (!window.length) return "en";
  let hits = 0;
  for (const t of window) hits += markersIn(t);
  // A single current message rich in Spanish flips on its own.
  if (markersIn(window[window.length - 1]) >= 2) return "es";
  return hits >= 2 ? "es" : "en";
}
