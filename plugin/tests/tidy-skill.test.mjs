import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(PLUGIN, "..");

const skill = readFileSync(join(PLUGIN, "skills", "tidy", "SKILL.md"), "utf8");
const workspaceSkill = readFileSync(join(PLUGIN, "skills", "herdr-workspace", "SKILL.md"), "utf8");
const design = readFileSync(join(REPO, "docs", "CONTRACT.md"), "utf8");

const CITES = ["[card:ID]", "[session:ID]", "[commit:SHA]", "[artifact:ID]", "[file:PATH]"];

function frontmatter() {
  const block = skill.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(block, "SKILL.md has no frontmatter");

  return Object.fromEntries(
    block[1].split("\n").map((line) => {
      const colon = line.indexOf(":");
      return [line.slice(0, colon), line.slice(colon + 1).trim()];
    }),
  );
}

describe("tidy skill", () => {
  it("has valid frontmatter", () => {
    const { name, description } = frontmatter();

    assert.equal(name, "tidy");
    assert.match(description, /herdr-workspaces:tidy/);
  });

  it("finds the packet and writes the proposal beside it", () => {
    for (const text of ["tidy/packet.json", "proposal.json", "proposal.md", "`cutoff`"]) {
      assert.ok(skill.includes(text), text);
    }
  });

  it("names the five headings in order and every cite", () => {
    const order = ["## Goal", "## Now", "## Decisions in force", "## Open questions", "## Next"].map((heading) => skill.indexOf(heading));

    assert.ok(order.every((index) => index > 0), "missing a heading");
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    for (const cite of CITES) assert.ok(skill.includes(cite), cite);
  });

  it("rewrites the note and never appends", () => {
    assert.match(skill, /Rewrite the whole note\. Never append/);
  });

  it("keeps history as the default and the note free of the past", () => {
    assert.match(skill, /`history`, which is the default place for anything outdated/);
    assert.match(skill, /Never write "previously"/);
  });

  it("asks before proposing, and only what the evidence does not settle", () => {
    assert.ok(skill.indexOf("Ask what is unclear") < skill.indexOf("## Write the proposal"));
    assert.match(skill, /AskUserQuestion/);
    assert.match(skill, /Ask at most four questions/);
  });

  it("keeps exploring out of the decision log", () => {
    assert.match(skill, /Exploring is not deciding/);
    assert.match(skill, /A draft artifact \| Open questions, never Now/);
    assert.match(skill, /`decidedAt`.*source's own timestamp/);
  });

  it("opens the page, ends the turn and applies on Done", () => {
    assert.ok(skill.includes("hws surface open --type page --file <packet folder>/proposal.md --terminal $HC_TERMINAL_ID"));
    assert.ok(skill.includes("hws tidy apply --file <packet folder>/proposal.json"));
    assert.ok(skill.includes("I reviewed proposal.md in Agent Brief and changed nothing"));
    assert.ok(skill.includes("My edited copy of proposal.md"));
    assert.match(skill, /end the turn/);
  });

  it("names only tidy verbs and skip parts the design defines", () => {
    for (const [, verb] of skill.matchAll(/hws tidy ([a-z]+)/g)) {
      assert.ok(design.includes(`hws tidy ${verb}`), `hws tidy ${verb} is not in the design`);
    }
    assert.ok(design.includes("--skip current,decisions,demote,artifacts,cards"));
  });
});

describe("herdr-workspace skill places", () => {
  it("lists every role and the place command", () => {
    for (const role of ["current", "artifacts", "scratch", "decisions", "history", "meetings"]) {
      assert.ok(workspaceSkill.includes(`| \`${role}\` |`), role);
    }
    assert.ok(workspaceSkill.includes("hws place ROLE"));
  });

  it("allows one dated decision line and leaves the rewrite to the tidy pass", () => {
    assert.match(workspaceSkill, /one dated line with a cite under Decisions in force/);
    assert.match(workspaceSkill, /log nothing without their yes/);
    assert.ok(workspaceSkill.includes("hws decision add"));
    assert.match(workspaceSkill, /tidy pass rewrites the whole note/);
    for (const cite of CITES) assert.ok(workspaceSkill.includes(cite), cite);
  });
});
