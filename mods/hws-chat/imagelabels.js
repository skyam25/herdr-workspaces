// The [Image #N] labels in the chat box. Numbers count up within one message, and the send step
// renumbers them to match the CLI's own numbers.

const LABEL = /\[Image #(\d+)\]/g;
const LEADING_LABELS = /^(?:\[Image #\d+\]\s*)+/;

export const imageLabel = (n) => `[Image #${n}]`;
export const imageToken = (n) => ({ id: `image-${n}`, text: imageLabel(n) });
export const nextImageNumber = (files) => 1 + Math.max(0, ...files.map((f) => f.label ?? 0));

// The CLI puts its own marker first, so the log's text starts with labels the person didn't write.
export const withoutLeadingLabels = (text) => String(text ?? "").replace(LEADING_LABELS, "");

// Files whose label the person deleted from the box.
export function orphanedImages(files, tokens) {
  const ids = new Set(tokens.map((span) => span.token.id));
  return files.filter((f) => f.label && !ids.has(imageToken(f.label).id));
}

// Numbers labels from base + 1 in text order, and sorts the files the same way, because the CLI
// numbers images in the order of their paths. -> { text, files }.
export function numberForSend(text, files, base) {
  const byLabel = new Map(files.filter((f) => f.label).map((f) => [f.label, f]));
  const numbers = new Map();
  const numbered = String(text ?? "").replace(LABEL, (whole, n) => {
    const file = byLabel.get(Number(n));
    if (!file) return whole;
    if (!numbers.has(file)) numbers.set(file, base + numbers.size + 1);
    return imageLabel(numbers.get(file));
  });
  const inOrder = [...numbers.keys()];
  const otherImages = files.filter((f) => f.image && !numbers.has(f));
  const notImages = files.filter((f) => !f.image);
  return { text: numbered, files: [...inOrder, ...otherImages, ...notImages] };
}
