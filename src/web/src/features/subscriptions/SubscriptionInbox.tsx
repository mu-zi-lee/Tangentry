import { Button, Checkbox, Input, Select } from '../../components/ui'
import { CheckCheck, ChevronDown, ChevronLeft, ChevronRight, RefreshCw, RotateCcw, Save, Search, Settings2, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ContentItem, SubscriptionGroup, SubscriptionSource } from '../../shared/api/types'
import { ContentCard } from '../../shared/ui/ContentCard'
import { CardCollection } from '../../shared/ui/CardCollection'
import type { useReadState } from '../readstate/useReadState'
import type { useSubscriptionInbox } from './useSubscriptionInbox'
import { emptyFilters } from './useSubscriptionInbox'
import type { SavedView } from '../../shared/api/types'
import { dateFilterTimestamp, localDateInputValue } from './savedViewDefinition'
import { ReadStatus, ReadToggle } from './SubscriptionStream'

type Inbox = ReturnType<typeof useSubscriptionInbox>
type Filters = Inbox['filters']
const platformNames: Record<string, string> = { bilibili: 'B站', youtube: 'YouTube', rss: 'RSS / 播客', arxiv: 'arXiv', huggingface: 'HF 每日论文' }
const same = (a: Filters, b: Filters) => JSON.stringify({ ...emptyFilters, ...a }) === JSON.stringify({ ...emptyFilters, ...b })
const advancedActive = (filters: Filters) => Boolean(filters.groupId || filters.platform || filters.topic || filters.tag || filters.sinceOffset || filters.since || filters.until || filters.favorite)

function InboxOptions({label,name,value,options,onChange}:{label:string;name:string;value:string;options:[string,string][];onChange:(value:string)=>void}) {
  return <div className="inbox-options" role="radiogroup" aria-label={label}>{options.map(([id,text])=><label key={id}><Input type="radio" name={name} value={id} checked={value===id} onChange={()=>onChange(id)}/><span>{text}</span></label>)}</div>
}

export function SubscriptionInbox({inbox,sources,groups,readStates,savedIDs,savingIDs,savingUnavailable,onRead,onSave,saveNotice,saveError,views,selectedViewID,onApplyFilters,onSaveView,onUpdateView,onDeleteView}:{inbox:Inbox;sources:SubscriptionSource[];groups:SubscriptionGroup[];readStates:ReturnType<typeof useReadState>;savedIDs:Set<string>;savingIDs:Set<string>;savingUnavailable:boolean;onRead:(item:ContentItem)=>void;onSave:(item:ContentItem)=>void;saveNotice:string;saveError:boolean;views:SavedView[];selectedViewID:string;onApplyFilters:(filters:Filters)=>void;onSaveView:(name:string,filters:Filters)=>Promise<void>;onUpdateView:(id:string,edit:Partial<Pick<SavedView,'name'|'definition'|'icon'|'color'|'default'>>)=>void;onDeleteView:(id:string)=>void}){
  const [draft,setDraft]=useState(inbox.filters)
  const [namingView,setNamingView]=useState(false)
  const [viewName,setViewName]=useState('')
  const [saveViewError,setSaveViewError]=useState('')
  const [moreOpen,setMoreOpen]=useState(()=>advancedActive(inbox.filters))
  const [viewSettingsOpen,setViewSettingsOpen]=useState(false)
  const [confirmDeleteView,setConfirmDeleteView]=useState(false)
  const activeView=views.find(view=>view.id===selectedViewID)
  const customView=activeView&&!activeView.builtin?activeView:undefined
  useEffect(()=>{ if(activeView) setDraft(activeView.definition.filters) },[selectedViewID,views])
  // A confirmed reload (e.g. after reading) should not discard a draft, but a new
  // confirmed result from elsewhere (view switch, URL) becomes the new baseline.
  useEffect(()=>{ if(!activeView) setDraft(inbox.filters) },[selectedViewID,inbox.filters])
  useEffect(()=>{ setViewSettingsOpen(false); setConfirmDeleteView(false) },[selectedViewID])
  const busy=inbox.loading||!inbox.confirmed||!readStates.ready||Boolean(readStates.pending.size)
  const sourceOptions=[...sources.map(source=>({id:source.id,name:source.name,removed:false})),...inbox.page.sources.filter(source=>source.removed && !sources.some(value=>value.id===source.id))].filter((source,index,list)=>list.findIndex(value=>value.id===source.id)===index)
  const baseline=activeView?activeView.definition.filters:inbox.filters
  const dirty=!same(draft,baseline)
  const hasFilters=!same(draft,emptyFilters)
  const apply=()=>{ if(!inbox.loading) onApplyFilters(draft) }
  const unreadOnPage=inbox.page.entries.some(entry=>readStates.get(entry.item.id)?.read===false)

  return <section id="subscription-stream" tabIndex={-1} className="subscription-inbox subscription-results" aria-label="历史收件箱">
    <header className="subscription-stream-header">
      <div className="subscription-stream-title">
        <h2>{activeView?.name ?? '历史收件箱'}</h2>
        <p className="subscription-stream-meta">{inbox.confirmed?<span>共 {inbox.count ?? inbox.page.entries.length} 条</span>:<span>正在读取…</span>}<span>{activeView?activeView.builtin?'内置视图':'自定义视图':'所有获取过的条目，包括已移除来源'}</span></p>
      </div>
      <div className="subscription-stream-actions">
        {customView&&<Button className="button button-secondary" variant="secondary" aria-expanded={viewSettingsOpen} aria-controls="saved-view-settings" onClick={()=>setViewSettingsOpen(value=>!value)}><Settings2 size={15} aria-hidden="true"/>视图设置</Button>}
        <Button variant="quiet" iconOnly className="icon-button" aria-label="重新读取收件箱" title="重新读取收件箱" disabled={inbox.loading} onClick={()=>void inbox.reload()}><RefreshCw size={16} aria-hidden="true" className={inbox.loading?'spin':undefined}/></Button>
      </div>
    </header>

    {customView&&viewSettingsOpen&&<div id="saved-view-settings" className="saved-view-settings" role="group" aria-label="视图设置">
      <label className="subscription-field"><span>名称</span><Input value={customView.name} maxLength={40} onChange={event=>{if(event.target.value.trim())onUpdateView(customView.id,{name:event.target.value})}} onBlur={event=>{if(event.target.value!==customView.name)onUpdateView(customView.id,{name:event.target.value.trim()})}}/></label>
      <label className="subscription-field"><span>图标</span><Select value={customView.icon} onChange={event=>onUpdateView(customView.id,{icon:event.target.value})}><option value="filter">筛选</option><option value="file-text">文章</option><option value="play">视频</option><option value="headphones">播客</option><option value="image">图片</option><option value="bookmark">收藏</option><option value="newspaper">资讯</option><option value="circle">圆点</option></Select></label>
      <label className="subscription-field"><span>颜色</span><Select value={customView.color} onChange={event=>onUpdateView(customView.id,{color:event.target.value})}><option value="teal">青绿</option><option value="blue">蓝</option><option value="green">绿</option><option value="amber">琥珀</option><option value="rose">玫瑰</option><option value="gray">灰</option></Select></label>
      <label className="inbox-checkbox"><Checkbox checked={customView.default} onChange={event=>onUpdateView(customView.id,{default:event.target.checked})}/>打开历史收件箱时默认使用</label>
      {!confirmDeleteView?<Button variant="secondary" className="button button-secondary subscription-danger-button" onClick={()=>setConfirmDeleteView(true)}><Trash2 size={14} aria-hidden="true"/>删除视图</Button>
        :<span className="saved-view-delete-confirm" role="group" aria-label="确认删除视图"><span>删除「{customView.name}」？筛选的内容不受影响。</span><Button className="button button-secondary" variant="secondary" autoFocus onClick={()=>setConfirmDeleteView(false)}>保留</Button><Button className="button button-danger" variant="danger" aria-label={`删除视图 ${customView.name}`} onClick={()=>onDeleteView(customView.id)}>确认删除</Button></span>}
    </div>}

    <form className="inbox-filters" aria-label="收件箱筛选" onSubmit={event=>{event.preventDefault();apply()}}>
      <div className="inbox-search-row">
        <label className="subscription-input inbox-search"><Search size={15} aria-hidden="true"/><span className="visually-hidden">搜索历史内容</span><Input type="search" aria-label="搜索历史内容" value={draft.query} maxLength={400} placeholder="搜索标题或作者，回车应用" onChange={event=>setDraft({...draft,query:event.target.value})}/></label>
        <label className="inbox-source-select"><span className="visually-hidden">来源</span><Select aria-label="来源" value={draft.sourceId} onChange={event=>setDraft({...draft,sourceId:event.target.value})}><option value="">全部来源</option>{sourceOptions.map(source=><option key={source.id} value={source.id}>{source.name}{source.removed?'（已移除）':''}</option>)}{draft.sourceId&&!sourceOptions.some(source=>source.id===draft.sourceId)&&<option value={draft.sourceId}>已移除的来源</option>}</Select></label>
        <Button className={`button ${dirty?'button-primary':'button-secondary'}`} type="submit" variant={dirty?'primary':'secondary'} disabled={inbox.loading}>应用筛选</Button>
      </div>
      <div className="inbox-filter-strip">
        <InboxOptions label="内容类型" name="inbox-kind" value={draft.kind} options={[["","全部类型"],["video","视频"],["graphical","图文"],["audio","音频"],["pdf","PDF"]]} onChange={kind=>setDraft({...draft,kind})}/>
        <InboxOptions label="阅读状态" name="inbox-read" value={draft.read} options={[["all","全部状态"],["unread","未读"],["read","已读"]]} onChange={read=>setDraft({...draft,read})}/>
        <Button variant="quiet" type="button" className="inbox-more-toggle" aria-expanded={moreOpen} aria-controls="inbox-advanced-fields" data-active={advancedActive(draft)} onClick={()=>setMoreOpen(value=>!value)}>更多条件{advancedActive(draft)&&<><span className="unread-dot" aria-hidden="true"/><span className="visually-hidden">（已设置）</span></>}<ChevronDown size={14} aria-hidden="true"/></Button>
        <div className="inbox-view-actions">
        {dirty?<span className="inbox-dirty" role="status">筛选未应用</span>:<span className="inbox-applied">{activeView?'':hasFilters?'已应用筛选':''}</span>}
        {dirty&&<Button variant="quiet" type="button" className="text-button" onClick={()=>setDraft(baseline)}><RotateCcw size={13} aria-hidden="true"/>撤销修改</Button>}
        {!dirty&&hasFilters&&!activeView&&<Button variant="quiet" type="button" className="text-button" onClick={()=>{setDraft(emptyFilters);onApplyFilters(emptyFilters)}}><X size={13} aria-hidden="true"/>清除筛选</Button>}
        <span className="inbox-view-save">
          {namingView?<span className="inbox-view-name-form"><label><span className="visually-hidden">视图名称</span><Input autoFocus aria-label="视图名称" value={viewName} maxLength={40} placeholder="输入视图名称" required onChange={event=>setViewName(event.target.value)} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();setNamingView(false)}}}/></label><Button className="button button-primary" variant="primary" type="button" disabled={!viewName.trim()} onClick={()=>{const name=viewName.trim();if(!name)return;setSaveViewError('');void onSaveView(name,draft).then(()=>setNamingView(false)).catch(cause=>setSaveViewError(cause instanceof Error?cause.message:'视图暂时无法保存。'))}}><Save size={15} aria-hidden="true"/>保存视图</Button><Button variant="quiet" iconOnly className="icon-button" type="button" aria-label="取消保存视图" title="取消" onClick={()=>{setNamingView(false);setSaveViewError('')}}><X size={16} aria-hidden="true"/></Button></span>
            :<Button className="button button-secondary" variant="secondary" type="button" onClick={()=>{setViewName(activeView?.builtin?`${activeView.name}（自定义）`:activeView?.name??'');setNamingView(true)}}><Save size={15} aria-hidden="true"/>{activeView?.builtin?'另存为自定义视图':selectedViewID?'保存视图':'保存为视图'}</Button>}
        </span>
        {saveViewError&&<small role="alert">{saveViewError}</small>}
      </div>
      </div>
      {moreOpen&&<div id="inbox-advanced-fields" className="inbox-advanced-fields">
        <label className="subscription-field"><span>分组</span><Select value={draft.groupId} onChange={event=>setDraft({...draft,groupId:event.target.value})}><option value="">全部分组</option>{groups.map(group=><option key={group.id} value={group.id}>{group.name}</option>)}{draft.groupId&&!groups.some(group=>group.id===draft.groupId)&&<option value={draft.groupId}>已解散的分组</option>}</Select></label>
        <label className="subscription-field"><span>平台</span><Select value={draft.platform} onChange={event=>setDraft({...draft,platform:event.target.value})}><option value="">全部平台</option>{[...new Set(sources.map(source=>source.id.split(':')[0]))].map(platform=><option key={platform} value={platform}>{platformNames[platform]??platform}</option>)}</Select></label>
        <label className="subscription-field"><span>主题 / 分类</span><Input value={draft.topic} maxLength={80} onChange={event=>setDraft({...draft,topic:event.target.value})}/></label>
        <label className="subscription-field"><span>笔记标签</span><Input value={draft.tag} maxLength={80} onChange={event=>setDraft({...draft,tag:event.target.value})}/></label>
        <label className="subscription-field"><span>时间范围</span><Select value={draft.sinceOffset} onChange={event=>setDraft({...draft,sinceOffset:event.target.value,since:0,until:0})}><option value="">不限</option><option value="day">今天</option><option value="week">本周</option><option value="month">本月</option></Select></label>
        <label className="subscription-field"><span>开始日期</span><Input type="date" value={localDateInputValue(draft.since)} onChange={event=>setDraft({...draft,sinceOffset:'',since:dateFilterTimestamp(event.target.value),until:draft.until})}/></label>
        <label className="subscription-field"><span>结束日期</span><Input type="date" value={localDateInputValue(draft.until)} onChange={event=>setDraft({...draft,sinceOffset:'',since:draft.since,until:dateFilterTimestamp(event.target.value,true)})}/></label>
        <label className="inbox-checkbox"><Checkbox checked={draft.favorite} onChange={event=>setDraft({...draft,favorite:event.target.checked})}/>仅收藏</label>
      </div>}
    </form>

    {inbox.error&&<p className="inline-feedback" role="alert">{inbox.error} 上次确认的结果仍保留。</p>}
    {inbox.loading&&<p className="field-hint" role="status">正在读取本地历史…</p>}
    {readStates.error&&<p className="inline-feedback" role="alert">{readStates.error}<Button className="button button-secondary" variant="secondary" onClick={readStates.refresh}>重新读取已读状态</Button></p>}
    {saveNotice&&<p className="inline-feedback collection-save-feedback" role={saveError?'alert':'status'}>{saveNotice}</p>}
    {savingUnavailable&&<p className="field-hint">资料库暂时无法读取，收藏操作不可用。</p>}
    {inbox.confirmed&&<>
      <div className="subscription-media-toolbar"><span className="inbox-count">第 {inbox.pageNumber} 页 · 本页 {inbox.page.entries.length} 条</span><Button variant="quiet" className="subscription-mark-shown" aria-label="将本页标为已读" title="将本页标为已读" disabled={busy||!unreadOnPage} onClick={()=>void readStates.setRead(inbox.page.entries.map(entry=>entry.item.id),true)}><CheckCheck size={16} aria-hidden="true"/><span>本页全部已读</span></Button></div>
      {inbox.page.entries.length?<CardCollection className="content-collection subscription-gallery" aria-label="历史内容" masonry={false}>{inbox.page.entries.map(entry=><div className="inbox-entry" key={entry.item.id}><ContentCard headingLevel={3} item={entry.item} saved={savedIDs.has(entry.item.id)} pending={savingUnavailable||savingIDs.has(entry.item.id)} onRead={onRead} onSave={onSave} status={<ReadStatus readStates={readStates} id={entry.item.id}/>} actions={<ReadToggle readStates={readStates} item={entry.item} disabled={busy}/>}/><p className="inbox-provenance"><span className="visually-hidden">来自</span>{entry.sources.map(source=><span key={source.id} data-removed={source.removed}>{source.name}{source.removed?'（已移除）':''}</span>)}</p></div>)}</CardCollection>
        :<div className="subscription-empty"><h3>{hasFilters||activeView?'没有符合条件的内容':'这里暂时没有内容'}</h3><p>{hasFilters||activeView?'调整或清除筛选条件后再试。':'更新订阅后会留下获取过的条目。'}</p>{hasFilters&&!activeView&&<Button className="button button-secondary" variant="secondary" onClick={()=>{setDraft(emptyFilters);onApplyFilters(emptyFilters)}}>清除筛选</Button>}</div>}
      {(inbox.hasPrevious||inbox.page.nextCursor)&&<nav className="inbox-pagination" aria-label="历史分页"><Button className="button button-secondary" variant="secondary" disabled={inbox.loading||!inbox.hasPrevious} onClick={inbox.back}><ChevronLeft size={16} aria-hidden="true"/>上一页</Button><span>第 {inbox.pageNumber} 页</span><Button className="button button-secondary" variant="secondary" disabled={inbox.loading||!inbox.page.nextCursor} onClick={()=>void inbox.next()}>下一页<ChevronRight size={16} aria-hidden="true"/></Button></nav>}
    </>}
    <p className="subscription-reading-hint">仅保留实际获取过的条目和来源提供的文字、媒体地址。移除订阅会保留历史；平台上的全历史和媒体文件需另行获取。</p>
  </section>
}
