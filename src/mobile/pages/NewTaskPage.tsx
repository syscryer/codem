import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, ChevronLeft } from 'lucide-react';
import { MobileSelect } from '../components/MobileSelect';
import { defaultAgentChannelId } from '../../lib/agent-channel-selection';
import {
  channelModelCatalog,
  defaultMobileReasoningEffort,
  mobilePermissionOptions,
  mobileReasoningEffortRequest,
  mobileReasoningOptions,
  supportsDynamicModelCatalog,
} from '../lib/mobile-agent-options';
import { mobileApi } from '../lib/mobile-api';
import type { MobileBootstrap, MobileModelCatalog } from '../types';

export function NewTaskPage({ bootstrap, onBack, onCreated }: { bootstrap: MobileBootstrap | null; onBack: () => void; onCreated: (id: string) => void }) {
  const providers = bootstrap?.providers ?? [];
  const selectableProviders = providers.filter((provider) => provider.selectable && provider.available === true);
  const [projectId, setProjectId] = useState(bootstrap?.projects[0]?.id || '');
  const [providerId, setProviderId] = useState(selectableProviders[0]?.id || providers[0]?.id || 'claude-code');
  const providerChannels = useMemo(() => (bootstrap?.channels.channels ?? []).filter((channel) => channel.providerId === providerId && channel.enabled), [bootstrap?.channels.channels, providerId]);
  const [channelId, setChannelId] = useState('system');
  const [catalog, setCatalog] = useState<MobileModelCatalog>();
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('default');
  const [permissionMode, setPermissionMode] = useState('default');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const channelSelectionProviderRef = useRef<string | null>(null);

  useEffect(() => {
    const providerChanged = channelSelectionProviderRef.current !== providerId;
    const channelStillAvailable = channelId === 'system' || providerChannels.some((channel) => channel.id === channelId);
    if (providerChanged || !channelStillAvailable) {
      setChannelId(defaultAgentChannelId(
        bootstrap?.channels.channels ?? [],
        providerId,
        bootstrap?.channels.defaultChannelIds[providerId],
      ));
    }
    channelSelectionProviderRef.current = providerId;
  }, [bootstrap?.channels.channels, bootstrap?.channels.defaultChannelIds, channelId, providerChannels, providerId]);

  useEffect(() => {
    let active = true;
    setCatalog(undefined);
    setError(undefined);
    const selectedChannel = providerChannels.find((channel) => channel.id === channelId);
    if (selectedChannel?.models.length) {
      const value = channelModelCatalog(providerId, selectedChannel.models);
      setCatalog(value);
      const nextModel = value.defaultModelId || '';
      setModel(nextModel);
      setEffort(defaultMobileReasoningEffort(providerId, value, nextModel));
      if (supportsDynamicModelCatalog(providerId)) {
        void mobileApi.models(providerId, channelId).then((nativeCatalog) => {
          if (!active) return;
          const merged = channelModelCatalog(providerId, selectedChannel.models, nativeCatalog);
          const mergedModel = merged.defaultModelId || '';
          setCatalog(merged);
          setModel(mergedModel);
          setEffort(defaultMobileReasoningEffort(providerId, merged, mergedModel));
        }).catch((reason) => active && setError(reason instanceof Error ? reason.message : '模型能力加载失败'));
      }
      return () => { active = false; };
    }
    if (!supportsDynamicModelCatalog(providerId)) {
      const value = { providerId, models: [] };
      setCatalog(value);
      setModel('');
      setEffort(defaultMobileReasoningEffort(providerId, value, ''));
      return () => { active = false; };
    }
    void mobileApi.models(providerId, channelId === 'system' ? undefined : channelId).then((value) => {
      if (!active) return;
      setCatalog(value);
      const nextModel = value.defaultModelId || '';
      setModel(nextModel);
      setEffort(defaultMobileReasoningEffort(providerId, value, nextModel));
    }).catch((reason) => active && setError(reason instanceof Error ? reason.message : '模型目录加载失败'));
    return () => { active = false; };
  }, [channelId, providerId]);

  const reasoningOptions = useMemo(
    () => mobileReasoningOptions(providerId, catalog, model),
    [catalog, model, providerId],
  );

  async function submit() {
    if (!projectId || !prompt.trim() || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const reasoningEffort = mobileReasoningEffortRequest(providerId, effort);
      const result = await mobileApi.createTask({ projectId, providerId, channelId: channelId === 'system' ? undefined : channelId, permissionMode, model: model || undefined, ...(reasoningEffort ? { reasoningEffort } : {}), prompt: prompt.trim(), contentBlocks: [] });
      onCreated(result.threadId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建任务失败');
    } finally {
      setBusy(false);
    }
  }

  return <div className="mobile-prototype prototype-detail mobile-new-task codex-desktop">
    <header className="prototype-detail-header"><button type="button" className="prototype-back-button" onClick={onBack} aria-label="返回任务列表"><ChevronLeft size={24} /><span>任务</span></button><div className="prototype-detail-title"><strong>新建任务</strong><span>Agent 在电脑端运行</span></div><span /></header>
    <main className="mobile-new-scroll">
      <section className="prototype-section"><h2>运行位置</h2><div className="mobile-form-group"><Field label="项目"><MobileSelect label="选择项目" value={projectId} onChange={setProjectId} options={(bootstrap?.projects ?? []).map((project) => ({ value: project.id, label: project.name }))} /></Field><Field label="Agent"><MobileSelect label="选择 Agent" value={providerId} onChange={setProviderId} options={providerOptions(providers, providerId)} /></Field><Field label="渠道"><MobileSelect label="选择渠道" value={channelId} onChange={setChannelId} options={[{ value: 'system', label: '系统渠道' }, ...providerChannels.map((channel) => ({ value: channel.id, label: channel.name }))]} /></Field></div>{selectableProviders.length === 0 ? <p className="mobile-form-hint">电脑端暂未检测到可用 Agent，请先在桌面端安装或启用 Agent。</p> : null}</section>
      <section className="prototype-section"><h2>模型与权限</h2><div className="mobile-form-group"><Field label="模型"><MobileSelect label="选择模型" value={model} onChange={(value) => { setModel(value); setEffort(defaultMobileReasoningEffort(providerId, catalog, value)); }} options={[{ value: '', label: 'Provider 默认' }, ...(catalog?.models ?? []).map((option) => ({ value: option.id, label: option.label }))]} /></Field>{reasoningOptions.length ? <Field label="思考级别"><MobileSelect label="选择思考级别" value={effort} onChange={setEffort} options={reasoningOptions} /></Field> : null}<Field label="权限模式"><MobileSelect label="选择权限模式" value={permissionMode} onChange={setPermissionMode} options={mobilePermissionOptions} /></Field></div></section>
      <section className="prototype-section"><h2>任务描述</h2><div className="mobile-new-prompt"><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="描述你想让 Agent 完成的任务…" />{error ? <p>{error}</p> : <span>支持创建后继续追问、停止、审批和回答问题。</span>}</div></section>
    </main>
    <button className="mobile-create-button" disabled={busy || !projectId || !prompt.trim()} onClick={() => void submit()}><span>{busy ? '正在创建…' : '创建并运行'}</span><ArrowUp size={19} /></button>
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="mobile-form-field"><span>{label}</span>{children}</div>; }

function providerOptions(providers: MobileBootstrap['providers'], selectedProviderId: string) {
  const options = providers.map((provider) => ({
    value: provider.id,
    label: provider.displayName,
    description: provider.available === true && provider.selectable
      ? undefined
      : provider.available !== true
        ? '电脑端未检测到'
        : '当前不可选择',
    disabled: provider.available !== true || !provider.selectable,
  }));
  if (options.length === 0) {
    return [{ value: selectedProviderId || 'claude-code', label: selectedProviderId === 'claude-code' ? 'Claude Code' : selectedProviderId || 'Agent', description: '等待桌面端检测', disabled: true }];
  }
  if (!options.some((option) => option.value === selectedProviderId)) {
    options.push({ value: selectedProviderId, label: selectedProviderId, description: '当前任务 Agent', disabled: true });
  }
  return options;
}
