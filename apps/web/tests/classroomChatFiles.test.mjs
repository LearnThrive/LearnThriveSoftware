import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// What may be shared in a staff meeting's chat (packages/shared/chatFiles.ts, enforced by the room server and checked early in the browser), and how links in a
// message are found (features/classroom/linkify.ts).
const files = loadTsFrom(import.meta.url, "../../../packages/shared/chatFiles.ts");
const { linkify } = loadTsFrom(import.meta.url, "../src/features/classroom/linkify.ts");

test("documents, spreadsheets, slides, images, audio, video, text and zip files may be shared", () => {
  for (const name of ["paper.pdf", "notes.docx", "Notes.DOC", "marks.xlsx", "slides.pptx", "scan.jpg", "photo.JPEG", "diagram.png", "anim.gif", "pic.webp", "phone.heic", "plan.odt", "data.csv", "readme.md", "proof.tex", "talk.mp4", "clip.mov", "voice.m4a", "song.mp3", "bundle.zip", "lab.ipynb"]) {
    assert.equal(files.chatFileProblem(name, 1000), null, name);
  }
});

test("programs, scripts, installers, shortcuts, macro-enabled Office files and extensionless names are refused", () => {
  for (const name of ["a.exe", "a.bat", "a.cmd", "a.com", "a.scr", "a.msi", "a.js", "a.mjs", "a.vbs", "a.ps1", "a.sh", "a.app", "a.dmg", "a.jar", "a.apk", "a.lnk", "a.dll", "a.hta", "a.docm", "a.xlsm", "a.pptm", "report.pdf.exe", "noextension", ".hidden", "trailingdot."]) {
    assert.match(files.chatFileProblem(name, 1000) ?? "", /cannot be shared/, name);
  }
});

test("size: empty and over 10 MB are refused with a message that says what to do", () => {
  assert.match(files.chatFileProblem("a.pdf", 0), /empty/);
  assert.equal(files.chatFileProblem("a.pdf", 10_000_000), null);
  assert.match(files.chatFileProblem("a.pdf", 10_000_001), /over 10 MB.*link/);
});

test("a name is made safe to show and save: no folders, no control characters, not too long, real extension kept", () => {
  assert.equal(files.safeFileName("..\\..\\folder/Past Paper 1.pdf"), "Past Paper 1.pdf");
  assert.equal(files.safeFileName("a\u0000b<c>:d.pdf"), "abcd.pdf");
  assert.equal(files.safeFileName("   spaced   out .PDF"), "spaced out .pdf");
  const long = files.safeFileName(`${"x".repeat(300)}.docx`);
  assert.ok(long.length <= files.MAX_CHAT_FILE_NAME && long.endsWith(".docx"));
  assert.equal(files.safeFileName("....pdf"), "file.pdf");
});

test("the content type comes from the extension, SVG is never drawn in the page, and only raster images are", () => {
  assert.equal(files.contentTypeFor("x.pdf"), "application/pdf");
  assert.equal(files.contentTypeFor("x.PNG"), "image/png");
  assert.equal(files.contentTypeFor("x.unknown"), "application/octet-stream");
  for (const name of ["a.png", "a.jpg", "a.jpeg", "a.gif", "a.webp"]) assert.equal(files.isInlineImage(name), true, name);
  for (const name of ["a.svg", "a.heic", "a.bmp", "a.pdf"]) assert.equal(files.isInlineImage(name), false, name);
  assert.match(files.CHAT_FILE_ACCEPT, /\.pdf,/);
  assert.equal(files.CHAT_FILE_ACCEPT.includes(".exe"), false);
});

test("sizes read plainly", () => {
  assert.equal(files.formatFileSize(512), "512 B");
  assert.equal(files.formatFileSize(48_000), "48 KB");
  assert.equal(files.formatFileSize(2_500_000), "2.5 MB");
  assert.equal(files.formatFileSize(10_000_000), "10 MB");
});

test("links in a message become clickable; only http and https, and sentence punctuation stays outside", () => {
  assert.deepEqual(linkify("no links here"), [{ kind: "text", text: "no links here" }]);
  assert.deepEqual(linkify("see https://example.com/page."), [
    { kind: "text", text: "see " }, { kind: "link", text: "https://example.com/page", href: "https://example.com/page" }, { kind: "text", text: "." },
  ]);
  const wiki = linkify("read https://en.wikipedia.org/wiki/Pi_(number) now");
  assert.equal(wiki[1].href, "https://en.wikipedia.org/wiki/Pi_(number)");
  const two = linkify("a http://one.example/x, b https://two.example/y");
  assert.deepEqual(two.filter((p) => p.kind === "link").map((p) => p.href), ["http://one.example/x", "https://two.example/y"]);
  assert.equal(linkify("click javascript:alert(1)").some((p) => p.kind === "link"), false);
  assert.equal(linkify("data:text/html,<b>x</b> and file:///etc/passwd").some((p) => p.kind === "link"), false);
  assert.equal(linkify("http://localhost").some((p) => p.kind === "link"), false, "a bare host with no dot is not treated as a web address");
  assert.equal(linkify("<script>https://x.example</script>").some((p) => p.kind === "text" && p.text.includes("<script>")), true, "markup stays plain text");
});
