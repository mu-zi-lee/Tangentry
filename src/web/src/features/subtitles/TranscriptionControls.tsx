import { Button, Checkbox } from '../../components/ui'
import { LoaderCircle, Mic, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { request } from '../../shared/api/client'

interface Job { id: string; contentId: string; state: string; preview: boolean; error?: string; failedStage?: string; backend?: string; received?: number; total?: number }
const failureStages: Record<string, string> = { model: '下载识别模型', resolving: '获取音轨', local: '本地媒体', fetching: '暂存音频', converting: '音频转换', recognizing: '语音识别', cached: '读取片段缓存', uploading: '云端转录', saving: '保存字幕' }
const stages: Record<string, string> = { model: '首次转录，正在下载识别模型…', resolving: '正在确认媒体音轨…', local: '正在读取已下载的媒体…', fetching: '正在下载并暂存音频…', converting: '正在准备识别音频…', recognizing: '正在本机识别语音…', cached: '正在复用已完成片段…', uploading: '正在逐段上传并转录音频…', saving: '正在保存字幕…', completed: '字幕已生成并保存到本机。', canceled: '转写已取消。', failed: '转写未完成。' }
const finished = (job: Job) => ['completed', 'failed', 'canceled'].includes(job.state)
const stageText = (job: Job) => {
  const text = stages[job.state] ?? '正在处理…'
  return job.total ? `${text} ${Math.floor((job.received ?? 0) * 100 / job.total)}%` : text
}

// Shared by video and podcast readers. Opening a reader never starts a job.
export function TranscriptionControls({ contentId, onComplete, video = false }: { contentId: string; onComplete: () => void; video?: boolean }) {
  const [ready, setReady] = useState<boolean | null>(null), [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState(''), [pending, setPending] = useState(false), [attempt, setAttempt] = useState(0)
  const [backend, setBackend] = useState(''), [uploadConsent, setUploadConsent] = useState(false)
  const completed = useRef(''), callback = useRef(onComplete)
  callback.current = onComplete
  useEffect(() => {
    const controller = new AbortController()
    setUploadConsent(false)
    setReady(null); setBackend(''); setJob(null)
    void request<{ ready: boolean; config?: { backend: string } }>('/transcription/settings', { signal: controller.signal }).then(value => { setReady(value.ready); setBackend(value.config?.backend ?? '') }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '转写工具状态暂不可用。') })
    void request<{ job: Job | null }>('/transcription/jobs?contentId=' + encodeURIComponent(contentId), { signal: controller.signal }).then(value => setJob(value.job)).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '任务状态暂不可用。') })
    return () => controller.abort()
  }, [contentId, attempt])
  useEffect(() => {
    if (!job) return
    if (job.state === 'completed' && completed.current !== job.id) { completed.current = job.id; callback.current() }
    if (finished(job)) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void request<Job>('/transcription/jobs/' + job.id, { signal: controller.signal }).then(setJob).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '任务状态暂不可用。') })
    }, 1000)
    return () => { clearTimeout(timer); controller.abort() }
  }, [job, attempt])
  async function start(preview: boolean) {
    setPending(true); setError('')
    try { setJob(await request<Job>('/transcription/jobs', { method: 'POST', body: JSON.stringify({ contentId, preview, uploadConsent, backend }) })); setUploadConsent(false) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '转写未能启动。') }
    finally { setPending(false) }
  }
  async function cancel() {
    if (!job) return
    setPending(true)
    try { await request('/transcription/jobs/' + job.id + '/cancel', { method: 'POST' }); setAttempt(value => value + 1) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '暂时无法取消。') }
    finally { setPending(false) }
  }
  const busy = Boolean(job && !finished(job))
  const activeBackend = busy ? job?.backend || backend : backend
  const cloud = activeBackend === 'groq' || activeBackend === 'cloudflare' || activeBackend === 'siliconflow' || activeBackend === 'mai'
  const provider = activeBackend === 'groq' ? 'Groq' : activeBackend === 'siliconflow' ? '硅基流动' : activeBackend === 'mai' ? 'Microsoft Playground' : 'Cloudflare'
  const allowed = ready && (!cloud || uploadConsent)
  return <div className="transcription-controls" data-transcription-control>
    <div className="podcast-transcription-tools"><span><Mic size={14}/>{cloud ? `${provider} 转录` : '本机转录'}</span>{busy ? <><p role="status"><LoaderCircle className="spin" size={14}/>{stageText(job!)}</p><Button variant="secondary" className="button button-secondary" disabled={pending} onClick={() => void cancel()}><X size={14}/>取消转写</Button></> : <><Button variant="secondary" className="button button-secondary" disabled={!allowed || pending} onClick={() => void start(true)}>转写前 1 分钟</Button><Button variant="secondary" className="button button-secondary" disabled={!allowed || pending} onClick={() => void start(false)}>{video || contentId.startsWith('bilibili:') || contentId.startsWith('youtube:') || contentId.startsWith('douyin:') || contentId.startsWith('xiaohongshu:') ? '开始转录视频' : '生成整集字幕'}</Button></>}</div>
    {cloud && !busy && <label className="field-hint transcription-upload-consent"><Checkbox type="checkbox" checked={uploadConsent} onChange={event=>setUploadConsent(event.target.checked)}/>允许将本次音频上传至 {provider} 转录；长音频逐段处理，可能消耗额度。</label>}
    {cloud && <p className="field-hint">已完成片段保存在本机，再次启动时优先复用。</p>}
    {activeBackend==='siliconflow' && <p className="field-hint">生成的是片段字幕，按切分范围跳转，时间并非逐句对齐；已有精确字幕会保留。</p>}
    {ready === false && <p className="field-hint">请先在<a href="/tools#ai/asr">字幕转录设置</a>配置转录引擎、模型或云端凭证。</p>}
    {job && finished(job) && <p className="field-hint" role="status">{job.state === 'failed' && job.failedStage && failureStages[job.failedStage] ? `${failureStages[job.failedStage]}：` : ''}{job.error || stages[job.state]}</p>}
    {error && <p className="subtitle-error" role="alert">{error}<Button variant="secondary" className="button button-secondary" onClick={() => { setError(''); setAttempt(value => value + 1) }}>重试读取状态</Button></p>}
  </div>
}
