import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { SurfaceAction, SurfaceState, SurfaceTargets } from '../shared/ipc';
import { usePointerOutside } from './hooks';
import { ChevronIcon, FolderIcon, InboxIcon, PopInIcon, PopOutIcon } from './Icons';

const UNFILED = 'standalone';

/** Where this surface is filed, and a menu that moves it when it shows in its own window. */
function WorkspaceChip(props: { surface: SurfaceState; onTargets: () => Promise<SurfaceTargets>; onMove: (workspace: string) => void }) {
  const { surface } = props;
  const [open, setOpen] = useState(false);
  const name = surface.workspace?.name || 'Unfiled';
  const unfiled = !surface.workspace?.name;
  const movable = surface.shown === 'window' && !surface.busy && !surface.delivered;
  return (
    <div className="anchor">
      <button
        className={unfiled ? 'ghost surface-workspace unfiled' : 'ghost surface-workspace'}
        disabled={!movable}
        aria-haspopup="menu"
        aria-expanded={open}
        title={surface.shown === 'window' ? `Filed under ${name}. Move it to another workspace.` : `Filed under ${name}. Pop it out to move it.`}
        onClick={() => setOpen((o) => !o)}
        data-testid="surface-workspace"
      >
        {unfiled ? <InboxIcon /> : <FolderIcon />}
        <span className="label">{name}</span>
        {surface.shown === 'window' && <ChevronIcon />}
      </button>
      {open && <MoveMenu onTargets={props.onTargets} onMove={(id) => (setOpen(false), props.onMove(id))} onClose={() => setOpen(false)} />}
    </div>
  );
}

function MoveMenu(props: { onTargets: () => Promise<SurfaceTargets>; onMove: (workspace: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [targets, setTargets] = useState<SurfaceTargets | undefined>();
  const [failed, setFailed] = useState<string | undefined>();
  usePointerOutside(ref, props.onClose, { parent: true });
  useEffect(() => {
    props.onTargets().then(setTargets, (err: Error) => setFailed(err.message));
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.onClose]);

  const suggested = targets?.workspaces.find((w) => w.id === targets.suggested);
  const others = targets?.workspaces.filter((w) => w.id !== targets.current && w.id !== targets.suggested) ?? [];
  const row = (id: string, label: string, icon: ReactNode) => (
    <button key={id} className="ghost move-row" role="menuitem" onClick={() => props.onMove(id)} data-testid={`move-to-${id}`}>
      {icon}
      <span className="label">{label}</span>
    </button>
  );
  return (
    <div className="popover-panel up start move-menu" ref={ref} role="menu" aria-label="Move to workspace" data-testid="move-menu">
      {failed && <p className="muted">{failed}</p>}
      {!targets && !failed && <p className="muted">Loading workspaces…</p>}
      {suggested && (
        <>
          <h3>Suggested</h3>
          {row(suggested.id, suggested.name, <FolderIcon />)}
        </>
      )}
      {targets && (
        <>
          <h3>{suggested ? 'Other workspaces' : 'Move to'}</h3>
          {others.length ? others.map((w) => row(w.id, w.name, <FolderIcon />)) : <p className="muted">No other workspace is open.</p>}
        </>
      )}
      {targets && targets.current !== UNFILED && (
        <>
          <span className="rule" aria-hidden="true" />
          {row(UNFILED, 'Unfiled', <InboxIcon />)}
        </>
      )}
    </div>
  );
}

/** The composer's left end on a surface: Pop, the workspace that holds it, and the terminal that owns it. */
export function SurfacePlace(props: {
  surface: SurfaceState;
  onAct: (action: SurfaceAction) => void;
  onTargets: () => Promise<SurfaceTargets>;
  onMove: (workspace: string) => void;
}) {
  const { surface } = props;
  const blocked = !!surface.busy || !!surface.delivered;
  const owned = !!surface.owner && !surface.standalone;
  const popOut = surface.shown === 'pane';
  if (!owned && surface.web) return null;
  return (
    <div className="surface-place" data-testid="surface-place">
      {!surface.web && (
        <button
          className="ghost surface-pop"
          disabled={blocked}
          title={popOut ? 'Show this in its own window' : 'Show this in a pane beside its terminal'}
          aria-label={popOut ? 'Pop out' : 'Pop in'}
          onClick={() => props.onAct('pop')}
          data-testid={popOut ? 'surface-pop-out' : 'surface-pop-in'}
        >
          {popOut ? <PopOutIcon /> : <PopInIcon />}
          <span className="label">{popOut ? 'Pop out' : 'Pop in'}</span>
        </button>
      )}
      {!surface.web && surface.workspace && <WorkspaceChip surface={surface} onTargets={props.onTargets} onMove={props.onMove} />}
      {owned && (
        <button className="ghost surface-owner" title={`Go to ${surface.owner}`} onClick={() => props.onAct('owner')} data-testid="surface-owner">
          {surface.owner}
        </button>
      )}
    </div>
  );
}

/** The composer's right end on a surface: the mic, then Done, or Open terminal and Copy link when no terminal waits. */
export function SurfaceBar(props: { surface: SurfaceState; mic?: ReactNode; onDone: () => void; onAct: (action: SurfaceAction) => void }) {
  const { surface } = props;
  const blocked = !!surface.busy || !!surface.delivered;
  return (
    <div className="anchor send-to" data-testid="surface-bar">
      {props.mic && (
        <>
          {props.mic}
          <span className="divider" aria-hidden="true" />
        </>
      )}
      {surface.standalone ? (
        <>
          <button className="ghost" disabled={blocked} onClick={() => props.onAct('terminal')} data-testid="surface-open-terminal">
            Open terminal
          </button>
          <button className="primary send-named" disabled={blocked} onClick={() => props.onAct('link')} data-testid="surface-copy-link">
            Copy link
          </button>
        </>
      ) : (
        <button className="primary send-named" disabled={blocked} title="Hand this to the terminal that opened it (⌘↩)" onClick={props.onDone} data-testid="surface-done">
          Done
        </button>
      )}
    </div>
  );
}
