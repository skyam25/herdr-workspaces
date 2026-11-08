import test from "node:test";
import assert from "node:assert/strict";
import { imageToken, nextImageNumber, withoutLeadingLabels, orphanedImages, numberForSend } from "../hws-chat/imagelabels.js";

const A = { path: "/a.png", image: true, label: 1 };
const B = { path: "/b.png", image: true, label: 2 };
const LOOSE = { path: "/c.png", image: true };
const NOTES = { path: "/notes.txt", image: false };
const span = (n) => ({ range: { start: 0, end: 10 }, token: imageToken(n) });

test("numbers count up from the highest label in the message", () => {
  assert.equal(nextImageNumber([]), 1);
  assert.equal(nextImageNumber([A, LOOSE, NOTES]), 2);
  assert.equal(nextImageNumber([B]), 3);
});

test("a deleted label orphans only its own image", () => {
  assert.deepEqual(orphanedImages([A, B], [span(2)]), [A]);
  assert.deepEqual(orphanedImages([A, B], [span(1), span(2)]), []);
  assert.deepEqual(orphanedImages([LOOSE, NOTES], []), []);
});

test("sending renumbers labels from the session's count, in text order", () => {
  const sent = numberForSend("compare [Image #2] with [Image #1]", [A, B], 5);
  assert.equal(sent.text, "compare [Image #6] with [Image #7]");
  assert.deepEqual(sent.files, [B, A]);
});

test("a repeated label keeps one number", () => {
  assert.equal(numberForSend("[Image #1] and again [Image #1]", [A], 0).text, "[Image #1] and again [Image #1]");
});

test("a label with no attachment stays as typed", () => {
  assert.equal(numberForSend("see [Image #9] and [Image #1]", [A], 3).text, "see [Image #9] and [Image #4]");
});

test("images without labels and other files follow the labelled images", () => {
  assert.deepEqual(numberForSend("[Image #1]", [NOTES, LOOSE, A], 0).files, [A, LOOSE, NOTES]);
});

test("only labels at the start are the CLI's own marker", () => {
  assert.equal(withoutLeadingLabels("[Image #3][Image #3] look at this"), "look at this");
  assert.equal(withoutLeadingLabels("[Image #3]what is in [Image #3]?"), "what is in [Image #3]?");
  assert.equal(withoutLeadingLabels(""), "");
});
