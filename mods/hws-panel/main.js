// The current workspace: what it is, who is working, what is open and what it made.
// One copy runs per use. A pane shows the panel, a dialog copy shows the close
// decision or Promote, a `mod.open` copy toggles the pane and closes itself, and
// a layout block with `view: "sidebar"` shows the Workspaces section.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, panes, spaces, focused, props, exec, hc, theme, run, openOverlay, closeOverlay, readTextFile, shared, watchFolder } from "herdr";
import { hws, message, submitDialog, openWorkspaceForm, KINDS, checkFolder, fillParent, makeInput, focusField, formKeys, dialogRoot, dialogFooter, labeled, field, areaField, button, folderRow, problemLine, tilde } from "./hws.js";
import { startSidebar, drawSidebar } from "./sidebar.js";
import { ROLES, ROLE_DEFAULTS, SUGGEST_PROMPT, noteLines, placeRows, resolvePath, validStatus } from "./context.js";
import { copy, openCite, openPath } from "./cites.js";
import { artifactsSection, currentSection, headerSection, placesSection, recordSection, sectionTitle, sinceSection } from "./sections.js";

const MOD = "hws-panel";
const REFRESH_MS = 20000;
const INSTRUCTIONS_HINT = "How agents should work and organize context here.";

const STATUS_WORD = { working: "Working", blocked: "Needs you", done: "Done", idle: "Idle" };

const openDialog = (width, height, dialogProps) => openOverlay({ mod: MOD, kind: "dialog", modal: true, width, height, props: dialogProps });

export default class Panel extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.view = p.view ?? (p.overlay ? "toggle" : "panel");
    this.busy = null;
    this.problem = null;
    this.handle = cx.focus_handle();
    this.values = {};
    this.inputs = {};
    this.focusedField = null;

    if (this.view === "toggle") {
      cx.spawn(async () => this.toggle());
    } else if (this.view === "sidebar") {
      this.sidebar = startSidebar(cx);
    } else if (this.view === "promote") {
      const submit = (cx) => this.promote(cx);
      makeInput(this, "name", { value: p.name ?? "", placeholder: "Untitled workspace", submit });
      makeInput(this, "folder", { submit });
      fillParent(this, cx);
      focusField(this, "name", cx);
    } else if (this.view === "add-space") {
      makeInput(this, "name", { placeholder: "Space name", submit: (cx) => this.addSpace(cx) });
      focusField(this, "name", cx);
    } else if (this.view === "instructions") {
      makeInput(this, "instructions", { rows: 9, value: p.instructions ?? "", placeholder: INSTRUCTIONS_HINT });
      focusField(this, "instructions", cx);
    } else if (this.view === "decide") {
      this.handle.focus();
    } else {
      this.manifests = null;
      this.spaceId = focused()?.space ?? null;
      this.lastAgent = new Map(p.terminal && this.spaceId ? [[this.spaceId, p.terminal]] : []);
      this.isConfirmingClose = false;
      this.note = null;
      this.context = null;
      this.showSuperseded = false;
      this.showAllBacklog = false;

      // GPUI creates input state only outside render, so each role's input is made once here.
      this.placeSaved = Object.fromEntries(ROLES.map((role) => [role, ""]));
      for (const role of ROLES) makeInput(this, `place-${role}`, { placeholder: ROLE_DEFAULTS[role], submit: (cx) => this.savePlace(this.placesFor, role, cx) });
      this.placesFor = null;
      this.watching = new Set();
      this.refresh(cx);
      cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx));
    }
  }

  // Runs from `mod.open:hws-panel`. Closes the tab's panel, or opens one beside the terminal.
  toggle() {
    const f = focused();
    const seated = panes().find((p) => p.mod === MOD && p.tab === f?.tab);
    closeOverlay(props().overlay);
    if (seated) {
      run("pane.close", { pane: seated.pane });
      return;
    }
    const anchor = f?.pane ?? panes().find((p) => p.tab === f?.tab && p.terminal)?.pane;
    if (!anchor) return;
    run("pane.split", { direction: "right", pane: anchor, mod: MOD, props: f?.terminal ? { terminal: f.terminal } : {} });
    if (f?.terminal) run("pane.focus", { terminal: f.terminal });
  }

  refresh(cx) {
    if (this.fetching) {
      this.fetchAgain = true;
      return;
    }
    this.fetching = true;
    cx.spawn(async (cx) => {
      try {
        this.manifests = await hws(["list"]);
        this.problem = null;

        // The list paints first, so slow context calls cannot hold up the panel.
        cx.notify();
        const workspace = this.manifests.find((m) => m.spaces.includes(this.spaceId));
        this.context = await this.loadContext(workspace);
        if (workspace && workspace.kind !== "throwaway") this.syncPlaces(workspace);
      } catch (e) {
        this.problem = message(e);
      }
      this.fetching = false;
      if (this.fetchAgain) {
        this.fetchAgain = false;
        this.refresh(cx);
      }
      cx.notify();
    });
  }

  // What the context sections read. A kept workspace reads `hws tidy status`,
  // which carries the `--line` sentence and every resolved place, then the
  // current note. A throwaway reads its scratch folder, which a reopen records
  // in `places` because `folder` then names the recreated empty folder.
  async loadContext(workspace) {
    if (!workspace) return null;
    if (workspace.kind === "throwaway") {
      const { path } = placeRows(workspace).find((row) => row.role === "scratch");
      const scratch = path ? resolvePath(path, workspace.folder) : workspace.folder;
      const found = await exec("test", ["-d", scratch]).catch(() => null);
      return { workspaceId: workspace.id, scratch, scratchExists: found?.code === 0 };
    }
    let status = null;
    let statusProblem = null;
    try {
      status = validStatus(await hws(["tidy", "status", "--workspace", workspace.id]));
    } catch (e) {
      statusProblem = message(e);
    }

    // `hws place current` creates nothing, so it can stand in when status fails.
    const fallback = status ? null : await hws(["place", "current", "--workspace", workspace.id]).catch(() => null);
    const currentPath = status?.places?.current ?? fallback?.path ?? null;
    const text = currentPath ? await readTextFile(currentPath).catch(() => null) : null;
    return {
      workspaceId: workspace.id,
      status,
      statusProblem,
      line: typeof status?.line === "string" ? status.line : "",
      currentPath,
      current: typeof text === "string" ? noteLines(text) : null,
    };
  }

  // Reloads when this workspace's manifest changes. Surfaces write constantly
  // under the same folder, so other paths are ignored. A missing folder ends
  // the watch, and the next render arms it again.
  watch(dir, cx) {
    this.watchDir = dir;
    if (this.watching.has(dir)) return;
    this.watching.add(dir);
    cx.spawn(async (cx) => {
      try {
        while (this.watchDir === dir) {
          const changed = await watchFolder(dir);
          if (this.watchDir === dir && changed.some((p) => p === dir || p.endsWith("/workspace.json"))) this.refresh(cx);
        }
      } catch {
        // The timer keeps the panel current without a watch.
      }
      this.watching.delete(dir);
    });
  }

  // Runs one action at a time. `work` may return a note to show when it finishes.
  act(key, work, cx) {
    if (this.busy) return;
    this.busy = key;
    this.note = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const text = await work(cx);
        this.note = text ? { text, isError: false } : null;
      } catch (e) {
        this.note = { text: message(e), isError: true };
      }
      this.busy = null;
      cx.notify();
    });
  }

  // The agent a new surface attaches to. The panel takes focus when clicked,
  // so the last agent focused in this space stands in for the focused one.
  trackAgent(spaceId) {
    const f = focused();
    const inSpace = agents().filter((a) => a.space === spaceId);
    const now = inSpace.find((a) => a.focused) ?? inSpace.find((a) => a.address === f?.terminal);
    if (now) this.lastAgent.set(spaceId, now.address);
    return inSpace.find((a) => a.address === this.lastAgent.get(spaceId)) ?? null;
  }

  openSurface(type, target, cx) {
    this.act(`surface-${type}`, async (cx) => {
      await hws(["surface", "open", "--type", type, "--terminal", target.address]);
      this.refresh(cx);
    }, cx);
  }

  citeAction(cite, workspace, cx) {
    this.act(`cite-${cite.kind}-${cite.value}`, () => openCite(cite, { workspace, target: this.trackAgent(workspace.id), space: this.spaceId }), cx);
  }

  openCurrent(target, cx) {
    const file = this.context?.currentPath;
    if (!target || !file) return;
    this.act("open-current", async (cx) => {
      await hws(["surface", "open", "--type", "note", "--file", file, "--terminal", target.address]);
      this.refresh(cx);
    }, cx);
  }

  // With a pass already live, hws asks it to read the packet again.
  startTidy(workspace, cx) {
    this.act("tidy", async (cx) => {
      const { terminal, started } = (await hws(["tidy", "start", "--workspace", workspace.id])) ?? {};
      this.refresh(cx);
      const where = terminal ? ` in ${terminal}` : "";
      return started === false ? `Asked the tidy pass${where} to read the packet again.` : `Tidy started${where}.`;
    }, cx);
  }

  // Fills the fields from the manifest. Another workspace replaces every field.
  // A value saved elsewhere replaces a field unless it holds an unsaved edit.
  syncPlaces(workspace) {
    const isNew = this.placesFor !== workspace.id;
    this.placesFor = workspace.id;
    for (const row of placeRows(workspace)) {
      const key = `place-${row.role}`;
      const saved = this.placeSaved[row.role];
      if (isNew || (saved !== row.path && this.values[key] === saved)) {
        this.inputs[key].set_value(row.path);
        this.values[key] = row.path;
      }
      this.placeSaved[row.role] = row.path;
    }
  }

  // An empty field drops the role from the manifest, so it falls back to its default.
  savePlace(workspaceId, role, cx) {
    const key = `place-${role}`;
    const path = this.values[key].trim();
    if (!workspaceId || path === this.placeSaved[role]) return;
    this.act(key, async (cx) => {
      await hws(["set", "--workspace", workspaceId, "--place", `${role}=${path}`]);
      this.placeSaved[role] = path;
      this.values[key] = path;
      this.refresh(cx);
      return path ? `Saved the ${role} place.` : `Cleared the ${role} place.`;
    }, cx);
  }

  suggestPlaces(target, cx) {
    if (!target) return;
    this.act("suggest-places", async () => {
      const r = await hc(["send", target.address, SUGGEST_PROMPT]);
      if (r.code !== 0) throw new Error(r.stderr.trim() || `Could not send to ${target.address}.`);
      return `Asked ${target.address} to propose places.`;
    }, cx);
  }

  artifactTerminal(artifact) {
    return hws(["artifact", "terminal", artifact.id]).then(() => null);
  }

  copyLink(artifact, cx) {
    this.act(`link-${artifact.id}`, async () => {
      const { link } = await hws(["link", artifact.id]);
      await copy(link);
      return "Link copied.";
    }, cx);
  }

  openFolder(artifact, cx) {
    this.act(`folder-${artifact.id}`, () => openPath(artifact.path, null), cx);
  }

  closeWorkspace(workspace, cx) {
    this.isConfirmingClose = false;
    this.act("close", async (cx) => {
      const answer = await hws(["close", "--workspace", workspace.id]);
      if (answer?.decision === "needed") {
        openDialog(460, 400, { view: "decide", workspace: workspace.id, name: workspace.name, artifacts: answer.artifacts ?? [], scratch: answer.scratch ?? null });
      } else {
        this.refresh(cx);
      }
    }, cx);
  }

  openPromote(workspace) {
    openDialog(460, 270, { view: "promote", workspace: workspace.id, name: workspace.name });
  }

  openInstructions(workspace) {
    openDialog(520, 340, { view: "instructions", workspace: workspace.id, instructions: workspace.instructions ?? "" });
  }

  // Runs in the instructions dialog.
  saveInstructions(cx) {
    submitDialog(this, "instructions", () => hws(["set", "--workspace", props().workspace, "--instructions", this.values.instructions.trim()]), cx);
  }

  renderInstructions(t) {
    return dialogRoot(t, "hws-instructions")
      .child(
        v_flex()
          .flex_1()
          .min_h(0)
          .p(18)
          .gap(12)
          .child(div().text_size(15).font_semibold().child("Workspace instructions"))
          .child(div().text_size(11.5).text_color(t.dim).child("Agents read these when a session starts in this workspace."))
          .child(areaField(t, this, "instructions"))
          .when(Boolean(this.problem), (el) => el.child(problemLine(t, this.problem))),
      )
      .child(
        dialogFooter()
          .child(button(t, "cancel", "Cancel", false, () => closeOverlay(props().overlay)))
          .child(button(t, "save-instructions", this.busy ? "Saving…" : "Save", true, (_e, cx) => this.saveInstructions(cx), !this.busy)),
      );
  }

  setKind(workspace, kind, cx) {
    if (kind === workspace.kind) return;
    cx.spawn(async (cx) => {
      try {
        await hws(["set", "--workspace", workspace.id, "--kind", kind]);
        this.refresh(cx);
      } catch (e) {
        this.note = { text: message(e), isError: true };
        cx.notify();
      }
    });
  }

  kindSetting(t, workspace) {
    return h_flex()
      .pt(6)
      .gap(4)
      .items_center()
      .children(
        KINDS.map((k) =>
          h_flex()
            .id(`kind-${k.id}`)
            .flex_none()
            .h(20)
            .px(6)
            .items_center()
            .rounded(5)
            .border_1()
            .border_color(k.id === workspace.kind ? t.accent : t.border)
            .text_size(11)
            .text_color(k.id === workspace.kind ? t.foreground : t.muted)
            .cursor_pointer()
            .hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => this.setKind(workspace, k.id, cx))
            .child(k.name),
        ),
      )
      .child(div().pl(4).truncate().text_size(11).text_color(t.dim).child("Tells agents what kind of work this is."));
  }

  // Runs in the decide dialog.
  decide(flag, cx) {
    submitDialog(this, flag, () => hws(["close", "--workspace", props().workspace, `--${flag}`]), cx);
  }

  // Runs in the Promote dialog.
  promote(cx) {
    submitDialog(this, "promote", async () => {
      const path = await checkFolder(this.values.folder);
      await hws(["promote", "--workspace", props().workspace, "--name", this.values.name.trim() || "Untitled workspace", "--folder", path]);
    }, cx);
  }

  // Runs in the Add space dialog.
  addSpace(cx) {
    const name = this.values.name.trim();
    submitDialog(this, "add", async () => {
      await hws(["space", "add", "--workspace", props().workspace, ...(name ? ["--name", name] : [])]);
    }, cx);
  }

  moveSpace(space, cx) {
    submitDialog(this, `move-${space.id}`, async () => {
      await hws(["space", "move", "--space", space.id, "--workspace", props().workspace]);
    }, cx);
  }

  tabsSection(t, workspace, space) {
    const liveAgents = agents().filter((a) => workspace.spaces.includes(a.space));
    return v_flex()
      .flex_none()
      .gap(6)
      .child(sectionTitle(t, "Tabs and agents"))
      .children(
        (space?.tabs ?? []).map((tab) =>
          v_flex()
            .flex_none()
            .gap(1)
            .child(
              h_flex()
                .id(`tab-${tab.id}`)
                .h(24)
                .px(8)
                .gap(8)
                .items_center()
                .rounded(6)
                .cursor_pointer()
                .hover((s) => s.bg(t.hover))
                .on_click(() => run("tab.select", { id: tab.id }))
                .child(div().flex_1().min_w(0).truncate().font_medium().child(tab.name))
                .when(Boolean(tab.status), (el) => el.child(div().flex_none().text_size(11).text_color(t[tab.status] ?? t.dim).child(STATUS_WORD[tab.status] ?? tab.status))),
            )
            .children(liveAgents.filter((a) => a.tab === tab.id).map((a) => this.agentRow(t, workspace, a))),
        ),
      );
  }

  agentRow(t, workspace, agent) {
    const role = workspace.terminals?.find((x) => x.terminal === agent.address)?.role;
    const label = [agent.program?.name ?? agent.app ?? "Agent", role, agent.address].filter(Boolean).join(" · ");
    return h_flex()
      .id(`agent-${agent.address}`)
      .h(22)
      .pl(20)
      .pr(8)
      .gap(8)
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("agent.focus", { terminal: agent.address }))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(label))
      .child(div().flex_none().text_size(11).text_color(t[agent.status] ?? t.dim).child(STATUS_WORD[agent.status] ?? agent.status));
  }

  surfacesSection(t, workspace) {
    const surfaces = workspace.surfaces ?? [];
    const livePanes = new Set(panes().map((p) => p.pane));
    const drafts = new Set((shared("hws-pane.boards") ?? []).filter((b) => !b.open).map((b) => b.id));
    return v_flex()
      .flex_none()
      .gap(1)
      .child(sectionTitle(t, "Open surfaces"))
      .when(surfaces.length === 0, (el) => el.child(div().px(8).text_color(t.dim).child("None open.")))
      .children(
        surfaces.map((s) =>
          h_flex()
            .id(`surface-${s.id}`)
            .h(24)
            .px(8)
            .gap(8)
            .items_center()
            .rounded(6)
            .when(livePanes.has(s.pane), (el) => el.cursor_pointer().hover((st) => st.bg(t.hover)).on_click(() => run("pane.focus", { pane: s.pane })))
            .when(Boolean(s.host), (el) => el.cursor_pointer().hover((st) => st.bg(t.hover)).on_click(() => { hws(["surface", "resume", "--id", s.id]).catch(() => {}); }))
            .child(div().flex_1().min_w(0).truncate().child(s.title || s.type))
            .child(div().flex_none().text_size(11).text_color(t.dim).child(`${s.terminal ? `${s.type} · ${s.terminal}` : `${s.type} · standalone`}${drafts.has(s.id) ? " · draft" : ""}`)),
        ),
      );
  }

  footer(t, workspace) {
    if (this.isConfirmingClose) {
      return h_flex()
        .flex_none()
        .px(14)
        .py(8)
        .gap(6)
        .items_center()
        .border_t(1)
        .border_color(t.border)
        .child(div().flex_1().min_w(0).text_size(12).text_color(t.muted).child("Close this workspace and its terminals?"))
        .child(button(t, "close-cancel", "Cancel", false, (_e, cx) => { this.isConfirmingClose = false; cx.notify(); }))
        .child(button(t, "close-yes", "Close", true, (_e, cx) => this.closeWorkspace(workspace, cx)));
    }
    return h_flex()
      .flex_none()
      .px(14)
      .py(8)
      .gap(6)
      .items_center()
      .justify_end()
      .border_t(1)
      .border_color(t.border)
      .child(button(t, "close", this.busy === "close" ? "Closing…" : "Close workspace", false, (_e, cx) => { this.isConfirmingClose = true; cx.notify(); }, this.busy !== "close"));
  }

  // A kept workspace shows Current, Since last tidy, Artifacts and Places.
  // A throwaway shows its Record in their place.
  renderWorkspace(t, workspace) {
    const space = spaces().find((s) => s.id === workspace.id);
    const view = { t, host: this, workspace, target: this.trackAgent(workspace.id), now: Date.now() };
    const isThrowaway = workspace.kind === "throwaway";
    return v_flex()
      .id("hws-panel")
      .size_full()
      .min_h(0)
      .bg(t.background)
      .text_color(t.foreground)
      .text_size(13)
      .child(headerSection(view))
      .child(
        v_flex()
          .id("hws-panel-body")
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .p(10)
          .gap(14)
          .when(isThrowaway, (el) => el.child(recordSection(view)))
          .when(!isThrowaway, (el) => el.child(currentSection(view)).child(sinceSection(view)).child(artifactsSection(view)).child(placesSection(view)))
          .child(this.tabsSection(t, workspace, space))
          .child(this.surfacesSection(t, workspace)),
      )
      .when(Boolean(this.note), (el) => el.child(div().flex_none().px(14).py(4).text_size(11).text_color(this.note.isError ? t.blocked : t.dim).whitespace_normal().child(this.note.text)))
      .child(this.footer(t, workspace));
  }

  renderMessage(t, text, offerNew) {
    return v_flex()
      .id("hws-panel")
      .size_full()
      .min_h(0)
      .p(14)
      .gap(10)
      .bg(t.background)
      .text_color(t.dim)
      .text_size(13)
      .child(text)
      .when(offerNew, (el) =>
        el.child(
          h_flex().child(
            button(t, "new-workspace", "New workspace…", false, openWorkspaceForm),
          ),
        ),
      );
  }

  renderPanel(t, cx) {
    const f = focused();
    const spaceId = f?.space ?? null;
    if (spaceId !== this.spaceId) {
      this.spaceId = spaceId;
      this.isConfirmingClose = false;
      this.note = null;
      this.showSuperseded = false;
      this.showAllBacklog = false;
      this.refresh(cx);
    }
    if (this.problem) return this.renderMessage(t, this.problem, false);
    if (this.manifests === null) return this.renderMessage(t, "Loading…", false);
    const workspace = this.manifests.find((m) => m.spaces.includes(spaceId));
    if (!workspace) return this.renderMessage(t, "This space is not a workspace.", true);
    this.watch(workspace.dir, cx);
    return this.renderWorkspace(t, workspace);
  }

  renderAddSpace(t) {
    const members = props().spaces ?? [];
    const movable = spaces().filter((s) => !s.machine && !members.includes(s.id));
    const moveRow = (s) => h_flex()
      .id(`move-${s.id}`)
      .h(32)
      .flex_none()
      .px(8)
      .gap(8)
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .hover((st) => st.bg(t.hover))
      .on_click((_e, cx) => this.moveSpace(s, cx))
      .child(svg("mods/workspace-chrome/terminal.svg").size(12).flex_none().text_color(t.dim))
      .child(div().flex_1().min_w(0).truncate().child(s.name))
      .child(div().flex_none().text_size(11.5).text_color(t.dim).child(`${s.tabs.length} ${s.tabs.length === 1 ? "tab" : "tabs"}`));

    return dialogRoot(t, "hws-add-space")
      .track_focus(this.handle)
      .on_key_down(formKeys(this, () => closeOverlay(props().overlay)))
      .child(
        v_flex()
          .id("hws-add-space-body")
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .p(18)
          .gap(12)
          .child(div().text_size(15).font_semibold().child(`Add a space to ${props().name}`))
          .child(labeled(t, "New space", field(t, this, "name")))
          .when(movable.length > 0, (el) => el.child(labeled(t, "Or move an open space here", v_flex().children(movable.map(moveRow)))))
          .when(Boolean(this.problem), (el) => el.child(problemLine(t, this.problem))),
      )
      .child(
        dialogFooter()
          .child(button(t, "cancel", "Cancel", false, () => closeOverlay(props().overlay)))
          .child(button(t, "add-space-yes", this.busy === "add" ? "Adding…" : "Add space", true, (_e, cx) => this.addSpace(cx), !this.busy)),
      );
  }

  renderDecide(t) {
    const p = props() ?? {};
    const artifacts = p.artifacts ?? [];
    return dialogRoot(t, "hws-decide")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        closeOverlay(props().overlay);
        cx.stop_propagation();
      })
      .child(
        v_flex()
          .flex_none()
          .p(18)
          .pb(10)
          .gap(4)
          .child(div().text_size(15).font_semibold().child(`Close ${p.name ?? "this throwaway"}?`))
          .child(div().text_color(t.muted).whitespace_normal().child("This throwaway made these. Keep leaves them on disk. Trash moves them to the macOS Trash.")),
      )
      .child(
        v_flex()
          .id("hws-decide-list")
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .px(18)
          .gap(4)
          .children(
            artifacts.map((a) =>
              h_flex()
                .flex_none()
                .gap(8)
                .child(div().flex_1().min_w(0).truncate().child(a.title || a.id))
                .child(div().flex_none().text_size(11).text_color(t.dim).child(a.type ?? "")),
            ),
          )
          .when(Boolean(p.scratch), (el) =>
            el.child(
              h_flex()
                .flex_none()
                .gap(8)
                .child(div().flex_none().child("Scratch folder"))
                .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(tilde(p.scratch))),
            ),
          ),
      )
      .when(Boolean(this.problem), (el) => el.child(div().flex_none().px(18).pt(8).child(problemLine(t, this.problem))))
      .child(
        dialogFooter()
          .child(button(t, "cancel", "Cancel", false, () => closeOverlay(props().overlay)))
          .child(button(t, "trash", this.busy === "trash" ? "Moving…" : "Trash", false, (_e, cx) => this.decide("trash", cx), !this.busy))
          .child(button(t, "keep", this.busy === "keep" ? "Keeping…" : "Keep", true, (_e, cx) => this.decide("keep", cx), !this.busy)),
      );
  }

  renderPromote(t) {
    return dialogRoot(t, "hws-promote")
      .track_focus(this.handle)
      .on_key_down(formKeys(this, () => closeOverlay(props().overlay)))
      .child(
        v_flex()
          .id("hws-promote-body")
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .p(18)
          .gap(12)
          .child(div().text_size(15).font_semibold().child("Promote to a workspace"))
          .child(labeled(t, "Name", field(t, this, "name")))
          .child(labeled(t, "Folder", folderRow(t, this)))
          .when(Boolean(this.problem), (el) => el.child(problemLine(t, this.problem))),
      )
      .child(
        dialogFooter()
          .child(button(t, "cancel", "Cancel", false, () => closeOverlay(props().overlay)))
          .child(button(t, "promote-yes", this.busy ? "Promoting…" : "Promote", true, (_e, cx) => this.promote(cx), !this.busy)),
      );
  }

  render(cx) {
    const t = theme();
    if (this.view === "toggle") return div();
    if (this.view === "sidebar") return drawSidebar(this.sidebar);
    if (this.view === "decide") return this.renderDecide(t);
    if (this.view === "promote") return this.renderPromote(t);
    if (this.view === "add-space") return this.renderAddSpace(t);
    if (this.view === "instructions") return this.renderInstructions(t);
    return this.renderPanel(t, cx);
  }
}
