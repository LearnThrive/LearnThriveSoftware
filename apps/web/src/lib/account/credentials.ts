import { randomInt } from "node:crypto";

/**
 * The two things an administrator hands to a new person. Server only. Neither is ever logged or stored by this site: Supabase Auth keeps
 * only the hash of the password, and it is shown once to the administrator.
 */

// No 0/O, 1/l/I: these get read aloud over the phone and copied from a screen.
const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const TEMPORARY_PASSWORD_LENGTH = 20;

export function generateTemporaryPassword(): string {
  let password = "";
  for (let i = 0; i < TEMPORARY_PASSWORD_LENGTH; i += 1) password += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  return password;
}

// A word and four digits. Children's Code: a child's username says nothing about them, so it is never built from their name or school.
const WORDS = [
  "amber", "aspen", "birch", "brook", "cedar", "cloud", "comet", "coral", "ember", "fern", "finch", "harbour", "hazel", "heron", "iris", "ivy",
  "juniper", "kestrel", "lark", "maple", "marble", "meadow", "moss", "oak", "opal", "otter", "pebble", "pine", "plover", "quartz", "raven", "reed",
  "river", "robin", "rowan", "sage", "skylark", "sparrow", "spruce", "stone", "swift", "thistle", "tide", "willow", "wren",
];

export function generateChildUsername(): string {
  return `${WORDS[randomInt(WORDS.length)]}-${randomInt(1000, 10000)}`;
}
