/**
 * Where the subject of each photograph sits, as an `object-position`, so a card that crops it
 * (a wide banner from a 3:2 photo) keeps the point of the picture instead of whatever happens to
 * be in the middle. Chosen by looking at each image (plan15 Wave 9 section 13.2): the whiteboard
 * writing, the student's face, the children at the bench, the hands and books of the 11+ crop.
 */
export const imageFocus: Record<string, string> = {
  "/images/subject-maths.jpg": "50% 38%",
  "/images/subject-english.jpg": "50% 30%",
  "/images/subject-science.jpg": "50% 28%",
  "/images/subject-elevenplus.jpg": "50% 62%",
};
