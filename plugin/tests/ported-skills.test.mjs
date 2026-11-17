import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..");
const RENDERER = join(PLUGIN, "bin", "wireframe-render.mjs");
const PORTED = ["wireframe", "sketch-board", "outline-first", "behavior-review", "feedback-items"];

const read = (name) => readFileSync(join(PLUGIN, "skills", name, "SKILL.md"), "utf8");

function frontmatter(text) {
  const block = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(block, "SKILL.md has no frontmatter");

  return Object.fromEntries(
    block[1].split("\n").map((line) => {
      const colon = line.indexOf(":");
      return [line.slice(0, colon), line.slice(colon + 1).trim()];
    }),
  );
}

describe("ported skills", () => {
  for (const name of PORTED) {
    const skill = read(name);

    it(`${name} has frontmatter with its name and a trigger`, () => {
      const meta = frontmatter(skill);

      assert.equal(meta.name, name);
      assert.match(meta.description, /should be used when/);
    });

    it(`${name} names no Agent Brief tool, app or command`, () => {
      for (const gone of ["Agent Brief", "agent-brief ", "show_image", "declare_output", "ask_questions", "COMPANION_SOCKET", "/Applications/"]) {
        assert.ok(!skill.includes(gone), `${name} mentions ${gone}`);
      }
    });
  }

  it("drives surfaces through hws surface cli", () => {
    for (const name of ["sketch-board", "outline-first", "behavior-review", "feedback-items"]) {
      assert.match(read(name), /hws surface cli (--type (board|page) )?-- /, name);
    }
  });

  it("declares finished outputs with hws output add", () => {
    for (const name of ["outline-first", "behavior-review", "feedback-items"]) {
      assert.match(read(name), /hws output add --title "[^"]+" --path \S+ --status ready/, name);
    }
  });

  it("points the wireframe skill at the bundled renderer", () => {
    const skill = read("wireframe");

    assert.ok(skill.includes("node ${CLAUDE_PLUGIN_ROOT}/bin/wireframe-render.mjs"));
    assert.ok(skill.includes("hws review"));
  });

  it("renders the wireframe skill's example block", () => {
    const block = read("wireframe").match(/```wireframe\n([\s\S]*?)```/)[1];
    const dir = mkdtempSync(join(tmpdir(), "wireframe-"));

    try {
      writeFileSync(join(dir, "example.wireframe"), block);
      const result = spawnSync(process.execPath, [RENDERER, "--in", join(dir, "example.wireframe"), "--out", join(dir, "example.svg"), "--strict"], { encoding: "utf8" });

      assert.equal(result.status, 0, result.stderr);
      assert.match(readFileSync(join(dir, "example.svg"), "utf8"), /^<svg /);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("herdr-workspace skill", () => {
  const skill = read("herdr-workspace");

  it("drops Agent Brief's tools and socket recipe", () => {
    for (const gone of ["Agent Brief", "declare_output", "COMPANION_SOCKET", "agent-brief:"]) {
      assert.ok(!skill.includes(gone), gone);
    }
  });

  it("teaches the commands that replace them", () => {
    for (const text of ["hws surface cli -- VERB", "hws output add", "--status drafting", "--status ready", "hws ask", "hws surface resume --id S", "hws review ARTIFACT"]) {
      assert.ok(skill.includes(text), text);
    }
  });

  it("separates review from a note", () => {
    assert.ok(skill.includes("Use `hws review` when you want comments back on your own work. Use a note when the file is the person's to read or change."));
  });
});
