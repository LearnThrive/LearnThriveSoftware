import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { loadTsFrom } from "./_tsLoader.mjs";

// plan15 Wave 10: schema.org builders. The FAQPage text has to match the answer the page shows, and
// nothing in the JSON may be able to break out of its <script>.
const sd = loadTsFrom(import.meta.url, "../src/lib/structuredData.ts");

test("breadcrumbs always start at Home and use absolute URLs, positions from 1", () => {
  const data = sd.breadcrumbData([{ name: "Subjects", path: "/subjects" }, { name: "Maths tuition", path: "/maths-tuition" }]);
  assert.equal(data["@type"], "BreadcrumbList");
  assert.deepEqual(data.itemListElement.map((i) => i.position), [1, 2, 3]);
  assert.deepEqual(data.itemListElement.map((i) => i.name), ["Home", "Subjects", "Maths tuition"]);
  assert.ok(data.itemListElement.every((i) => /^https:\/\//.test(i.item)));
  assert.equal(data.itemListElement[0].item.endsWith("/"), false, "Home is the bare origin");
});

test("nodeToText flattens strings, numbers, arrays and nested elements", () => {
  assert.equal(sd.nodeToText("plain"), "plain");
  assert.equal(sd.nodeToText(["a", 2, null, false, "b"]), "a 2 b");
  const jsx = createElement("p", null, "Read our ", createElement("a", { href: "/privacy" }, "privacy notice"), " first.");
  assert.equal(sd.nodeToText(jsx), "Read our privacy notice first.");
  assert.equal(sd.nodeToText(undefined), "");
});

test("faqPageData keeps questions with text, drops empty answers, mirrors the question and answer", () => {
  const data = sd.faqPageData([
    { question: "How do I start?", answer: "Send an enquiry." },
    { question: "Empty?", answer: null },
    { question: "With a link", answer: createElement("span", null, "See ", createElement("a", { href: "/book" }, "Book"), ".") },
  ]);
  assert.equal(data["@type"], "FAQPage");
  assert.equal(data.mainEntity.length, 2);
  assert.deepEqual(data.mainEntity.map((q) => q.name), ["How do I start?", "With a link"]);
  assert.equal(data.mainEntity[1].acceptedAnswer.text, "See Book .");
  assert.equal(data.mainEntity[0]["@type"], "Question");
  assert.equal(data.mainEntity[0].acceptedAnswer["@type"], "Answer");
});

test("jsonLdString escapes < so content can never close the script tag", () => {
  const out = sd.jsonLdString({ text: "</script><script>alert(1)</script>" });
  assert.ok(!out.includes("</script>"));
  assert.equal(JSON.parse(out).text, "</script><script>alert(1)</script>", "still round-trips");
});

test("the WebSite block names the real site and carries no search action or reviews", () => {
  const data = sd.webSiteData();
  assert.equal(data["@type"], "WebSite");
  assert.equal(data.inLanguage, "en-GB");
  assert.equal("potentialAction" in data, false);
  assert.equal(JSON.stringify(data).includes("Review"), false);
});
