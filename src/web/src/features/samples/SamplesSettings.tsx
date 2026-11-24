import { useEffect, useState } from 'react'
import { BookOpen, Circle, CircleCheck } from 'lucide-react'
import { Button, Checkbox } from '../../components/ui'
import { APIError } from '../../shared/api/client'
import {
  canLoadSamples,
  canRemoveSamples,
  loadSamples,
  loadSamplesNow,
  removeSamples,
  samplesSummary,
  setSamplesEnabled,
  type SamplesStatus,
} from './samplesApi'
import './samples.css'

/**
 * SamplesPanel is the presentational surface: it renders the state it is given
 * and delegates every action. Turning the offer off never deletes anything;
 * removal is a separate, confirmed action.
 */
export function SamplesPanel({ status, pending, error, notice, confirmRemove, onToggle, onLoad, onRemove, onAskRemove, onCancelRemove }: {
  status: SamplesStatus | null
  pending: string
  error: string
  notice: string
  confirmRemove: boolean
  onToggle: (enabled: boolean) => void
  onLoad: () => void
  onRemove: () => void
  onAskRemove: () => void
  onCancelRemove: () => void
}) {
  return (
    <section className="samples-settings" aria-label="示例资料" id="settings-samples">
      <header className="samples-head">
        <span className="samples-icon" aria-hidden="true"><BookOpen size={18} strokeWidth={1.8}/></span>
        <div>
          <h2>示例资料</h2>
          <p>内置几份公开文件，让你在资料库为空时也能立刻试读与「原文检索」。{status && ` ${samplesSummary(status)}`}</p>
        </div>
      </header>

      <Checkbox
        label="资料库为空时自动载入示例资料"
        checked={status?.enabled ?? false}
        disabled={!status || pending === 'toggle'}
        onChange={event => onToggle(event.target.checked)}
      />
      <p className="samples-hint">
        关闭只表示以后不再自动载入，不会删除已经载入的资料。自动载入只会发生一次；手动移除后不会再次自动加回。
      </p>

      {status && status.items.length > 0 && (
        <ul className="samples-list" aria-label="示例资料清单">
          {status.items.map(item => (
            <li key={item.id} className={`samples-item${item.present ? ' is-present' : ''}`}>
              <span className="samples-mark" aria-hidden="true">
                {item.present ? <CircleCheck size={15} strokeWidth={1.9}/> : <Circle size={15} strokeWidth={1.5}/>}
              </span>
              <span className="samples-item-body">
                <span className="samples-item-title">{item.title}</span>
                <span className="samples-item-meta">
                  {item.source}
                  {item.note && ` · ${item.note}`}
                  {item.present ? ' · 已在资料库' : ' · 未载入'}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="samples-error" role="alert">{error}</p>}
      {notice && <p className="samples-notice" role="status">{notice}</p>}

      <div className="samples-actions">
        <Button
          variant="secondary"
          type="button"
          disabled={!canLoadSamples(status) || pending !== ''}
          isLoading={pending === 'load'}
          onClick={onLoad}
        >
          立即载入
        </Button>
        {confirmRemove ? (
          <>
            <Button variant="danger" type="button" isLoading={pending === 'remove'} onClick={onRemove}>
              确认移除
            </Button>
            <Button variant="quiet" type="button" onClick={onCancelRemove}>取消</Button>
          </>
        ) : (
          <Button
            variant="quiet"
            type="button"
            disabled={!canRemoveSamples(status) || pending !== ''}
            onClick={onAskRemove}
          >
            移除示例资料
          </Button>
        )}
      </div>
      <p className="samples-foot">
        这些都是公开发布的文件，版权归原发布机构，仅供本机阅读与研究；PDF 会存进你的数据目录，可随时删除。
      </p>
    </section>
  )
}

/** SamplesSettings loads the state and performs the actions. */
export function SamplesSettings({ active = true }: { active?: boolean }) {
  const [status, setStatus] = useState<SamplesStatus | null>(null)
  const [pending, setPending] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)

  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    void loadSamples()
      .then(value => { if (!controller.signal.aborted) setStatus(value) })
      .catch(() => { if (!controller.signal.aborted) setError('无法读取示例资料状态。') })
    return () => controller.abort()
  }, [active])

  async function run(action: 'toggle' | 'load' | 'remove', enabled?: boolean) {
    setPending(action)
    setError('')
    setNotice('')
    try {
      const next = action === 'toggle' && typeof enabled === 'boolean'
        ? await setSamplesEnabled(enabled)
        : action === 'load' ? await loadSamplesNow() : await removeSamples()
      setStatus(next)
      if (action === 'load') setNotice('示例资料已载入，可在「资料库」或「原文检索」中使用。')
      if (action === 'remove') { setNotice('示例资料已从资料库移除。'); setConfirmRemove(false) }
    } catch (cause) {
      setError(cause instanceof APIError ? cause.message : '操作失败，请重试。')
    } finally {
      setPending('')
    }
  }

  return (
    <SamplesPanel
      status={status}
      pending={pending}
      error={error}
      notice={notice}
      confirmRemove={confirmRemove}
      onToggle={enabled => void run('toggle', enabled)}
      onLoad={() => void run('load')}
      onRemove={() => void run('remove')}
      onAskRemove={() => setConfirmRemove(true)}
      onCancelRemove={() => setConfirmRemove(false)}
    />
  )
}