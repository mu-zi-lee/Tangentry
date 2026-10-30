import { FolderOpen, RefreshCw, Save } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { request } from '../../shared/api/client'
import { listOrEmpty } from '../../shared/api/list'
import { WhisperModels } from './WhisperModels'
import { PathInput } from './PathInput'
import { SettingsTask } from './ui/SettingsActionPage'
import { getInterfacePreference, setInterfacePreference } from '../../shared/preferences/interfacePreferences'
import { Dialog } from '../../components/ui/dialog/Dialog'
import { useCapabilities } from '../../shared/api/desktop'
import { SettingsRow } from './ui/SettingsRow'

type Backend = 'whisper.cpp' | 'faster-whisper' | 'qwen3-asr' | 'groq' | 'cloudflare' | 'siliconflow' | 'mai'
const engineGroups: { label: string; hint: string; options: { value: Backend; label: string }[] }[] = [
  { label: '本机', hint: '音频不上传', options: [
    { value: 'qwen3-asr', label: 'Qwen3-ASR' },
    { value: 'faster-whisper', label: 'faster-whisper' },
    { value: 'whisper.cpp', label: 'whisper.cpp' },
  ] },
  { label: '云端', hint: '确认后上传音频', options: [
    { value: 'siliconflow', label: '硅基流动' },
    { value: 'groq', label: 'Groq' },
    { value: 'cloudflare', label: 'Cloudflare' },
    { value: 'mai', label: 'MAI · 实验' },
  ] },
]
interface Config { backend: Backend; python: string; binary: string; model: string; qwenAligner?: string; language: string; groqModel?: string; cloudflareAccountId?: string; siliconflowSegmentSeconds?: number; siliconflowModel?: string }
interface Model { backend: Backend; label: string; path: string }
type LocalDraft = Pick<Config, 'python' | 'binary' | 'model' | 'qwenAligner'>
function localDraft(config: Config): LocalDraft {
  return { python: config.python, binary: config.binary, model: config.model, qwenAligner: config.qwenAligner }
}
function isLocal(backend: Backend) {
  return backend === 'whisper.cpp' || backend === 'faster-whisper' || backend === 'qwen3-asr'
}
interface Status { ready: boolean; missing: string[]; config: Config; models?: Model[]; groqKeyConfigured?: boolean; cloudflareTokenConfigured?: boolean; siliconflowKeyConfigured?: boolean; maiCookieConfigured?: boolean; modelDownload?: string }
function normalizedStatus(value: Status): Status {
  return {...value,missing:listOrEmpty(value.missing),models:listOrEmpty(value.models),config:{...value.config,backend:value.config.backend || 'whisper.cpp',python:value.config.python || 'python3'}}
}
export function TranscriptionSettings({ active = true }: { active?: boolean }) {
  const { pathPicker } = useCapabilities()
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [modelDirectory, setModelDirectory] = useState('')
  const [movingModels, setMovingModels] = useState(false)
  const localDrafts = useRef<Partial<Record<Backend, LocalDraft>>>({})
  const [loadRevision, setLoadRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<Status | null>(null), [config, setConfig] = useState<Config>({ backend:'whisper.cpp', python:'python3', binary:'whisper-cli', model:'', language:'zh' })
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [pending, setPending] = useState(false)
  const [groqKey, setGroqKey] = useState(''), [cloudflareToken, setCloudflareToken] = useState('')
  const [clearGroq, setClearGroq] = useState(false), [clearCloudflare, setClearCloudflare] = useState(false)
  const [siliconflowKey, setSiliconflowKey] = useState(''), [clearSiliconflow, setClearSiliconflow] = useState(false)
  const [maiCookie, setMAICookie] = useState(''), [clearMAI, setClearMAI] = useState(false)
  const [automaticSubtitles, setAutomaticSubtitles] = useState(true)
  const [automaticPending, setAutomaticPending] = useState(false)
  const cloud = config.backend === 'groq' || config.backend === 'cloudflare' || config.backend === 'siliconflow' || config.backend === 'mai'
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    setLoading(true); setError('')
    void request<Status>('/transcription/settings', {signal:controller.signal}).then(value=>{
      if (controller.signal.aborted) return
      const status=normalizedStatus(value); setStatus(status); setConfig(status.config)
    }).catch(cause=>{
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '配置暂不可用。')
    }).finally(()=>{if (!controller.signal.aborted) setLoading(false)})
    return ()=>controller.abort()
  }, [active, loadRevision])
  useEffect(() => {
    if (!active) return
    void getInterfacePreference('automatic_subtitles').then(value => setAutomaticSubtitles(value.value !== 'false')).catch(() => {})
  }, [active])
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    void request<{ directory: string }>('/desktop/model-directory', { signal: controller.signal }).then(value => setModelDirectory(value.directory)).catch(() => {})
    return () => controller.abort()
  }, [active])
  async function moveModels() {
    setMovingModels(true); setError('')
    try {
      const value = await request<{ directory: string; cancelled: boolean }>('/desktop/model-directory', { method: 'POST' })
      if (!value.cancelled) { setModelDirectory(value.directory); setLoadRevision(value => value + 1) }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '模型迁移未完成。') }
    finally { setMovingModels(false) }
  }
  async function save() {
    setPending(true); setError(''); setNotice('')
    try { const response = await request<Status>('/transcription/settings', { method:'PUT',body:JSON.stringify({...config, ...(clearGroq || groqKey.trim() ? {groqApiKey:clearGroq ? '' : groqKey.trim()} : {}), ...(clearCloudflare || cloudflareToken.trim() ? {cloudflareApiToken:clearCloudflare ? '' : cloudflareToken.trim()} : {}), ...(clearSiliconflow || siliconflowKey.trim() ? {siliconflowApiKey:clearSiliconflow ? '' : siliconflowKey.trim()} : {}), ...(clearMAI || maiCookie.trim() ? {maiCookie:clearMAI ? '' : maiCookie.trim()} : {})}) }); const value=normalizedStatus(response); setStatus(value); setConfig(value.config); setGroqKey(''); setCloudflareToken(''); setSiliconflowKey(''); setMAICookie(''); setClearMAI(false); setClearGroq(false); setClearCloudflare(false); setClearSiliconflow(false); setNotice('转录配置已保存，下一次转录立即生效。') }
    catch (cause) { setError(cause instanceof Error ? cause.message : '未能保存配置。') }
    finally { setPending(false) }
  }
  const dirty=status && (JSON.stringify(config)!==JSON.stringify(status.config) || groqKey || cloudflareToken || siliconflowKey || maiCookie || clearMAI || clearGroq || clearCloudflare || clearSiliconflow)
  const models=listOrEmpty(status?.models).filter(model => model.backend === config.backend)
  const selected=models.some(model => model.path===config.model) ? config.model : ''
  function selectBackend(backend: Backend, modelPath?: string) {
    if (isLocal(config.backend)) localDrafts.current[config.backend] = localDraft(config)
    if (!isLocal(backend)) {
      setConfig({...config,backend,...(backend==='groq'?{groqModel:config.groqModel || 'whisper-large-v3-turbo'}:{})}); return
    }
    const model=status?.models?.find(model => model.backend===backend && model.label==='base') ?? status?.models?.find(model => model.backend===backend)
    const draft = localDrafts.current[backend] ?? { python: 'python3', binary: 'whisper-cli', model: model?.path ?? '', qwenAligner: '' }
    setConfig({...config,...draft,backend,...(modelPath === undefined ? {} : {model:modelPath})})
  }
  function changeBackend(backend: Backend) {
    selectBackend(backend)
    setNotice('引擎已切换，保存后生效。')
  }
  return <>
    <SettingsTask title="识别方式">
      <div className="settings-list-card">
        <SettingsRow setting="asr-engine" title="转录引擎" description={cloud ? '使用所选云端服务，上传音频前会征求确认' : '在本机运行，音频不离开设备'}>
          <div className="settings-choice-row" role="group" aria-label="转录引擎">{engineGroups.map(group => <button type="button" key={group.label} className={(group.label === '云端') === cloud ? 'active' : ''} aria-pressed={(group.label === '云端') === cloud} disabled={!status || pending} onClick={() => { if ((group.label === '云端') !== cloud) changeBackend(group.options[0].value) }}>{group.label}</button>)}</div>
        </SettingsRow>
        <SettingsRow title={cloud ? '转录服务' : '本机引擎'}>
          <select aria-label={cloud ? '转录服务' : '本机引擎'} value={config.backend} disabled={!status || pending} onChange={event => changeBackend(event.target.value as Backend)}>{engineGroups[cloud ? 1 : 0].options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        </SettingsRow>
        <SettingsRow title="识别语言"><select aria-label="识别语言" value={config.language} disabled={!status || pending} onChange={event => setConfig(value => ({ ...value, language: event.target.value }))}>{[['auto', '自动检测'], ['zh', '中文'], ['en', '英语'], ['ja', '日语'], ['ko', '韩语']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></SettingsRow>
        <SettingsRow title={cloud ? '服务凭据' : '运行环境'} description={status?.ready ? '已就绪' : status ? `未检测到：${status.missing.join('、')}` : '正在读取…'}>
          <button type="button" className="button button-secondary" disabled={!status || pending} onClick={() => setAdvancedOpen(true)}>{cloud ? '配置' : '高级设置'}</button>
        </SettingsRow>
        <SettingsRow title="播放时自动生成字幕" description="没有有效平台字幕时启动本机转录，不会自动上传音频。">
          <input className="settings-switch" role="switch" aria-label="播放时自动生成字幕" type="checkbox" checked={automaticSubtitles} disabled={automaticPending} onChange={event => {
            const value = event.target.checked
            setAutomaticSubtitles(value); setAutomaticPending(true)
            void setInterfacePreference('automatic_subtitles', String(value)).catch(() => { setAutomaticSubtitles(!value); setError('自动字幕设置未保存，请重试。') }).finally(() => setAutomaticPending(false))
          }}/>
        </SettingsRow>
      </div>
    </SettingsTask>
    {!status && (loading ? <p className="field-hint" role="status">正在读取转录设置…</p> : <button type="button" className="text-button" onClick={()=>setLoadRevision(value=>value+1)}><RefreshCw size={14}/>重试</button>)}
    {active && !cloud && status && <SettingsTask title="本机模型" description={engineGroups[0].options.find(option => option.value === config.backend)?.label}>
      <WhisperModels active={active} configurationPending={pending || movingModels} backend={config.backend} selectedModel={config.model} selectedAligner={config.backend==='qwen3-asr'?config.qwenAligner:''} refreshKey={`${status.config.python}:${modelDirectory}`} onInstalled={() => { void request<Status>('/transcription/settings').then(value => setStatus(normalizedStatus(value))).catch(() => setError('模型列表刷新失败，请重试。')) }} onChoose={(path,id) => { setConfig(value=>({...value,...(id==='qwen3-aligner-0.6b'?{qwenAligner:path}:{model:path})})); setNotice('模型已选择，保存后生效。') }} directoryRow={<SettingsRow setting="model-directory" title="模型目录" description={<span className="settings-mono">{modelDirectory || '由运行 Tangentry 的设备管理'}</span>}>{pathPicker && <button type="button" className="button button-secondary" disabled={movingModels || pending} onClick={() => void moveModels()}><FolderOpen size={14}/>{movingModels ? '正在迁移…' : '更改'}</button>}</SettingsRow>}/>
    </SettingsTask>}
    <div className="settings-savebar"><span className="field-hint">{dirty ? '更改将在保存后生效' : status?.ready ? '已就绪' : '保存后检查运行环境'}</span><button type="button" className="button button-primary" disabled={!status || pending || !dirty} onClick={() => void save()}><Save size={15}/>{pending ? '正在保存…' : '保存并检查'}</button></div>
    {error && <p className="settings-feedback" role="alert">{error}</p>}{notice && <p className="settings-feedback" role="status">{notice}</p>}
    <Dialog open={advancedOpen} title={cloud ? '云端服务配置' : '本机识别配置'} className="settings-dialog transcription-dialog" onClose={() => setAdvancedOpen(false)}>
    <form className="transcription-config" onSubmit={event=>{event.preventDefault();void save()}}><fieldset disabled={!status || pending} style={{display:'contents'}}>
      <div className="settings-form-fields">
      {config.backend==='mai' && <>
        <label>Microsoft Playground Cookie<input type="password" autoComplete="new-password" aria-label="Microsoft Playground Cookie" value={maiCookie} disabled={pending || clearMAI} maxLength={16384} placeholder={status?.maiCookieConfigured ? '已保存，留空保留' : '仅 playground.microsoft.ai 的登录 Cookie'} onChange={event=>setMAICookie(event.target.value)}/></label>
        {status?.maiCookieConfigured && <label className="transcription-clear-key"><input type="checkbox" checked={clearMAI} disabled={pending} onChange={event=>setClearMAI(event.target.checked)}/>清除 Microsoft 登录会话</label>}
        <p className="field-hint">免费预览服务可能变更或停用。请先在原站登录并阅读音频生物特征数据通知；会话清理为尽力操作，不保证删除云端音频。<a href="https://playground.microsoft.ai/" target="_blank" rel="noreferrer">打开 Microsoft Playground</a></p>
      </>}
      {config.backend==='siliconflow' && <>
        <fieldset className="layout-preference transcription-choice" aria-label="硅基流动模型"><legend>识别模型</legend><div className="layout-options">
          {([{value:'FunAudioLLM/SenseVoiceSmall',label:'SenseVoiceSmall'},{value:'Qwen/Qwen3-ASR-1.7B',label:'Qwen3-ASR-1.7B'}] as const).map(option=><label key={option.value}><input type="radio" name="siliconflow-model" value={option.value} checked={(config.siliconflowModel || 'FunAudioLLM/SenseVoiceSmall')===option.value} onChange={()=>setConfig(value=>({...value,siliconflowModel:option.value}))}/><span>{option.label}</span></label>)}
        </div></fieldset>
        <fieldset className="layout-preference transcription-choice" aria-label="转录片段长度"><legend>片段时长</legend><div className="layout-options">
          {[15,30,60].map(seconds=><label key={seconds}><input type="radio" name="siliconflow-seconds" value={seconds} checked={(config.siliconflowSegmentSeconds || 30)===seconds} onChange={()=>setConfig(value=>({...value,siliconflowSegmentSeconds:seconds}))}/><span>{seconds} 秒</span></label>)}
        </div></fieldset>
        <label>硅基流动 API Key<input type="password" autoComplete="new-password" aria-label="硅基流动 API Key" value={siliconflowKey} disabled={pending || clearSiliconflow} maxLength={512} placeholder={status?.siliconflowKeyConfigured ? '已保存，留空保留' : 'sk-…'} onChange={event=>setSiliconflowKey(event.target.value)}/></label>
        {status?.siliconflowKeyConfigured && <label className="transcription-clear-key"><input type="checkbox" checked={clearSiliconflow} disabled={pending} onChange={event=>setClearSiliconflow(event.target.checked)}/>清除已保存的硅基流动密钥</label>}
        <p className="field-hint">时间轴按片段划分，非逐句对齐；已有精确字幕会保留。</p>
      </>}
      {config.backend==='groq' && <>
        <fieldset className="layout-preference transcription-choice" aria-label="Groq 模型"><legend>识别模型</legend><div className="layout-options">
          {([{value:'whisper-large-v3-turbo',label:'Large V3 Turbo'},{value:'whisper-large-v3',label:'Large V3'}] as const).map(option=><label key={option.value}><input type="radio" name="groq-model" value={option.value} checked={(config.groqModel || 'whisper-large-v3-turbo')===option.value} onChange={()=>setConfig(value=>({...value,groqModel:option.value}))}/><span>{option.label}</span></label>)}
        </div></fieldset>
        <label>Groq API Key<input type="password" autoComplete="new-password" aria-label="Groq API Key" value={groqKey} disabled={pending || clearGroq} maxLength={512} placeholder={status?.groqKeyConfigured ? '已保存，留空保留' : 'gsk_…'} onChange={event=>setGroqKey(event.target.value)}/></label>
        {status?.groqKeyConfigured && <label className="transcription-clear-key"><input type="checkbox" checked={clearGroq} disabled={pending} onChange={event=>setClearGroq(event.target.checked)}/>清除已保存的 Groq 密钥</label>}
      </>}
      {config.backend==='cloudflare' && <>
        <label>Cloudflare Account ID<input aria-label="Cloudflare Account ID" value={config.cloudflareAccountId || ''} disabled={pending} maxLength={32} onChange={event=>setConfig(value=>({...value,cloudflareAccountId:event.target.value.trim()}))}/></label>
        <label>Cloudflare API Token<input type="password" autoComplete="new-password" aria-label="Cloudflare API Token" value={cloudflareToken} disabled={pending || clearCloudflare} maxLength={512} placeholder={status?.cloudflareTokenConfigured ? '已保存，留空保留' : 'Workers AI 访问令牌'} onChange={event=>setCloudflareToken(event.target.value)}/></label>
        {status?.cloudflareTokenConfigured && <label className="transcription-clear-key"><input type="checkbox" checked={clearCloudflare} disabled={pending} onChange={event=>setClearCloudflare(event.target.checked)}/>清除已保存的 Cloudflare 令牌</label>}
      </>}
      {config.backend==='qwen3-asr' && <>
        <PathInput label="Qwen3 Python 环境路径" ariaLabel="Qwen3 Python 路径" value={config.python} disabled={pending} kind="python" onChange={python=>setConfig(value=>({...value,python}))} placeholder="/path/to/qwen-venv/bin/python"/>
        <PathInput label="Qwen3-ASR 本地模型目录" ariaLabel="Qwen3-ASR 模型目录" value={config.model} disabled={pending} kind="model-directory" onChange={model=>setConfig(value=>({...value,model}))} placeholder="/models/Qwen3-ASR-0.6B"/>
        <PathInput label="Qwen3-ForcedAligner 本地模型目录" ariaLabel="Qwen3 对齐模型目录" value={config.qwenAligner || ''} disabled={pending} kind="model-directory" onChange={qwenAligner=>setConfig(value=>({...value,qwenAligner}))} placeholder="/models/Qwen3-ForcedAligner-0.6B"/>
        <p className="field-hint">本机离线推理，需安装 qwen-asr / PyTorch；下方可分别下载识别与对齐模型，保存在 Whisper 的同一模型目录。推理使用 CPU。</p>
      </>}
      {!cloud && config.backend!=='qwen3-asr' && <>
      <label>选择模型<select aria-label="选择 Whisper 模型" value={selected} disabled={pending} onChange={event=>{if(event.target.value)setConfig(value=>({...value,model:event.target.value}))}}><option value="">自定义模型路径</option>{models.map(model=><option key={model.path} value={model.path}>{model.label}{model.label==='tiny'?' · 轻量':model.label==='base'?' · 入门':model.label==='large-v3-turbo'?' · 高阶':''}</option>)}</select></label>
      {config.backend==='faster-whisper' ? <PathInput label="Python 环境路径" ariaLabel="faster-whisper Python 路径" value={config.python} disabled={pending} kind="python" onChange={python=>setConfig(value=>({...value,python}))} placeholder="/path/to/venv/bin/python"/> : <PathInput label="Whisper 程序路径" value={config.binary} disabled={pending} kind="whisper-binary" onChange={binary=>setConfig(value=>({...value,binary}))} placeholder="whisper-cli"/>}
      <PathInput label={config.backend==='faster-whisper'?'CTranslate2 模型目录':'Whisper 模型路径'} ariaLabel="Whisper 模型路径" value={config.model} disabled={pending} kind={config.backend==='faster-whisper'?'model-directory':'whisper-model'} onChange={model=>setConfig(value=>({...value,model}))} placeholder={config.backend==='faster-whisper'?'/path/to/faster-base':'/path/to/ggml-base.bin'}/>
      </>}
      </div>
      <div className="settings-savebar"><span className="field-hint">{dirty ? '更改将在保存后生效' : '保存后检查运行环境'}</span><button type="submit" className="button button-primary" disabled={pending || (!cloud && (config.backend==='qwen3-asr' || config.backend==='faster-whisper' ? !config.python : (!config.model || !config.binary)))}><Save size={15}/>{pending?'正在保存…':'保存并检查'}</button></div>
    </fieldset></form>{dirty ? <p className="field-hint" role="status">保存后检查，当前转录不受影响。</p> : status && !status.ready ? <p className="field-hint">未检测到：{status.missing.join('、')}</p> : status?.modelDownload && <p className="field-hint">识别模型将在首次转录时下载（{status.modelDownload}）。</p>}{error && <p className="subtitle-error" role="alert">{error}</p>}{notice && <p className="field-hint" role="status">{notice}</p>}
    <p className="field-hint">{cloud ? '登录信息仅存本机，请求时发送给所选服务；失败后不会自动重试或切换服务。' : config.backend==='qwen3-asr' ? '字幕时间来自 Qwen 强制对齐器；下载与推理均在本机手动管理。' : '默认识别中文，生成的中文字幕统一为简体。下拉列表只显示已安装模型；下载与转录分别由你手动开始，切换模型保存后生效。'}</p>
    </Dialog>
  </>
}
