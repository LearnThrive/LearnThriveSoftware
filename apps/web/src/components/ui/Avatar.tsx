/**
 * Initials-based avatar (plan6 section 48) — no uploaded photos anywhere in this product, so
 * initials are the identity mark everywhere a person appears. The tint is derived from the name
 * so the same person is consistently the same colour, which makes lists scannable without
 * needing to read every row.
 */
const TINTS = ["a", "b", "c", "d", "e"] as const;

function initialsFor(name: string): string {
  // Strip anything that isn't a letter or digit from each word before taking its first character
  // — filtering only *whole* words meant a parenthesised suffix still counted, so the seeded
  // "Alvi Hossain (Admin)" rendered as "A(" everywhere an avatar appeared.
  const words = name
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

function tintFor(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) hash = (hash * 31 + name.charCodeAt(index)) % 997;
  return TINTS[hash % TINTS.length];
}

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`avatar avatar--${size} avatar--tint-${tintFor(name)}`} aria-hidden="true">
      {initialsFor(name)}
    </span>
  );
}
