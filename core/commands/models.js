import { UsageError } from '../errors.js';
import { DEFAULT_MODELS, MODEL_CATALOG, agentModels, setAgentModel } from '../settings.js';
import { requireFlag } from '../resolve.js';

const ROLES = ['orchestrator', 'worker'];

export function modelsShow() {
  return { data: { ...agentModels(), catalog: MODEL_CATALOG, recommended: DEFAULT_MODELS } };
}

export function modelsSet(flags) {
  const role = requireFlag(flags, 'role');
  if (!ROLES.includes(role)) throw new UsageError('--role must be orchestrator or worker');
  const tool = flags.tool ?? agentModels()[role].tool;
  if (!MODEL_CATALOG[tool]) throw new UsageError('--tool must be claude or codex');

  // The orchestrator's instructions are a Claude Code skill, so Codex cannot run it.
  if (role === 'orchestrator' && tool !== 'claude') throw new UsageError('the orchestrator runs on Claude Code');
  const value = { tool, model: requireFlag(flags, 'model'), effort: requireFlag(flags, 'effort') };
  setAgentModel(role, value);
  return modelsShow();
}
