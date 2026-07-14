import { PluginsSuite } from './plugins/PluginsSuite';
import type { AgentProviderId } from '../../types';

export function PluginsSettingsSection({
  defaultProviderId,
  projectPath,
}: {
  defaultProviderId: AgentProviderId;
  projectPath?: string;
}) {
  return <PluginsSuite defaultProviderId={defaultProviderId} projectPath={projectPath} />;
}
