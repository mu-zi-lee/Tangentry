import { Button, Checkbox, Dialog, Input, Select } from '../../components/ui'
import { AlertCircle, ArrowUpDown, BookOpenText, ChevronDown, ChevronRight, CircleCheck, FolderInput, FolderPlus, KeyRound, LoaderCircle, Pencil, RefreshCw, Search, Settings2, SlidersHorizontal, Timer, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { request } from '../../shared/api/client'
import type { SubscriptionGroup, SubscriptionSource } from '../../shared/api/types'
import type { useSubscriptions } from './useSubscriptions'
import type { useSubscriptionGroups } from './useSubscriptionGroups'
import { SubscriptionSourceIcon } from './SubscriptionSourceIcon'
import { SubscriptionPortability } from './SubscriptionPortability'
import { sourceLabel } from './sourcePresentation'
import { formatTime, healthLabels, healthTone, matchesManageFilter, needsAttention, refreshIntervals, refreshLabel, relativeTime, type ManageFilter } from './sourceHealth'
import { sourceSections, visibleSourceIDs } from './sourceSections'
import { toggleSelection } from './selectionRange'
import { useCollapsedGroups } from './useCollapsedGroups'

type State = ReturnType<typeof useSubscriptions>
type Groups = ReturnType<typeof useSubscriptionGroups>
type CredentialsState = { platform: string; configured: boolean; updatedAt: number; expiresAt?: number }
type Sort = 'default' | 'name' | 'updated' | 'health'

const platformNames: Record<string, string> = { bilibili: 'B站', youtube: 'YouTube', xiaoyuzhou: '小宇宙', xiaohongshu: '小红书', linuxdo: 'Linux.do', douyin: '抖音' }
const batchVerbs: Record<string, string> = { update: '更新', delete: '移除', move: '移动', 'refresh-policy': '修改自动更新' }

/** Login state folds into one toolbar menu; only an expired login draws attention. */
function CredentialMenu() {
  const [states, setStates] = useState<CredentialsState[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void request<{ platforms: CredentialsState[] }>('/settings/cookies', { signal: controller.signal }).then(value => setStates(value.platforms)).catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => controller.abort()
  }, [])
  if (failed) return null
  const now = Math.floor(Date.now() / 1000)
  const expired = (state: CredentialsState) => Boolean(state.configured && state.expiresAt && state.expiresAt <= now)
  const connected = states?.filter(state => state.configured && !expired(state)).length ?? 0
  const attention = states?.filter(expired).length ?? 0
  return <details className="subscription-more subscription-credentials">
    <summary className="button button-secondary" data-tone={attention ? 'attention' : undefined} title="平台登录状态"><KeyRound size={14} aria-hidden="true"/>平台登录{states && <small>{attention ? `${attention} 个过期` : `${connected}/${states.length}`}</small>}</summary>
    <div className="subscription-more-panel">
      <h3>平台登录</h3>
      <p className="subscription-credentials-note">B站和 YouTube 公开频道无需登录即可订阅；登录只用于需要账号的额外能力。</p>
      {!states ? <p className="field-hint">正在读取…</p> : <ul role="list">{states.map(state => {
        const label = !state.configured ? '未连接' : expired(state) ? '已过期' : '已连接'
        return <li key={state.platform} data-state={expired(state) ? 'expired' : state.configured ? 'connected' : 'off'}>
          <span className="subscription-credential-dot" aria-hidden="true"/><span>{platformNames[state.platform] ?? state.platform}</span><small>{label}{state.configured && state.updatedAt ? ` · ${formatTime(state.updatedAt)}` : ''}</small>
        </li>
      })}</ul>}
      <a className="text-button" href="/tools#accounts">管理登录</a>
    </div>
  </details>
}

function GroupHeader({ group, count, attention, expanded, onToggle, state, sourceBusy, listID }: { group: SubscriptionGroup; count: number; attention: number; expanded: boolean; onToggle: () => void; state: Groups; sourceBusy: boolean; listID: string }) {
  const [mode, setMode] = useState<'rename' | 'delete' | null>(null)
  const [draft, setDraft] = useState(group.name)
  const [baseline, setBaseline] = useState(group)
  const input = useRef<HTMLInputElement>(null)
  const renameButton = useRef<HTMLButtonElement>(null)
  const busy = Boolean(state.pending) || state.loading || Boolean(state.listError) || sourceBusy
  useEffect(() => { if (mode === 'rename') input.current?.select() }, [mode])
  const changed = baseline.revision !== group.revision
  const error = state.error?.id === group.id ? state.error.message : ''
  const close = () => { setMode(null); requestAnimationFrame(() => renameButton.current?.focus()) }
  return <div className="subscription-manage-group-header">
    {mode === 'rename' ? <form className="subscription-group-rename" onSubmit={event => { event.preventDefault(); void state.rename(baseline, draft).then(ok => { if (ok) close() }) }} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}>
      <Input ref={input} aria-label={`分组新名称 ${group.name}`} value={draft} onChange={event => setDraft(event.target.value)} maxLength={120} required/>
      <Button className="button button-secondary" variant="secondary" disabled={busy || !draft.trim() || [...draft.trim()].length > 60 || changed}>保存分组名称</Button>
      <Button variant="quiet" iconOnly type="button" className="icon-button" aria-label="取消修改分组" disabled={busy} onClick={close}><X size={15} aria-hidden="true"/></Button>
    </form> : <Button variant="quiet" className="subscription-manage-group-toggle" aria-expanded={expanded} aria-controls={listID} onClick={onToggle}>
      {expanded ? <ChevronDown size={15} aria-hidden="true"/> : <ChevronRight size={15} aria-hidden="true"/>}
      <h3>{group.name}</h3><span className="count">{count} 个来源</span>
      {attention > 0 && <span className="subscription-health-badge" data-tone="attention">{attention} 个需处理</span>}
    </Button>}
    {!mode && <div className="subscription-manage-group-tools">
      <Button ref={renameButton} variant="quiet" iconOnly className="icon-button" aria-label={`重命名分组 ${group.name}`} title="重命名分组" disabled={busy} onClick={() => { setBaseline(group); setDraft(group.name); setMode('rename') }}><Pencil size={14} aria-hidden="true"/></Button>
      <Button variant="quiet" iconOnly className="icon-button" aria-label={`解散分组 ${group.name}`} title="解散分组" disabled={busy} onClick={() => { setBaseline(group); setMode('delete') }}><Trash2 size={14} aria-hidden="true"/></Button>
    </div>}
    {mode === 'delete' && <div className="subscription-group-confirm" role="group" aria-label={`确认解散分组 ${group.name}`}>
      <p>解散「{group.name}」？其中 {count} 个来源会回到未分组，内容和阅读记录保留。</p>
      <Button className="button button-secondary" variant="secondary" autoFocus disabled={busy} onClick={close}>保留分组</Button>
      <Button className="button button-danger" variant="danger" disabled={busy || changed} onClick={() => void state.remove(baseline)}>确认解散</Button>
    </div>}
    {mode && changed && <p className="subscription-group-feedback" role="status">分组已在其他页面更新。<Button variant="quiet" className="text-button" onClick={() => setBaseline(group)}>使用当前版本</Button></p>}
    {error && <p className="subscription-group-feedback" role="alert">{error}</p>}
  </div>
}

export function SubscriptionManager({ state, groups, focusAttention, onOpenSource, onReadSource, onAdd }: {
  state: State
  groups: Groups
  focusAttention: boolean
  onOpenSource: (source: SubscriptionSource) => void
  onReadSource: (id: string) => void
  onAdd: () => void
}) {
  const [keyword, setKeyword] = useState('')
  const [filter, setFilter] = useState<ManageFilter>(focusAttention ? 'attention' : 'all')
  const [sort, setSort] = useState<Sort>('default')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [confirmBatchRemove, setConfirmBatchRemove] = useState(false)
  const [showFailures, setShowFailures] = useState(false)
  const anchor = useRef<string | null>(null)
  const createTrigger = useRef<HTMLButtonElement>(null)
  const newGroupInput = useRef<HTMLInputElement>(null)
  const { collapsed, toggle } = useCollapsedGroups()
  useEffect(() => { if (focusAttention) setFilter('attention') }, [focusAttention])
  useEffect(() => { if (creating) newGroupInput.current?.focus() }, [creating])
  useEffect(() => { setSelected(current => { const valid = new Set(state.sources.map(source => source.id)); const next = new Set([...current].filter(id => valid.has(id))); return next.size === current.size ? current : next }) }, [state.sources])

  const counts = useMemo(() => ({
    all: state.sources.length,
    attention: state.sources.filter(needsAttention).length,
    automatic: state.sources.filter(source => source.refresh.enabled).length,
    manual: state.sources.filter(source => !source.refresh.enabled).length,
  }), [state.sources])
  const sorted = useMemo(() => {
    if (sort === 'default') return state.sources
    const order = (source: SubscriptionSource) => healthTone(source.refresh.status) === 'attention' ? 0 : source.refresh.status === 'never_checked' ? 1 : 2
    return [...state.sources].sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : sort === 'updated' ? b.lastUpdatedAt - a.lastUpdatedAt : order(a) - order(b) || b.refresh.failures - a.refresh.failures)
  }, [state.sources, sort])
  const sections = useMemo(() => sourceSections(sorted, groups.groups, keyword, source => matchesManageFilter(source, filter)), [sorted, groups.groups, keyword, filter])
  const narrowed = Boolean(keyword.trim()) || filter !== 'all'
  const shownSections = sections.filter(section => !narrowed || section.visible.length > 0)
  const visibleIds = useMemo(() => visibleSourceIDs(sections.filter(section => !collapsed.has(section.id || '__ungrouped') || narrowed)), [sections, collapsed, narrowed])
  const selectedIds = [...selected]
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selected.has(id))
  const someVisibleSelected = visibleIds.some(id => selected.has(id))
  const groupBusy = groups.loading || Boolean(groups.listError) || Boolean(groups.pending)
  const batch = state.batch
  const batchBusy = Boolean(batch?.running)
  const actionBusy = groupBusy || batchBusy || Boolean(state.pending) || state.loading || Boolean(state.listError)
  const clearSelection = () => { setSelected(new Set()); anchor.current = null }
  const closeCreate = () => { setCreating(false); setGroupName(''); requestAnimationFrame(() => createTrigger.current?.focus({ preventScroll: true })) }

  const runBatchUpdate = async () => { if (await state.batchUpdate(selectedIds)) clearSelection() }
  const runBatchMove = async (value: string) => { if (!value) return; if (await state.batchMove(selectedIds, value === '__ungrouped' ? '' : value)) clearSelection() }
  const runBatchRefresh = async (value: string) => {
    if (!value) return
    const enabled = value !== 'manual'
    const interval = enabled ? Number(value) : state.sources.find(source => source.id === selectedIds[0])?.refresh.intervalSeconds ?? 3600
    if (await state.batchConfigureRefresh(selectedIds, enabled, interval)) clearSelection()
  }
  const runBatchRemove = async () => { setConfirmBatchRemove(false); if (await state.batchRemove(selectedIds)) clearSelection() }
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || !selected.size) return
    const target = event.target as HTMLElement
    if (target.matches('input:not([type="checkbox"]), select, textarea')) return
    event.preventDefault()
    clearSelection()
  }

  const row = (source: SubscriptionSource) => {
    const tone = healthTone(source.refresh.status)
    const updating = state.pending?.kind === 'update' && state.pending.id === source.id || source.active
    const failure = batch && !batch.running ? batch.failures[source.id] : ''
    return <li key={source.id} className="subscription-manage-row" data-selected={selected.has(source.id)} data-tone={tone}>
      <Checkbox className="subscription-manage-check" checked={selected.has(source.id)} aria-label={`选择来源 ${source.name}`} onChange={event => { setSelected(toggleSelection(selected, visibleIds, source.id, (event.nativeEvent as MouseEvent).shiftKey, anchor.current)); anchor.current = source.id }}/>
      <Button variant="quiet" className="subscription-manage-name" aria-haspopup="dialog" title="打开来源设置" onClick={() => onOpenSource(source)}>
        <SubscriptionSourceIcon source={source} size={16}/>
        <span><strong>{source.name}</strong><small>{sourceLabel(source)}</small></span>
      </Button>
      <span className="subscription-manage-status">
        {updating ? <span className="subscription-health-badge" data-tone="active"><LoaderCircle size={11} className="spin" aria-hidden="true"/>更新中</span> : <span className="subscription-health-badge" data-tone={tone}>{healthLabels[source.refresh.status]}</span>}
      </span>
      <span className="subscription-manage-updated" title={formatTime(source.lastUpdatedAt, '尚未更新')}><span className="visually-hidden">最近更新：</span>{relativeTime(source.lastUpdatedAt)}{source.lastUpdatedAt > 0 && <small>{source.itemCount} 条</small>}</span>
      <span className="subscription-manage-refresh"><Timer size={13} aria-hidden="true"/><span className="visually-hidden">自动更新：</span>{refreshLabel(source)}</span>
      <span className="subscription-manage-actions">
        <Button variant="quiet" iconOnly className="icon-button" aria-label={`更新 ${source.name}`} title="立即更新" disabled={actionBusy || source.active} onClick={() => void state.update(source.id)}>{updating ? <LoaderCircle size={15} className="spin" aria-hidden="true"/> : <RefreshCw size={15} aria-hidden="true"/>}</Button>
        <Button variant="quiet" iconOnly className="icon-button" aria-label={`在阅读中打开 ${source.name}`} title="阅读这个来源" onClick={() => onReadSource(source.id)}><BookOpenText size={15} aria-hidden="true"/></Button>
        <Button variant="quiet" iconOnly className="icon-button" aria-label={`设置 ${source.name}`} title="来源设置" aria-haspopup="dialog" onClick={() => onOpenSource(source)}><Settings2 size={15} aria-hidden="true"/></Button>
      </span>
      {(tone === 'attention' && (source.refresh.message || source.refresh.suggestedAction) || failure) && <p className="subscription-manage-issue">
        <AlertCircle size={13} aria-hidden="true"/>
        <span>{failure || source.refresh.message}{!failure && source.refresh.suggestedAction && <em> 建议：{source.refresh.suggestedAction}</em>}</span>
      </p>}
    </li>
  }

  return <section className="subscription-manager" aria-labelledby="subscription-manager-title" onKeyDown={onKeyDown}>
    <h2 id="subscription-manager-title" className="visually-hidden">管理来源</h2>
    <div className="subscription-manage-toolbar">
      <label className="subscription-input subscription-manage-search">
        <Search size={15} aria-hidden="true"/><span className="visually-hidden">搜索来源</span>
        <Input type="search" aria-label="搜索来源" placeholder="按名称、平台或分组查找" value={keyword} onChange={event => setKeyword(event.target.value)} onKeyDown={event => { if (event.key === 'Escape' && keyword) { event.stopPropagation(); setKeyword('') } }}/>
      </label>
      <div className="subscription-read-filters subscription-manage-filters" role="group" aria-label="按状态筛选来源">
        {([['all', '全部'], ['attention', '需处理'], ['automatic', '自动更新'], ['manual', '手动']] as const).map(([value, label]) => <Button key={value} variant="quiet" aria-pressed={filter === value} data-tone={value === 'attention' && counts.attention ? 'attention' : undefined} onClick={() => setFilter(value)}>{label}<span className="count">{counts[value]}</span></Button>)}
      </div>
      <div className="subscription-manage-toolbar-end">
        <label className="subscription-manage-sort"><ArrowUpDown size={14} aria-hidden="true"/><span className="visually-hidden">来源排序</span><Select aria-label="来源排序" value={sort} onChange={event => setSort(event.target.value as Sort)}><option value="default">默认顺序</option><option value="name">按名称</option><option value="updated">最近更新</option><option value="health">问题优先</option></Select></label>
        <Button className="button button-secondary" ref={createTrigger} variant="secondary" disabled={groupBusy} aria-expanded={creating} aria-controls="subscription-group-create" onClick={() => creating ? closeCreate() : setCreating(true)}><FolderPlus size={15} aria-hidden="true"/>新建分组</Button>
        <CredentialMenu/>
        <details className="subscription-more">
          <summary className="button button-secondary" title="用 OPML 导入或导出"><SlidersHorizontal size={15} aria-hidden="true"/>导入 / 导出</summary>
          <div className="subscription-more-panel"><SubscriptionPortability/></div>
        </details>
      </div>
    </div>

    {creating && <form id="subscription-group-create" className="subscription-group-create" onSubmit={event => { event.preventDefault(); void groups.create(groupName).then(ok => { if (ok) closeCreate() }) }} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closeCreate() } }}>
      <label className="subscription-field"><span>分组名称（最多 60 字）</span><Input ref={newGroupInput} aria-label="新分组名称" value={groupName} maxLength={120} onChange={event => setGroupName(event.target.value)} required placeholder="例如：科技、日常、播客"/></label>
      <Button className="button button-primary" variant="primary" disabled={groupBusy || !groupName.trim() || [...groupName.trim()].length > 60}>创建分组</Button>
      <Button variant="quiet" type="button" className="text-button" disabled={Boolean(groups.pending)} onClick={closeCreate}>取消</Button>
      {groups.error?.kind === 'create' && <p className="subscription-group-feedback" role="alert">{groups.error.message}</p>}
    </form>}
    {groups.loading && !groups.groups.length && <p className="field-hint" role="status">正在读取分组…</p>}
    {groups.listError && <p className="subscription-group-feedback" role="alert">{groups.listError}<Button variant="quiet" className="text-button" onClick={() => void groups.reload()}>重新加载分组</Button></p>}

    {state.sources.length > 0 && <div className="subscription-manage-list-head">
      <label className="subscription-manage-select-all">
        <Checkbox checked={allVisibleSelected} ref={input => { if (input) input.indeterminate = someVisibleSelected && !allVisibleSelected }} aria-label="全选当前来源" disabled={!visibleIds.length} onChange={() => setSelected(allVisibleSelected ? new Set([...selected].filter(id => !visibleIds.includes(id))) : new Set([...selected, ...visibleIds]))}/>
        <span>{selected.size ? `已选 ${selected.size} 个` : narrowed ? `显示 ${visibleSourceIDs(sections).length} / ${state.sources.length} 个来源` : `${state.sources.length} 个来源`}</span>
      </label>
      <span className="subscription-manage-columns" aria-hidden="true"><span>状态</span><span>最近更新</span><span>自动更新</span><span/></span>
    </div>}

    {shownSections.map(section => {
      const key = section.id || '__ungrouped'
      const expanded = narrowed || !collapsed.has(key)
      const listID = `subscription-manage-group-${key}`
      const attention = section.members.filter(needsAttention).length
      return <section className="subscription-manage-group" key={key} aria-label={section.kind === 'group' ? `分组 ${section.name}` : section.name}>
        {section.group ? <GroupHeader group={section.group} count={section.members.length} attention={attention} expanded={expanded} onToggle={() => toggle(key)} state={groups} sourceBusy={state.loading || Boolean(state.listError) || Boolean(state.pending)} listID={listID}/>
          : <div className="subscription-manage-group-header"><Button variant="quiet" className="subscription-manage-group-toggle" aria-expanded={expanded} aria-controls={listID} onClick={() => toggle(key)}>{expanded ? <ChevronDown size={15} aria-hidden="true"/> : <ChevronRight size={15} aria-hidden="true"/>}<h3>{section.name}</h3><span className="count">{section.members.length} 个来源</span></Button></div>}
        {expanded && <ul role="list" id={listID} className="subscription-manage-rows">
          {section.visible.map(row)}
          {section.kind === 'group' && !section.members.length && <li className="subscription-manage-empty-group">空分组。勾选来源后用“移动到分组”把它们放进来。</li>}
        </ul>}
      </section>
    })}

    {state.loading && !state.sources.length && <p className="field-hint" role="status">正在加载来源…</p>}
    {narrowed && !visibleSourceIDs(sections).length && state.sources.length > 0 && <div className="subscription-empty"><h3>{filter === 'attention' && !keyword ? '所有来源都在正常同步' : '没有匹配的来源'}</h3><p>{filter === 'attention' && !keyword ? '失败时会保留上次成功的内容，出现问题会在这里提示。' : '换个关键词，或切换状态筛选。'}</p><Button className="button button-secondary" variant="secondary" onClick={() => { setKeyword(''); setFilter('all') }}>显示全部来源</Button></div>}
    {!state.loading && !state.listError && !state.sources.length && <div className="subscription-empty"><h3>还没有订阅来源</h3><p>添加来源后，可以在这里分组、调整自动更新并查看同步状态。</p><Button className="button button-primary" variant="primary" onClick={onAdd}>添加订阅</Button></div>}

    {(selected.size > 0 || batch && batch.kind !== 'update' && (batch.running || batch.failed > 0)) && <div className="subscription-batch-bar" role="toolbar" aria-label="批量管理来源">
      {batch && batch.kind !== 'update' && (batch.running || batch.failed > 0) ? <div className="subscription-batch-bar-progress" role="status">
        {batch.running ? <><LoaderCircle size={14} className="spin" aria-hidden="true"/>正在{batchVerbs[batch.kind]} {batch.completed}/{batch.total}</> : <><AlertCircle size={14} aria-hidden="true"/>{batch.total - batch.failed}/{batch.total} 个已{batchVerbs[batch.kind]}，{batch.failed} 个失败<Button variant="quiet" className="text-button" aria-expanded={showFailures} onClick={() => setShowFailures(value => !value)}>{showFailures ? '收起' : '查看原因'}</Button></>}
      </div> : <strong className="subscription-batch-count">已选 {selected.size} 个来源</strong>}
      {selected.size > 0 && <div className="subscription-batch-actions">
        <Button className="button button-secondary" variant="secondary" disabled={actionBusy} onClick={() => void runBatchUpdate()}><RefreshCw size={14} aria-hidden="true"/>更新</Button>
        <label className="subscription-batch-select"><FolderInput size={14} aria-hidden="true"/><span className="visually-hidden">批量移动分组</span><Select aria-label="批量移动分组" disabled={actionBusy} value="" onChange={event => void runBatchMove(event.target.value)}><option value="">移动到分组…</option><option value="__ungrouped">未分组</option>{groups.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</Select></label>
        <label className="subscription-batch-select"><Timer size={14} aria-hidden="true"/><span className="visually-hidden">批量修改刷新间隔</span><Select aria-label="批量修改刷新间隔" disabled={actionBusy} value="" onChange={event => void runBatchRefresh(event.target.value)}><option value="">自动更新…</option>{refreshIntervals.map(([value, label]) => <option key={value} value={value}>每 {label}</option>)}<option value="manual">改为手动更新</option></Select></label>
        <Button variant="secondary" className="button button-secondary subscription-danger-button" disabled={actionBusy} onClick={() => setConfirmBatchRemove(true)}><Trash2 size={14} aria-hidden="true"/>移除…</Button>
        <Button variant="quiet" iconOnly className="icon-button" aria-label="清除选择" title="清除选择（Esc）" onClick={clearSelection}><X size={15} aria-hidden="true"/></Button>
      </div>}
      {showFailures && batch && !batch.running && batch.failed > 0 && <ul className="subscription-batch-failures" role="list">{Object.entries(batch.failures).map(([id, text]) => <li key={id}><strong>{state.sources.find(source => source.id === id)?.name ?? id}</strong>{text}</li>)}</ul>}
    </div>}

    <Dialog open={confirmBatchRemove} onClose={() => setConfirmBatchRemove(false)} title={`移除 ${selected.size} 个来源`} className="subscription-confirm-dialog">
      <p>将停止跟踪这些来源并清除它们的最新内容缓存。历史收件箱、收藏、下载和笔记都会保留。</p>
      <ul className="subscription-confirm-list" role="list">{selectedIds.slice(0, 8).map(id => <li key={id}>{state.sources.find(source => source.id === id)?.name ?? id}</li>)}{selectedIds.length > 8 && <li>以及另外 {selectedIds.length - 8} 个</li>}</ul>
      <div className="subscription-confirm-actions">
        <Button className="button button-secondary" variant="secondary" autoFocus onClick={() => setConfirmBatchRemove(false)}>取消</Button>
        <Button className="button button-danger" variant="danger" disabled={actionBusy} onClick={() => void runBatchRemove()}><Trash2 size={14} aria-hidden="true"/>移除 {selected.size} 个来源</Button>
      </div>
    </Dialog>
    {counts.attention === 0 && state.sources.length > 0 && filter === 'all' && !keyword && <p className="subscription-manage-footnote"><CircleCheck size={14} aria-hidden="true"/>{state.sources.length} 个来源同步正常，{counts.automatic} 个自动更新。更新失败时会保留上次成功的内容。</p>}
  </section>
}
