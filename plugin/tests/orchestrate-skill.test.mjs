import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(PLUGIN, "..");

const skill = readFileSync(join(PLUGIN, "skills", "orchestrate", "SKILL.md"), "utf8");
const worker = readFileSync(join(REPO, "core", "worker-prompt.js"), "utf8");
const contract = readFileSync(join(REPO, "docs", "CONTRACT.md"), "utf8");
const cli = readFileSync(join(REPO, "core", "cli.js"), "utf8");

function captures(text, pattern) {
  return new Set([...text.matchAll(pattern)].map((match) => match[1]));
}

const verbs = captures(skill, /hws todo ([a-z]+)/g);
const documented = captures(contract, /^\| `hws todo ([a-z]+)/gm);
const routed = captures(cli, /path: \['todo', '([a-z]+)'\]/g);

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

describe("orchestrate skill", () => {
  it("has valid frontmatter", () => {
    const { name, description } = frontmatter();

    assert.equal(name, "orchestrate");
    assert.match(description, /herdr-workspaces:orchestrate/);
    assert.match(description, /orchestrate the to-do board/);
  });

  it("names the verbs a worker and the orchestrator need", () => {
    for (const verb of ["list", "status", "start", "note", "move"]) {
      assert.ok(verbs.has(verb), `missing hws todo ${verb}`);
    }
  });

  it("names only verbs the contract lists", () => {
    for (const verb of verbs) assert.ok(documented.has(verb), `hws todo ${verb} is not in the contract`);
  });

  // The claim route marks the point where core/cli.js carries the orchestrator verbs.
  it("names only verbs the CLI routes", { skip: !routed.has("claim") && "core/cli.js has no claim route" }, () => {
    for (const verb of verbs) assert.ok(routed.has(verb), `hws todo ${verb} is not routed`);
  });

  it("starts workers with the agreed command", () => {
    assert.ok(skill.includes('hws todo start --ids <id,id> --space <space> --folder <dir>'));
  });

  it("has workers report to the orchestrator", () => {
    assert.ok(worker.includes('todo ${items[0].id}: waiting on the person'));
    assert.ok(worker.includes("closes this session"));
  });
});
