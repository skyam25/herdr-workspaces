// Features of the Shepherdr chat that Herdr Workspaces keeps off.

const OFF = new Set(["voice", "reactions", "artifacts", "browser", "autopilot", "machines", "insights"]);

export const on = (id) => !OFF.has(id);
