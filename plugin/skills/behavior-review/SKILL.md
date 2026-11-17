---
name: behavior-review
description: This skill should be used when the user asks for behavior rules, acceptance criteria or assumptions beside an interactive HTML prototype, asks to review a prototype's behavior, sends behavior decisions from the Behavior tab of a Herdr review page, or asks to export acceptance criteria for an engineering handoff. Explains how to keep rules in <prototype.html>.behavior.json with `hws surface cli -- behavior`, review them with `hws review`, and apply the decisions.
---

# Behavior review

The review page that `hws review` opens for a prototype has a Behavior tab beside its comments. Rules live in `<prototype.html>.behavior.json`, independent of the session. The surface checks revisions and keeps the decision history, so change the rules through `hws surface cli -- behavior`, never by editing the file.

Run `~/.local/bin/hws` if `hws` is not on PATH.

| Command | Does |
|---|---|
| `hws review <prototype.html>` | Opens the prototype beside this terminal, with its Behavior tab |
| `hws surface cli -- behavior show <prototype.html> --json` | Reads the rules. A missing file returns an empty document with `version: "missing"` |
| `hws surface cli -- behavior update <prototype.html> --file <patch.json> --json` | Applies a version-checked patch |
| `hws surface cli -- behavior export <prototype.html> --out acceptance.md` | Writes acceptance criteria for a handoff |

The `hws surface cli` commands run against this terminal's open surface. When none is open, finish the prototype, then run `hws review <prototype.html>` as you hand it over, and write the rules then. If a command fails, say the rules were not saved, keep going with authorized prototype work, and never claim they were recorded.

## Create the prototype and rules

- Follow the user's scope and the project's visual conventions. For an interactive prototype, make the relevant states reachable and use realistic domain data. Mark simulated actions in the page itself, and never imply a backend effect works.
- Give controls stable, unique `data-ui` attributes. A rule can target `[data-ui="invite-back"]` and name the state in which it appears. Flow-wide rules need no target. Keep static wireframes static unless the task needs interaction.
- Record consequential behavior, such as triggers, conditions, effects, errors, empty states, navigation and persistence. Leave out cosmetic details and rules for every DOM element.
- Explicit requirements may start `confirmed`, with a source reference to the brief, sketch or user instruction. Inferences start `proposed`, with `source.kind: "assumption"`. Confirming a rule records agreement. It does not claim implementation or verification.

Read the rules first, then write a patch to a JSON file in `.feedback/scratch/`. Copy the returned `version` exactly.

```json
{
  "version": "missing",
  "upsert": [
    {
      "id": "invite-back",
      "text": "Returning to the invite step preserves entered addresses during this onboarding session.",
      "status": "proposed",
      "source": { "kind": "assumption", "ref": "The brief does not specify navigation persistence." },
      "target": { "selector": "[data-ui=\"invite-back\"]", "state": "Invite teammates" },
      "delivery": "planned"
    }
  ],
  "limitations": ["Sending invitations is simulated; no invitations are delivered."]
}
```

Apply it with `behavior update`, then run `hws output add --title "Onboarding prototype" --path prototypes/onboarding.html --status ready`.

`upsert` changes only the rules it names. Keep ids stable. `limitations`, when given, replaces the whole list. Keep rules scoped to this prototype, and never delete a specification at implementation time.

## Apply a review

1. Read the delivered `review.md`, then read the current rules with `behavior show`. The delivered snapshot records what the user reviewed, and the current document may be newer.
2. Apply confirmed behaviors within the authorized task. Product approval alone does not ask for a production implementation. Leave proposed rules open and keep working on independent, settled behavior.
3. Treat appearance feedback as ordinary edits. When a comment introduces behavior, capture it as a rule with a source reference to the review bundle and comment. An ambiguous reading stays proposed.
4. The user confirms proposals in the Behavior tab, so never promote one yourself. Changing an existing rule's text or target returns it to proposed and clears its implementation evidence. The history keeps its previous decision.
5. Use `note` on a rule for an unresolved question, and keep the prototype's limitations accurate. `delivery` is `planned`, `implemented` or `verified`. Use the last two only for the real product, and give `evidence` for verification, such as a test command and its result. A clickable mock is not an implemented product.
6. On a version conflict, read again, merge only your intended changes, and retry. Never overwrite a newer decision from the user.
7. Run `hws review <prototype.html>` again so the user can check the changed interactions, then end the turn.

## Handoff

`behavior export` writes confirmed acceptance criteria, open assumptions, delivery evidence and simulated actions. Keep the rules file and the prototype with the handoff. In a Herdr workspace, register the export with `hws artifact add --file acceptance.md --in-place --title X`. Cards on the task list may name rule ids, but never copy the rules into cards.
