import type { ReactNode } from 'react';
import type { SurfaceAction, SurfaceState } from '../shared/ipc';

/** The composer's right end on a surface: the mic, then Done, or Open terminal and Copy link when no terminal waits. */
export function SurfaceBar(props: { surface: SurfaceState; mic?: ReactNode; onDone: () => void; onAct: (action: SurfaceAction) => void }) {
  const { surface } = props;
  const blocked = !!surface.busy || !!surface.delivered;
  return (
    <div className="anchor send-to" data-testid="surface-bar">
      {surface.owner && !surface.standalone && (
        <>
          <button className="ghost surface-owner" title={`Go to ${surface.owner}`} onClick={() => props.onAct('owner')} data-testid="surface-owner">
            {surface.owner}
          </button>
          <span className="divider" aria-hidden="true" />
        </>
      )}
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
