// Works out a telling title for a tab from the program in front of it.
// hws-agents and hws-tabs hold identical copies, and a test compares them.

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

// The pane that speaks for each tab. Entries need `terminal`, `tab`, `program`, `title` and `focused`.
export function leadPanes(all) {
  const leads = new Map();
  for (const p of all) {
    if (!p.terminal) continue;
    const current = leads.get(p.tab);
    // First agent, else first focused terminal, else first terminal in the tab.
    if (!current || (!current.program?.agent && (p.program?.agent || (!current.focused && p.focused)))) leads.set(p.tab, p);
  }
  return leads;
}

// A tab nobody named, or one named after its program, reads its lead's own title.
// A title that is a path, a user@host prompt or the program's name says nothing, so the tab keeps its name.
export function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  const telling = live && live !== prog && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}
