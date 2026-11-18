/** The command lines and names the CLI prints, which differ under `hws surface cli`. */

/** `hws surface cli` sets it, so the CLI knows it runs under a surface. Only its presence counts. */
export const SURFACE_CWD_ENV = 'HWS_SURFACE_CLI_CWD';

/** The surface's session folder, which `hws surface cli` names when the surface has a file. */
export const SESSION_FOLDER_ENV = 'HWS_SESSION_FOLDER';

const BOARD_VERBS = new Set(['status', 'sessions', 'boards', 'read', 'png', 'draw', 'snap', 'update', 'delete']);
const PAGE_VERBS = new Set(['outline', 'feedback', 'behavior']);

export interface Cli {
  /** True under `hws surface cli`. */
  surface: boolean;
  /** The line that runs `args`, a verb and its arguments, such as `draw --board b`. */
  line: (args: string) => string;
  /** The name of what the CLI talks to. */
  name: string;
}

/** The surface type `hws surface cli` needs for a verb, if any. */
function typeOf(verb: string): string | undefined {
  if (BOARD_VERBS.has(verb)) return 'board';
  if (PAGE_VERBS.has(verb)) return 'page';
  return undefined;
}

export function cliFor(env: Record<string, string | undefined>): Cli {
  if (!env[SURFACE_CWD_ENV]) return { surface: false, line: (args) => `agent-brief ${args}`, name: 'Agent Brief' };
  return {
    surface: true,
    line: (args) => {
      const type = typeOf(args.split(' ')[0]);
      return `hws surface cli ${type ? `--type ${type} ` : ''}-- ${args}`;
    },
    name: 'Surface',
  };
}

/** Verbs a surface cannot serve. Each names what to use instead. */
export function surfaceRefusal(verb: string, cli: Cli): string | undefined {
  switch (verb) {
    case 'show':
      return `a surface shows no pictures in the session. Put one on a board with "${cli.line('snap FILE')}", or open a page with "hws review FILE".`;
    case 'output':
      return 'a surface records no outputs. Declare one with "hws output add --title T --path P".';
    case 'initiative':
      return 'a surface keeps no initiatives. The workspace holds the standing brief, and "hws current --line" prints it.';
    case 'note':
      return 'a surface keeps no saved notes. Write the text to a Markdown file and open it with "hws surface open --type note --file F".';
    default:
      return undefined;
  }
}
