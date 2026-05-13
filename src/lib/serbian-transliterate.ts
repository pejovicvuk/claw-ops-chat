// Serbian Cyrillic → Latin transliteration. Deterministic 1:1 mapping for
// single letters, plus three digraphs (љ→lj, њ→nj, џ→dž) whose uppercase
// form depends on context: "Lj" inside a Title-cased word, "LJ" inside an
// ALL-CAPS run (decided by looking at the next character).
//
// Unmapped characters (Latin letters, digits, punctuation, whitespace,
// emoji, non-Serbian Cyrillic) pass through unchanged — so it's safe to
// run this on any browser-returned transcript regardless of script.

const SINGLE_MAP: Record<string, string> = {
  // Lowercase
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  ђ: "đ",
  е: "e",
  ж: "ž",
  з: "z",
  и: "i",
  ј: "j",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  ћ: "ć",
  у: "u",
  ф: "f",
  х: "h",
  ц: "c",
  ч: "č",
  ш: "š",
  // Uppercase
  А: "A",
  Б: "B",
  В: "V",
  Г: "G",
  Д: "D",
  Ђ: "Đ",
  Е: "E",
  Ж: "Ž",
  З: "Z",
  И: "I",
  Ј: "J",
  К: "K",
  Л: "L",
  М: "M",
  Н: "N",
  О: "O",
  П: "P",
  Р: "R",
  С: "S",
  Т: "T",
  Ћ: "Ć",
  У: "U",
  Ф: "F",
  Х: "H",
  Ц: "C",
  Ч: "Č",
  Ш: "Š",
};

const DIGRAPH_LOWER: Record<string, string> = {
  љ: "lj",
  њ: "nj",
  џ: "dž",
};

// [TitleCase, AllCaps] — pick by inspecting the next character.
const DIGRAPH_UPPER: Record<string, [string, string]> = {
  Љ: ["Lj", "LJ"],
  Њ: ["Nj", "NJ"],
  Џ: ["Dž", "DŽ"],
};

function isUpperLetter(ch: string | undefined): boolean {
  if (!ch) return false;
  return ch === ch.toUpperCase() && ch !== ch.toLowerCase();
}

export function cyrillicToLatin(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const digraphLower = DIGRAPH_LOWER[ch];
    if (digraphLower) {
      out += digraphLower;
      continue;
    }
    const digraphUpper = DIGRAPH_UPPER[ch];
    if (digraphUpper) {
      out += isUpperLetter(input[i + 1]) ? digraphUpper[1] : digraphUpper[0];
      continue;
    }
    out += SINGLE_MAP[ch] ?? ch;
  }
  return out;
}
