import type { AgentType, SlashCommand } from '../types';

export function filterSlashCommandsForAgent(commands: SlashCommand[], agent: AgentType) {
  return commands.filter((command) => command.agentScope.includes(agent));
}
