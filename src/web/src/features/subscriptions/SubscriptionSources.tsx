import { Button, Checkbox, Input, Select } from '../../components/ui'
import { AlertCircle, Folder, LoaderCircle, Pencil, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { SubscriptionGroup, SubscriptionSource } from '../../shared/api/types'
import { sourceLabel } from './sourcePresentation'
import type { useSubscriptions } from './useSubscriptions'
import type { useSubscriptionGroups } from './useSubscriptionGroups'
import { SubscriptionSourceIcon } from './SubscriptionSourceIcon'
import { toggleSelection } from './selectionRange'
import { allSubscriptionsID } from './useSubscriptions'

const collapseKey = 'tangentry-subscription-collapsed-groups'
type Groups = ReturnType<typeof useSubscriptionGroups>

function GroupEditor({group, state, sourceBusy}: {group: SubscriptionGroup; state: Groups; sourceBusy: boolean}) {
  const [mode, setMode] = useState<'rename' | 'delete' | null>(null)
  const [draft, setDraft] = useState(group.name)
  const [baseline, setBaseline] = useState(group)
  const input = useRef<HTMLInputElement>(null)
  const busy = Boolean(state.pending) || state.loading || Boolean(state.listError) || sourceBusy
  useEffect(() => { if (mode === 'rename') input.current?.focus() }, [mode])
  const changed = baseline.revision !== group.revision
  const error = state.error?.id === group.id ? state.error.message : ''
  return <div className="subscription-group-editor">
    <div className="subscription-group-tools"><Button variant="quiet" iconOnly className="icon-button" aria-label={`重命名分组 ${group.name}`} disabled={busy} onClick={() => { setBaseline(group); setDraft(group.name); setMode('rename') }}><Pencil size={14} aria-hidden="true" /></Button><Button variant="quiet" iconOnly className="icon-button" aria-label={`解散分组 ${group.name}`} disabled={busy} onClick={() => { setBaseline(group); setMode('delete') }}><Trash2 size={14} aria-hidden="true" /></Button></div>
    {mode === 'rename' && <form onSubmit={event => { event.preventDefault(); void state.rename(baseline, draft).then(ok => { if (ok) setMode(null) }) }}><label className="subscription-field"><span>分组新名称</span><div className="subscription-input"><Input ref={input} aria-label={`分组新名称 ${group.name}`} value={draft} onChange={event => setDraft(event.target.value)} maxLength={120} required /></div></label><div className="subscription-group-form-actions"><Button variant="secondary" className="button button-secondary" disabled={busy || !draft.trim() || [...draft.trim()].length > 60 || changed}>保存分组名称</Button><Button variant="quiet" iconOnly type="button" className="icon-button" aria-label="取消修改分组" disabled={busy} onClick={() => setMode(null)}><X size={15} aria-hidden="true" /></Button></div></form>}
    {mode === 'delete' && <div className="subscription-group-confirm"><p>解散「{group.name}」？来源将回到未分组，内容和阅读记录保留。</p><div className="subscription-group-form-actions"><Button variant="secondary" className="button button-secondary" disabled={busy || changed} onClick={() => void state.remove(baseline)}>确认解散</Button><Button variant="quiet" className="text-button" disabled={busy} onClick={() => setMode(null)}>保留分组</Button></div></div>}
    {mode && changed && <p className="subscription-group-feedback" role="status">分组已在其他页面更新。<Button variant="quiet" className="text-button" onClick={() => setBaseline(group)}>使用当前版本</Button></p>}
    {error && <p className="subscription-group-feedback" role="alert">{error}</p>}
  </div>
}

export function SubscriptionSources({state, groups, onSelect}: {state: ReturnType<typeof useSubscriptions>; groups: Groups; onSelect?: () => void}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const anchor = useRef<string | null>(null)
  const newName = useRef<HTMLInputElement>(null)
  const createTrigger = useRef<HTMLButtonElement>(null)
  const closeCreate = () => { setAdding(false); requestAnimationFrame(() => createTrigger.current?.focus({preventScroll:true})) }
  const [collapsed, setCollapsed] = useState<Set<string>>(() => { try { const value: unknown = JSON.parse(sessionStorage.getItem(collapseKey) ?? '[]'); return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []) } catch { return new Set() } })
  useEffect(() => { try { sessionStorage.setItem(collapseKey, JSON.stringify([...collapsed])) } catch { /* Navigation works without session storage. */ } }, [collapsed])
  const selectedGroup = state.sources.find(source => source.id === state.selectedId)?.groupId
  useEffect(() => { if (selectedGroup) setCollapsed(current => { if (!current.has(selectedGroup)) return current; const next = new Set(current); next.delete(selectedGroup); return next }) }, [selectedGroup, state.selectedId])
  useEffect(() => { setSelected(current => { const valid = new Set(state.sources.map(source => source.id)); const next = new Set([...current].filter(id => valid.has(id))); return next.size === current.size ? current : next }) }, [state.sources])
  useEffect(() => { if (adding) newName.current?.focus() }, [adding])
  const knownGroups = useMemo(() => new Set(groups.groups.map(group => group.id)), [groups.groups])
  const keyword = filter.trim().toLocaleLowerCase()
  const matches = (source: SubscriptionSource, groupName = '') => !keyword || `${source.name} ${sourceLabel(source)} ${groupName}`.toLocaleLowerCase().includes(keyword)
  const sourceButton = (source: SubscriptionSource) => <div key={source.id} className={`subscription-source-row ${selected.has(source.id) ? 'selected' : ''}`}>
    <Checkbox className="subscription-source-check" type="checkbox" checked={selected.has(source.id)} aria-label={`选择来源 ${source.name}`} onChange={event => { const next = toggleSelection(selected, visibleIds, source.id, (event.nativeEvent as MouseEvent).shiftKey, anchor.current); anchor.current = source.id; setSelected(next) }} />
    <Button variant="quiet" className={`subscription-source ${source.id === state.selectedId ? 'active' : ''}`} aria-current={source.id === state.selectedId ? 'true' : undefined} title={source.name} onClick={() => { state.select(source.id); onSelect?.() }}><SubscriptionSourceIcon source={source}/><strong>{source.name}</strong><span className="subscription-source-platform"><span>{sourceLabel(source)}</span>{source.active ? <span className="subscription-source-health" data-active="true"><LoaderCircle size={11} className="spin" aria-hidden="true"/>更新中</span> : !['healthy', 'never_checked', 'paused'].includes(source.refresh.status) && <span className="subscription-source-health" title={source.refresh.message}><AlertCircle size={11} aria-hidden="true"/>需处理</span>}</span><small>{source.lastUpdatedAt ? `${source.itemCount} 条` : '未更新'}</small></Button>
  </div>
  const ungrouped = state.sources.filter(source => !source.groupId)
  const unresolved = state.sources.filter(source => source.groupId && !knownGroups.has(source.groupId))
  const visibleIds = useMemo(() => {
    const ids: string[] = []
    for (const group of groups.groups) for (const source of state.sources) if (source.groupId === group.id && matches(source, group.name)) ids.push(source.id)
    for (const source of [...ungrouped, ...unresolved]) if (matches(source)) ids.push(source.id)
    return ids
  }, [groups.groups, state.sources, keyword])
  const selectedVisible = visibleIds.filter(id => selected.has(id))
  const allVisibleSelected = visibleIds.length > 0 && selectedVisible.length === visibleIds.length
  const groupBusy = groups.loading || Boolean(groups.listError) || Boolean(groups.pending)
  const batchBusy = Boolean(state.batch?.running)
  const actionBusy = groupBusy || batchBusy || Boolean(state.pending)
  const reload = () => { void state.reload(); void groups.reload() }
  const clearSelection = () => { setSelected(new Set()); anchor.current = null }
  const batchDelete = async () => { if (!selectedVisible.length || !window.confirm(`确认移除选中的 ${selectedVisible.length} 个来源？`)) return; if (await state.batchRemove(selectedVisible)) clearSelection() }
  const batchUpdate = async () => { if (await state.batchUpdate(selectedVisible)) clearSelection() }
  const batchMove = async (event: React.ChangeEvent<HTMLSelectElement>) => { const groupId = event.target.value; if (!groupId) return; if (await state.batchMove(selectedVisible, groupId === '__ungrouped' ? '' : groupId)) clearSelection(); event.target.value = '' }
  const batchRefresh = async (event: React.ChangeEvent<HTMLSelectElement>) => { const interval = Number(event.target.value); if (!interval) return; if (await state.batchConfigureRefresh(selectedVisible, true, interval)) clearSelection(); event.target.value = '' }
  return <aside className="subscription-sources" aria-label="已保存来源">
    <div className="subscription-section-heading"><h2>我的来源 <span className="count">{state.sources.length}</span></h2><div className="subscription-source-tools"><Button variant="quiet" iconOnly ref={createTrigger} className="icon-button" disabled={groupBusy} aria-label="新建来源分组" onClick={() => { if (adding) closeCreate(); else setAdding(true) }}><Plus size={16} aria-hidden="true" /></Button><Button variant="quiet" iconOnly className="icon-button" disabled={state.loading || Boolean(state.pending) || Boolean(groups.pending)} aria-label="重新加载来源" onClick={reload}><RefreshCw size={16} aria-hidden="true" /></Button></div></div>
    {adding && <form className="subscription-group-create" onSubmit={event => { event.preventDefault(); void groups.create(name).then(ok => { if (ok) { setName(''); closeCreate() } }) }}><label className="subscription-field"><span>分组名称（最多 60 字）</span><div className="subscription-input"><Input ref={newName} aria-label="新分组名称" value={name} maxLength={120} onChange={event => setName(event.target.value)} required placeholder="例如：科技、日常、播客" /></div></label><div className="subscription-group-form-actions"><Button variant="secondary" className="button button-secondary" disabled={groupBusy || !name.trim() || [...name.trim()].length > 60}>创建分组</Button><Button variant="quiet" iconOnly className="icon-button" type="button" aria-label="取消创建分组" disabled={Boolean(groups.pending)} onClick={closeCreate}><X size={15} aria-hidden="true" /></Button></div>{groups.error?.kind === 'create' && <p className="subscription-group-feedback" role="alert">{groups.error.message}</p>}</form>}
    <label className="subscription-field subscription-source-search"><span className="sr-only">筛选订阅来源</span><div className="subscription-input"><Search size={14} aria-hidden="true"/><Input type="search" aria-label="筛选订阅来源" placeholder="找来源或分组" value={filter} onChange={event => setFilter(event.target.value)} /></div></label>
    {state.sources.length > 0 && <div className="subscription-batch-toolbar" aria-label="批量管理来源">
      <label className="subscription-batch-select-all"><Checkbox type="checkbox" checked={allVisibleSelected} ref={input => { if (input) input.indeterminate = selectedVisible.length > 0 && !allVisibleSelected }} aria-label="全选当前来源" onChange={() => setSelected(allVisibleSelected ? new Set([...selected].filter(id => !visibleIds.includes(id))) : new Set([...selected, ...visibleIds]))} /><span>{selected.size ? `已选 ${selected.size}` : '选择来源'}</span></label>
      {selected.size > 0 && <><Button variant="quiet" className="text-button" disabled={actionBusy} onClick={batchUpdate}><RefreshCw size={14} aria-hidden="true" />批量更新</Button><Button variant="danger" className="text-button danger" disabled={actionBusy} onClick={() => void batchDelete()}><Trash2 size={14} aria-hidden="true" />批量移除</Button><label className="subscription-batch-select"><span className="sr-only">批量移动分组</span><Select disabled={actionBusy} defaultValue="" onChange={event => void batchMove(event)} aria-label="批量移动分组"><option value="">移动到分组</option><option value="__ungrouped">未分组</option>{groups.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</Select></label><label className="subscription-batch-select"><span className="sr-only">批量修改刷新间隔</span><Select disabled={actionBusy} defaultValue="" onChange={event => void batchRefresh(event)} aria-label="批量修改刷新间隔"><option value="">修改刷新间隔</option><option value="900">15 分钟</option><option value="3600">1 小时</option><option value="7200">2 小时</option><option value="21600">6 小时</option><option value="86400">1 天</option></Select></label><Button variant="quiet" iconOnly className="icon-button" disabled={actionBusy} aria-label="清除选择" title="清除选择" onClick={clearSelection}><X size={14} aria-hidden="true" /></Button></>}
    </div>}
    {state.loading && <p role="status" className="field-hint">正在加载来源…</p>}
    {groups.loading && <p className="field-hint" role="status">正在读取分组…</p>}
    {groups.listError && <p className="subscription-group-feedback" role="alert">{groups.listError}<Button variant="quiet" className="text-button" onClick={reload}>重新加载分组</Button></p>}
    {groups.notice && <p className="subscription-group-feedback" role="status">{groups.notice}</p>}
    <nav aria-label="选择订阅来源">
      <Button variant="quiet" className={`subscription-all-sources ${state.selectedId === allSubscriptionsID ? 'active' : ''}`} aria-current={state.selectedId === allSubscriptionsID ? 'true' : undefined} onClick={() => { state.select(allSubscriptionsID); onSelect?.() }}>
        <span className="subscription-all-sources-icon" aria-hidden="true"><Folder size={16}/></span>
        <span><strong>全部订阅</strong><small>所有来源的最新内容</small></span>
        <b>{state.sources.length}</b>
      </Button>
      {groups.groups.map(group => {
        const members = state.sources.filter(source => source.groupId === group.id)
        const visible = members.filter(source => matches(source, group.name))
        return <details className="subscription-source-group" key={group.id} open={keyword !== '' || !collapsed.has(group.id)} onToggle={event => { if (keyword) return; const open = event.currentTarget.open; setCollapsed(current => { if (current.has(group.id) === !open) return current; const next = new Set(current); if (open) next.delete(group.id); else next.add(group.id); return next }) }}>
          <summary aria-label={`分组 ${group.name}，${members.length} 个来源`}><Folder size={15} aria-hidden="true" /><span>{group.name}</span><span className="count">{members.length}</span></summary>
          <div className="subscription-group-members">{visible.map(sourceButton)}{visible.length === 0 && <p className="field-hint">{keyword ? '没有匹配的来源' : '在来源详情中选择这个分组。'}</p>}</div>
          <details className="subscription-group-manage"><summary>管理分组 {group.name}</summary><GroupEditor group={group} state={groups} sourceBusy={state.loading || Boolean(state.listError) || Boolean(state.pending)} /></details>
        </details>
      })}
      <div className="subscription-ungrouped"><h3>未分组 <span className="count">{ungrouped.length}</span></h3>{ungrouped.filter(source => matches(source)).map(sourceButton)}{ungrouped.length > 0 && !ungrouped.some(source => matches(source)) && <p className="field-hint">没有匹配的来源</p>}</div>
      {unresolved.length > 0 && <div className="subscription-ungrouped"><h3>分组待读取</h3>{unresolved.filter(source => matches(source)).map(sourceButton)}</div>}
    </nav>
    {!state.loading && !state.listError && state.sources.length === 0 && <p className="field-hint">保存一个来源，之后可以随时回来。</p>}
  </aside>
}
