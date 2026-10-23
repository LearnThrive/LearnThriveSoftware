/**
 * Which set text a message is about, so a search can name the work. This only RECOGNISES a title or a character's name; it holds no text of any
 * work. Every quotation and fact is checked against sources found on the web, never against anything stored here.
 */
const WORKS: Array<{ name: string; test: RegExp }> = [
  { name: "Macbeth", test: /\bmacbeth\b|\bbanquo\b|\bmacduff\b|\bduncan\b|\bwitches\b/i },
  { name: "An Inspector Calls", test: /\binspector\s+calls\b|\bgoole\b|\bbirling\b|\beva\s+smith\b|\bpriestley\b/i },
];

export function workOf(text: string): string | null {
  return WORKS.find((w) => w.test.test(text))?.name ?? null;
}
