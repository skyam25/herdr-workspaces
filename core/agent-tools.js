// What differs between the agent CLIs that hws starts.
const TOOLS = {
  claude: {
    startArgv: ({ model, effort }) => ['claude', '--model', model, '--effort', effort],

    // Claude resumes on the person's default model unless told, so a worker's model goes with it.
    resumeArgv: ({ id, model, effort }) => [...(model ? TOOLS.claude.startArgv({ model, effort }) : ['claude']), '--resume', id],
    sessionFlag: '--session-id',
    reportsByHook: true,
  },
  codex: {
    startArgv: ({ model, effort }) => ['codex', '-m', model, '-c', `model_reasoning_effort="${effort}"`],
    resumeArgv: ({ id }) => ['codex', 'resume', id],
    sessionFlag: null,
    reportsByHook: false,
  },
};

export const agentTool = (name) => TOOLS[name] ?? TOOLS.claude;

// The start of the command line for an agent with these settings.
export const agentArgv = (settings) => agentTool(settings.tool).startArgv(settings);
