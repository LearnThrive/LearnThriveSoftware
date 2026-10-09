import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";
import { docx, JPEG, MACRO_CONTENT_TYPES, PNG, pdf, zip } from "./_fixtures.mjs";

// The careers upload rules: names, sizes and types in the browser's shared half, and in the server's half what
// a file actually contains (signatures, PDF features, a Word package's contents).

const shared = loadTsFrom(import.meta.url, "../src/lib/careers-files.ts");
const server = loadTsFrom(import.meta.url, "../src/lib/careers-files-server.ts");
const { careersConfig } = loadTsFrom(import.meta.url, "../src/lib/careers-config.ts");

const MB = 1024 * 1024;
const verdict = (slot, name, bytes) => server.inspectFile(slot, name, bytes);
const rejected = (slot, name, bytes, code) => {
  const result = verdict(slot, name, bytes);
  assert.equal(result.ok, false, `${name} should be refused`);
  if (code) assert.equal(result.problem.code, code, result.problem.message);
  assert.ok(result.problem.message.length > 10);
};

test("real PDF, DOCX, JPEG and PNG files are accepted in the slots that allow them", () => {
  assert.deepEqual(verdict("cv", "My CV.pdf", pdf()), { ok: true });
  assert.deepEqual(verdict("cv", "My CV.docx", docx()), { ok: true });
  assert.deepEqual(verdict("coverLetterFile", "letter.PDF", pdf()), { ok: true });
  assert.deepEqual(verdict("supporting", "degree.jpg", JPEG), { ok: true });
  assert.deepEqual(verdict("supporting", "degree.jpeg", JPEG), { ok: true });
  assert.deepEqual(verdict("supporting", "passport.png", PNG), { ok: true });
});

test("images are not accepted as a CV or a cover letter file", () => {
  rejected("cv", "cv.jpg", JPEG, "type");
  rejected("coverLetterFile", "letter.png", PNG, "type");
});

test("the extension decides the type, then the content must agree (spoofed types are refused)", () => {
  rejected("cv", "cv.pdf", docx(), "content");
  rejected("cv", "cv.docx", pdf(), "content");
  rejected("supporting", "photo.jpg", PNG, "content");
  rejected("supporting", "photo.png", Buffer.from("MZ this is a program", "latin1"), "content");
  rejected("cv", "cv.pdf", Buffer.from("just some text, not a pdf", "latin1"), "content");
});

test("old Word, macro, archive, program and phone-photo formats are refused with a helpful message", () => {
  for (const [name, hint] of [
    ["cv.doc", /Save as PDF/],
    ["cv.docm", /macros/],
    ["cv.zip", /archives/],
    ["cv.rar", /archives/],
    ["cv.exe", /not accepted/],
    ["cv.js", /not accepted/],
    ["photo.heic", /JPG/],
  ]) {
    const result = verdict("supporting", name, Buffer.from("x"));
    assert.equal(result.ok, false, name);
    assert.match(result.problem.message, hint, name);
  }
  assert.equal(verdict("cv", "no-extension", pdf()).problem.code, "type");
});

test("a double extension is judged by its last part, and the dots are removed from the clean name", () => {
  rejected("cv", "cv.pdf.exe", pdf(), "type");
  assert.deepEqual(verdict("cv", "cv.exe.pdf", pdf()), { ok: true });
  assert.equal(shared.sanitiseFileName("cv.exe.pdf").full, "cv-exe.pdf");
});

test("empty and oversized files are refused with the size in the message", () => {
  rejected("cv", "cv.pdf", Buffer.alloc(0), "empty");
  const big = Buffer.concat([pdf(), Buffer.alloc(careersConfig.limits.cv.maxBytes)]);
  rejected("cv", "cv.pdf", big, "too-big");
  assert.match(verdict("cv", "cv.pdf", big).problem.message, /MB/);
  assert.equal(shared.checkFileBasics("supporting", "a.png", careersConfig.limits.supporting.maxBytes), null);
  assert.equal(shared.checkFileBasics("supporting", "a.png", careersConfig.limits.supporting.maxBytes + 1).code, "too-big");
});

test("the total across all files is capped", () => {
  assert.equal(shared.totalProblem([3 * MB, 3 * MB, 3 * MB, 3 * MB]), null);
  assert.equal(shared.totalProblem([3 * MB, 3 * MB, 3 * MB, 3 * MB, 1]).code, "total");
});

test("a PDF that is encrypted, scripted, launches things or embeds files is refused", () => {
  rejected("cv", "a.pdf", pdf("/Encrypt 5 0 R"), "encrypted");
  rejected("cv", "a.pdf", pdf("/OpenAction << /S /JavaScript /JS (app.alert(1)) >>"), "script");
  rejected("cv", "a.pdf", pdf("/AA << /O << /S /Launch /F (cmd.exe) >> >>"), "script");
  rejected("cv", "a.pdf", pdf("/Names << /EmbeddedFiles << >> >> /EmbeddedFile"), "embedded");
});

test("a PDF that hides a feature name with a #xx escape is still caught", () => {
  rejected("cv", "a.pdf", pdf("/S /J#61vaScript"), "script");
  rejected("cv", "a.pdf", pdf("/#45ncrypt 3 0 R"), "encrypted");
});

test("an ordinary PDF mentioning a similar word is not refused", () => {
  assert.deepEqual(verdict("cv", "a.pdf", pdf("/Title (JSON and JavaScript-free)")), { ok: true });
});

test("a Word file with macros, ActiveX or embedded objects is refused", () => {
  rejected("cv", "a.docx", docx({ extra: [{ name: "word/vbaProject.bin", data: "x" }] }), "macro");
  rejected("cv", "a.docx", docx({ extra: [{ name: "word/activeX/activeX1.xml", data: "x" }] }), "macro");
  rejected("cv", "a.docx", docx({ extra: [{ name: "word/embeddings/oleObject1.bin", data: "x" }] }), "macro");
  rejected("cv", "a.docx", docx({ extra: [{ name: "word/payload.exe", data: "x" }] }), "macro");
  rejected("cv", "a.docx", docx({ contentTypes: MACRO_CONTENT_TYPES }), "macro");
});

test("a zip that is not a Word package is refused", () => {
  rejected("cv", "a.docx", zip([{ name: "readme.txt", data: "hello" }]), "content");
  rejected("cv", "a.docx", zip([{ name: "[Content_Types].xml", data: "<Types/>" }, { name: "word/document.xml", data: "x" }]), "content");
  rejected("cv", "a.docx", Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40)]), "content");
});

test("an encrypted entry, a path-traversal name and a decompression bomb are refused", () => {
  rejected("cv", "a.docx", docx({ extra: [{ name: "word/secret.xml", data: "x", flags: 1 }] }), "encrypted");
  rejected("cv", "a.docx", docx({ extra: [{ name: "../evil.xml", data: "x" }] }), "content");
  rejected("cv", "a.docx", docx({ extra: [{ name: "word/bomb.xml", data: "0".repeat(2000), claimUncompressed: 900 * 1024 * 1024 }] }), "content");
});

test("a stored (uncompressed) content-types part is read too", () => {
  const file = zip([
    { name: "[Content_Types].xml", data: "wordprocessingml.document.main+xml", method: "store" },
    { name: "word/document.xml", data: "<w:document/>" },
  ]);
  assert.deepEqual(verdict("cv", "a.docx", file), { ok: true });
});

test("file names are cleaned: paths, odd characters, direction tricks, length", () => {
  const { sanitiseFileName } = shared;
  assert.equal(sanitiseFileName("../../etc/passwd.pdf").full, "passwd.pdf");
  assert.equal(sanitiseFileName("C:\\Users\\me\\My CV (final).pdf").full, "My CV (final).pdf");
  assert.equal(sanitiseFileName("cv\u202Efdp.exe").full, "cvfdp.exe");
  assert.equal(sanitiseFileName("résumé – Zoë.PDF").full, "résumé - Zoë.pdf");
  assert.equal(sanitiseFileName("<script>alert(1)</script>.pdf").full, "script.pdf"); // the "/" ends a path, so only the last part is kept
  assert.equal(sanitiseFileName("....pdf").full, "document.pdf");
  assert.equal(sanitiseFileName(".pdf").full, "document.pdf");
  assert.equal(sanitiseFileName("a".repeat(300) + ".pdf").base.length, 80);
  assert.equal(sanitiseFileName("line\nbreak\r.pdf").full, "linebreak.pdf");
  assert.ok(!/[\r\n\\/]/.test(sanitiseFileName("line\nbreak\r.pdf").full));
});

test("the zip reader reports a plain, intact package and refuses ZIP64 or junk", () => {
  const entries = server.readZipDirectory(docx());
  assert.deepEqual(entries.map((entry) => entry.name), ["[Content_Types].xml", "_rels/.rels", "word/document.xml"]);
  assert.equal(server.readZipDirectory(Buffer.from("not a zip at all, definitely not")), null);
  assert.equal(server.readZipDirectory(Buffer.alloc(10)), null);
});
