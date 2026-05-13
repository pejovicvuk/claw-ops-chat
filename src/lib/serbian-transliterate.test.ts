import { describe, it, expect } from "vitest";
import { cyrillicToLatin } from "./serbian-transliterate";

describe("cyrillicToLatin", () => {
  it("maps every lowercase Serbian Cyrillic single letter", () => {
    expect(cyrillicToLatin("абвгдђежзијклмнопрстћуфхцчш")).toBe("abvgdđežzijklmnoprstćufhcčš");
  });

  it("maps every uppercase Serbian Cyrillic single letter", () => {
    expect(cyrillicToLatin("АБВГДЂЕЖЗИЈКЛМНОПРСТЋУФХЦЧШ")).toBe("ABVGDĐEŽZIJKLMNOPRSTĆUFHCČŠ");
  });

  it("expands lowercase digraphs", () => {
    expect(cyrillicToLatin("љубав")).toBe("ljubav");
    expect(cyrillicToLatin("њушка")).toBe("njuška");
    expect(cyrillicToLatin("џак")).toBe("džak");
  });

  it("renders uppercase digraphs as Title-case inside a Title-cased word", () => {
    expect(cyrillicToLatin("Љубав")).toBe("Ljubav");
    expect(cyrillicToLatin("Његош")).toBe("Njegoš");
    expect(cyrillicToLatin("Џак")).toBe("Džak");
  });

  it("renders uppercase digraphs as ALL-CAPS inside an ALL-CAPS word", () => {
    expect(cyrillicToLatin("ЉУБАВ")).toBe("LJUBAV");
    expect(cyrillicToLatin("ЊЕГОШ")).toBe("NJEGOŠ");
    expect(cyrillicToLatin("ЏАК")).toBe("DŽAK");
  });

  it("treats an isolated uppercase digraph as Title-case", () => {
    expect(cyrillicToLatin("Љ")).toBe("Lj");
    expect(cyrillicToLatin("Љ ")).toBe("Lj ");
  });

  it("passes Latin letters, digits, and punctuation through unchanged", () => {
    expect(cyrillicToLatin("Hello, world! 123 ć č š đ ž")).toBe("Hello, world! 123 ć č š đ ž");
  });

  it("handles mixed Cyrillic + Latin + punctuation", () => {
    expect(cyrillicToLatin("Здраво, world! Како си?")).toBe("Zdravo, world! Kako si?");
  });

  it("handles a realistic sentence with multiple digraphs", () => {
    expect(cyrillicToLatin("Његова љубав према џезу је огромна.")).toBe(
      "Njegova ljubav prema džezu je ogromna.",
    );
  });

  it("preserves empty input and whitespace-only input", () => {
    expect(cyrillicToLatin("")).toBe("");
    expect(cyrillicToLatin("   ")).toBe("   ");
  });

  it("passes through non-Serbian Cyrillic characters unchanged", () => {
    // Russian-only letters: ы, э, ё, щ, ъ, ь, ю, я
    expect(cyrillicToLatin("ы")).toBe("ы");
    expect(cyrillicToLatin("я")).toBe("я");
  });
});
