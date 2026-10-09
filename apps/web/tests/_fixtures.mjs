import { crc32, deflateRawSync } from "node:zlib";
import { loadTsFrom } from "./_tsLoader.mjs";

const { currentAgreement } = loadTsFrom(import.meta.url, "../src/lib/safeguarding-agreement.ts");

/** The right answer to every understanding question. */
export const understanding = Object.fromEntries(currentAgreement.understanding.map((question) => [question.id, question.correctOptionId]));

// Small, real file fixtures for the careers tests: a PDF, a Word package (a zip) built byte by byte, and the
// first bytes of a JPEG and a PNG. Nothing here is read from disk, so the tests are self-contained.

/** A minimal PDF. `extra` is appended inside the file (for a feature such as /JavaScript). */
export function pdf(extra = "") {
  return Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R ${extra} >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 0 /Kids [] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`, "latin1");
}

export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from("JFIF\0"), Buffer.alloc(64, 1), Buffer.from([0xff, 0xd9])]);
export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 2)]);

export const WORD_CONTENT_TYPES =
  '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
export const MACRO_CONTENT_TYPES =
  '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>';

/**
 * A zip file. Each entry: { name, data (Buffer|string), method: "deflate" | "store", flags? }. Sizes in the
 * central directory can be overridden (`claimUncompressed`) to build a decompression-bomb lookalike.
 */
export function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const raw = Buffer.from(entry.data ?? "", "utf8");
    const stored = entry.method === "store";
    const body = stored ? raw : deflateRawSync(raw);
    const flags = entry.flags ?? 0;
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.claimUncompressed ?? raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, end]);
}

/** A valid-looking Word package. `extra` entries are added; `contentTypes` can be swapped. */
export function docx({ extra = [], contentTypes = WORD_CONTENT_TYPES } = {}) {
  return zip([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>' },
    { name: "word/document.xml", data: "<w:document><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>" },
    ...extra,
  ]);
}

/** An application that passes every rule. */
export function validApplication() {
  return {
  firstName: "Jane",
  lastName: "Smith",
  email: "jane@example.com",
  phone: "+44 7700 900123",
  town: "Leeds",
  over18: true,
  role: "maths-tutor",
  subjects: ["Maths"],
  yearGroups: ["Year 7", "Year 8"],
  examBoards: "",
  otherSubjects: "",
  highestQualification: "Undergraduate degree (completed)",
  qualificationSubject: "Mathematics",
  gcse: "Maths 9, English 8",
  aLevel: "",
  undergraduate: "",
  postgraduate: "",
  resultsNote: "",
  yearsTutoring: "1 to 2 years",
  additionalNeeds: "Some",
  onlineExperience: "A lot",
  otherRelevant: "",
  times: ["Weekday evenings"],
  hoursPerWeek: "4 to 6 hours",
  startDate: "2026-11-01",
  privateSpace: true,
  rightToWork: "yes",
  dbsCertificate: "",
  dbsUpdateService: "",
  coverLetterText: "",
  whyTutor: "I enjoy explaining things clearly and I have helped my younger cousins with their maths homework for years.",
  stuckLearner: "",
  agreementVersion: currentAgreement.version,
  agreedParts: ["A", "B", "C", "D", "E", "F", "G"],
  understanding,
  typedName: "Jane Smith",
  declAccurate: true,
  declDbs: true,
  declSelfEmployed: true,
  declPrivacy: true,
  talentPool: false,
  };
}
