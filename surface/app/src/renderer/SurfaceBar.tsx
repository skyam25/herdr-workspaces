import type { ReactNode } from 'react';
import type { SurfaceAction, SurfaceState } from '../shared/ipc';
import { PopInIcon, PopOutIcon } from './Icons';

/**
 * The composer's right end on a surface: the owner and Pop, the mic, then Done, or Open terminal
 * and Copy link when no terminal waits.
 */
export function SurfaceBar(props: { surface: SurfaceState; mic?: ReactNode; onDone: () => void; onAct: (action: SurfaceAction) => void }) {
  const { surface } = props;
  const blocked = !!surface.busy || !!surface.delivered;
  const owned = !!surface.owner && !surface.standalone;
  const popOut = surface.shown === 'pane';
  return (
    <div className="anchor send-to" data-testid="surface-bar">
      {owned && (
        <button className="ghost surface-owner" title={`Go to ${surface.owner}`} onClick={() => props.onAct('owner')} data-testid="surface-owner">
          {surface.owner}
        </button>
      )}
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
      {(owned || !surface.web) && <span className="divider" aria-hidden="true" />}
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
