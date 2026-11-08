import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAC_CLIPBOARD, parseMacClipboard, insertedRange, isImageNames, namesMatch, imagePaths } from "../hws-chat/clipboard.js";

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const onMac = process.platform === "darwin";

function osa(script, ...args) {
  return execFileSync("osascript", ["-l", "JavaScript", "-e", script, ...args], { encoding: "utf8" }).trim();
}

// Fills a private pasteboard, so the person's clipboard stays untouched.
function fill(board, body) {
  osa(`ObjC.import("AppKit");
    function run() {
      const pb = $.NSPasteboard.pasteboardWithName(${JSON.stringify(board)});
      pb.clearContents;
      ${body}
      return "";
    }`);
}

const pngData = `$.NSData.alloc.initWithBase64EncodedStringOptions($(${JSON.stringify(TINY_PNG)}), 0)`;

test("parses copied files and pasted images", () => {
  assert.deepEqual(parseMacClipboard("file\t/a b.png\nfile\t/c.png\n"), { files: ["/a b.png", "/c.png"] });
  assert.deepEqual(parseMacClipboard("image\t/x/p.png"), { image: "/x/p.png" });
  assert.equal(parseMacClipboard(""), null);
});

test("finds what a paste inserted", () => {
  assert.deepEqual(insertedRange("ab", "aXYb"), { start: 1, end: 3, text: "XY" });
  assert.deepEqual(insertedRange("", "shot.png"), { start: 0, end: 8, text: "shot.png" });
});

test("recognises Finder's pasted names", () => {
  assert.equal(isImageNames("CleanShot 2026-11-08 at 2.18.15 AM@2x.png"), true);
  assert.equal(isImageNames("a.png\nb.jpg"), true);
  assert.equal(isImageNames("look at a.png please"), false);
  assert.equal(isImageNames(""), false);
  assert.equal(namesMatch("a.png\nb.jpg", [{ name: "b.jpg" }, { name: "a.png" }]), true);
  assert.equal(namesMatch("a.png", [{ name: "b.png" }]), false);
});

test("recognises a copied image as a path or a file URL", () => {
  const path = "/Users/me/Library/Application Support/CleanShot/media/CleanShot 2026-11-08 at 2.28.05 AM@2x.png";
  assert.deepEqual(imagePaths(path), [path]);
  assert.deepEqual(imagePaths(`file://${path.replaceAll(" ", "%20")}`), [path]);
  assert.deepEqual(imagePaths(`'${path}'`), [path]);
  assert.deepEqual(imagePaths(path.replaceAll(" ", "\\ ")), [path]);
  assert.deepEqual(imagePaths("/a.png\n/b.jpg"), ["/a.png", "/b.jpg"]);
  assert.equal(imagePaths("see /a.png"), null);
  assert.equal(imagePaths("/a/notes.txt"), null);
  assert.equal(imagePaths("https://example.com/a.png"), null);
  assert.equal(imagePaths(""), null);
});

test("reads a PNG, a TIFF, copied files and an empty pasteboard", { skip: !onMac }, () => {
  const dir = mkdtempSync(join(tmpdir(), "hws-clip-"));
  const board = `hws.test.${process.pid}`;
  const out = join(dir, "out.png");
  try {
    fill(board, `pb.setDataForType(${pngData}, $.NSPasteboardTypePNG);`);
    assert.equal(osa(MAC_CLIPBOARD, out, board), `image\t${out}`);
    assert.deepEqual([...readFileSync(out).subarray(0, 4)], PNG_MAGIC);
    rmSync(out);

    fill(board, `const rep = $.NSBitmapImageRep.imageRepWithData(${pngData});
      pb.setDataForType(rep.TIFFRepresentation, $.NSPasteboardTypeTIFF);`);
    assert.equal(osa(MAC_CLIPBOARD, out, board), `image\t${out}`);
    assert.deepEqual([...readFileSync(out).subarray(0, 4)], PNG_MAGIC);

    const copied = join(dir, "Screen Shot @2x.png");
    writeFileSync(copied, Buffer.from(TINY_PNG, "base64"));
    fill(board, `pb.writeObjects($.NSArray.arrayWithObject($.NSURL.fileURLWithPath($(${JSON.stringify(copied)}))));`);
    assert.equal(osa(MAC_CLIPBOARD, out, board), `file\t${copied}`);

    fill(board, "");
    assert.equal(osa(MAC_CLIPBOARD, out, board), "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
