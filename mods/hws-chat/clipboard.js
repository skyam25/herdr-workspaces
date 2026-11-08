// Clipboard helpers with no Herdr imports, so tests can run them directly.

const IMAGE_NAME = /\.(png|jpe?g|gif|webp|bmp|tiff?|heic)$/i;

// JXA for `osascript -l JavaScript -e SCRIPT <path for an image> [pasteboard]`.
// Prints "file\t<path>" per copied file, else "image\t<path>" after saving the image as PNG.
export const MAC_CLIPBOARD = `
ObjC.import("AppKit");
function run(argv) {
  const pb = argv[1] ? $.NSPasteboard.pasteboardWithName(argv[1]) : $.NSPasteboard.generalPasteboard;
  const only = $.NSDictionary.dictionaryWithObjectForKey($.NSNumber.numberWithBool(true), $.NSPasteboardURLReadingFileURLsOnlyKey);
  const urls = pb.readObjectsForClassesOptions($.NSArray.arrayWithObject($.NSURL), only);
  if (urls && !urls.isNil() && urls.count > 0) {
    const out = [];
    for (let i = 0; i < urls.count; i++) out.push("file\\t" + urls.objectAtIndex(i).path.js);
    return out.join("\\n");
  }
  let data = pb.dataForType($.NSPasteboardTypePNG);
  if (data.isNil()) {
    const tiff = pb.dataForType($.NSPasteboardTypeTIFF);
    if (tiff.isNil()) return "";
    const PNG = 4;
    data = $.NSBitmapImageRep.imageRepWithData(tiff).representationUsingTypeProperties(PNG, $.NSDictionary.dictionary);
  }
  return data.writeToFileAtomically(argv[0], true) ? "image\\t" + argv[0] : "";
}`;

// -> { files: [paths] } or { image: path } or null.
export function parseMacClipboard(stdout) {
  const rows = String(stdout ?? "").split("\n").filter(Boolean).map((line) => line.split("\t"));
  const files = rows.filter(([kind]) => kind === "file").map(([, path]) => path);
  if (files.length) return { files };
  const image = rows.find(([kind]) => kind === "image");
  return image ? { image: image[1] } : null;
}

// What an edit inserted, given the box's text before and after.
export function insertedText(was, now) {
  let start = 0;
  while (start < was.length && was[start] === now[start]) start++;
  let end = 0;
  while (end < was.length - start && was[was.length - 1 - end] === now[now.length - 1 - end]) end++;
  return now.slice(start, now.length - end);
}

const nameLines = (text) => String(text).split("\n").map((line) => line.trim()).filter(Boolean);

// Finder pastes a copied file's name as text. Only text shaped like that is worth checking.
export const isImageNames = (text) => nameLines(text).length > 0 && nameLines(text).every((line) => IMAGE_NAME.test(line));

export function namesMatch(text, files) {
  const names = nameLines(text);
  return names.length === files.length && names.every((name) => files.some((file) => file.name === name));
}
