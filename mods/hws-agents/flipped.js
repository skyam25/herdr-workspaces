// Finds agents flipped to Chat. They have no pane, so agents() leaves them out.
// hws-tabs and hws-agents hold identical copies, and a test compares them.

const CHAT = "herdr.chat";
const SEEN = "herdr.seen";
const PINNED = "herdr.pinned";
const STATUSES = new Set(["working", "blocked", "done", "idle"]);

// A label on another machine holds that machine's local pane id.
function chatPane(terminal) {
  const label = terminal.labels?.[CHAT];
  if (!label || label.includes("/") || !terminal.address.includes("/")) return label;
  return `${terminal.address.split("/")[0]}/${label}`;
}

// terminals() gives a plain word and `hc` records give { state, app, msg }.
function statusOf(terminal) {
  const word = terminal.status?.state ?? terminal.status;
  if (word === "error") return "blocked";
  return STATUSES.has(word) ? word : "idle";
}

export class Flipped {
  constructor() {
    this.looked = JSON.parse(localStorage.getItem("flipped-looked") ?? "{}");
  }

  // Each flipped agent in the shape agents() returns, plus `flipped` and `terminal`.
  list(paneList, terminalList, spaceList, focus) {
    const owned = new Set(paneList.map((p) => p.terminal).filter(Boolean));
    const flips = [];

    for (const pane of paneList) {
      if (pane.mod !== "hws-chat") continue;
      const terminal = terminalList.find((k) => k.state === "live" && !owned.has(k.address) && chatPane(k) === pane.pane);
      const space = spaceList.find((s) => s.tabs.some((x) => x.id === pane.tab));
      if (!terminal || !space) continue;

      const tab = space.tabs.find((x) => x.id === pane.tab);
      flips.push({
        address: terminal.address,
        terminal: terminal.address,
        pane: pane.pane,
        flipped: true,
        space: space.id,
        space_name: space.name ?? "",
        tab: pane.tab,
        tab_index: tab.index ?? 0,
        tab_name: tab.name ?? "",
        status: statusOf(terminal),
        app: terminal.report?.app ?? terminal.status?.app ?? null,
        program: terminal.program,
        title: terminal.title || pane.title || "",
        seq: terminal.status_ms ?? 0,
        pinned: Boolean(terminal.labels?.[PINNED]),
        focused: focus?.pane === pane.pane,
        turn: terminal.turn ?? 0,
        seen: Number(terminal.labels?.[SEEN] ?? -1),
      });
    }

    this.settle(flips);
    return flips;
  }

  // Done turns idle once the person has looked at the chat, as agents() does for a pane.
  settle(flips) {
    let changed = false;

    for (const f of flips) {
      if (f.status !== "done") continue;
      if (f.focused && (this.looked[f.address] ?? -1) < f.turn) {
        this.looked[f.address] = f.turn;
        changed = true;
      }
      if (f.seen >= f.turn || (this.looked[f.address] ?? -1) >= f.turn) f.status = "idle";
    }

    if (!changed) return;
    const live = new Set(flips.map((f) => f.address));
    for (const address of Object.keys(this.looked)) if (!live.has(address)) delete this.looked[address];
    localStorage.setItem("flipped-looked", JSON.stringify(this.looked));
  }
}
