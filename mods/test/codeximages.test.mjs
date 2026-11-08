import test from "node:test";
import assert from "node:assert/strict";
import { Conversation, records } from "../hws-chat/core/chat-log.js";

function userRow(content) {
  const kinds = content.map(() => "user.text");
  const line = JSON.stringify({
    type: "response_item",
    timestamp: "2026-11-08T10:00:00Z",
    payload: { type: "message", role: "user", content, internal_chat_message_metadata_passthrough: { content_item_kinds: kinds } },
  });
  const conv = new Conversation("codex");
  conv.feed(records(`P 0 100\n1\tJ\t${line}\n`).records);
  return conv.items.find((item) => item.kind === "user");
}

const text = (t) => ({ type: "input_text", text: t });
const image = { type: "input_image", image_url: "" };

test("an image pasted into Codex shows under its words", () => {
  const row = userRow([text('<image name=[Image #1] path="/Users/me/Library/CleanShot/Shot 1@2x.png">'), image, text("</image>"), text("[Image #1]  can you see this?")]);
  assert.equal(row.text, "can you see this?");
  assert.equal(row.images, 1);
  assert.deepEqual(row.paths, ["/Users/me/Library/CleanShot/Shot 1@2x.png"]);
});

test("an image sent from the chat loses its path line and keeps a mid-sentence label", () => {
  const row = userRow([text("what app is in [Image #1]?\n\n/tmp/shot.png")]);
  assert.equal(row.text, "what app is in [Image #1]?");
  assert.equal(row.images, 1);
  assert.deepEqual(row.paths, ["/tmp/shot.png"]);
});

test("a message with only an image still shows", () => {
  const row = userRow([text('<image name=[Image #1] path="/tmp/a.png">'), image, text("</image>"), text("[Image #1]")]);
  assert.equal(row.text, "");
  assert.deepEqual(row.paths, ["/tmp/a.png"]);
});

test("plain words stay as they are", () => {
  const row = userRow([text("look at /tmp/a.png please")]);
  assert.equal(row.text, "look at /tmp/a.png please");
  assert.equal(row.images, 0);
});
