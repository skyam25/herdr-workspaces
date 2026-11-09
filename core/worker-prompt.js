const list = (paths) => (paths.length > 0 ? paths.join('\n') : 'none');

function cardBlock(items) {
  return items.map((item) => `Card: ${item.id}\nTitle: ${item.title}\nNotes: ${item.notes.trim() || 'none'}`).join('\n\n');
}

// A Claude worker's closing message reaches its card through a hook. Other cases write the report on the move.
function finishStep({ items, single, id, space, orchestrator, hooks }) {
  const closesByHook = hooks && single;
  const report = closesByHook ? '' : ' --report="<what changed and what you checked, for this card only>"';
  const lines = [
    `When ${single ? 'the work' : 'a card'} is finished, record the result in up to two sentences that say what changed, where, and how you checked it.`,
    `   hws todo move --id ${id} --column done --note "<result>"${report} --space ${space}`,
  ];
  if (!hooks) lines.push(`   When you have finished every card, run: hc send ${orchestrator} "todo ${items[0].id}: done, close $HC_TERMINAL_ID"`);
  lines.push(closesByHook
    ? '   Then end your turn with a short summary of what changed, what you checked and what is left. Cover only this card, and leave out other workers\' changes and your own bookkeeping. A hook copies that message to the card and closes this session, so the orchestrator hears from it then.'
    : '   Then end your turn with a short summary of the cards you finished.');
  return lines.join('\n');
}

// The whole brief a worker starts from. Placeholders in angle brackets are for the worker to fill.
export function workerPrompt({ items, space, orchestrator, packet, owns, avoid, hooks }) {
  const single = items.length === 1;
  const id = single ? items[0].id : '<card id>';
  const afterAsking = single ? 'Then end your turn. The answer arrives as your next message, and you continue from there.' : 'Carry on with your other cards, then end your turn. The answer arrives as your next message.';
  const afterHandingBack = single ? 'Then end your turn.' : 'Carry on with your other cards.';
  return `You are a worker on ${single ? 'one Herdr to-do card. Do this card' : `${items.length} Herdr to-do cards. Do them in the order given`} and nothing else.

Space: ${space}

${cardBlock(items)}

Run packet:
${packet.trim() || 'none'}

Start from the notes and the packet. Read further only when they run out, and say why in your next note.

You own these files, and you may create or change only these:
${list(owns)}

You must not touch these files, because other workers own them:
${list(avoid)}

Run ~/.local/bin/hws if hws is not on PATH. Your cards are already claimed for you.

1. Do the work. Record progress at milestones only, in one short line.
   hws todo note --id ${id} --text "<progress>" --space ${space}

2. If you need the person, or need a file you do not own, ask.
   hws todo move --id ${id} --column waiting --note "<question>" --space ${space}
   hc send ${orchestrator} "todo ${items[0].id}: waiting on the person"
   ${afterAsking}

3. If a card turns out to need investigation, a design decision or far more files than its notes say, stop that card and hand it back.
   hws todo move --id ${id} --column todo --note "Needs its own worker: <why>" --space ${space}
   hc send ${orchestrator} "todo ${items[0].id}: handed back"
   ${afterHandingBack}

4. If you find work these cards do not cover, add a card and carry on. Do not expand a card.
   hws todo add --title="<what you found>" --notes="<evidence and where>" --space ${space}

5. ${finishStep({ items, single, id, space, orchestrator, hooks })}

Do not commit unless a card says to. Do not start other agents.`;
}
