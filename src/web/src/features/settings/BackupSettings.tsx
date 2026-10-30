import { Check, ChevronRight, FolderOpen, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Dialog } from '../../components/ui/dialog/Dialog'
import { APIError, request } from '../../shared/api/client'
import type { BackupRestoreResult, BackupRunErrorResponse, BackupSnapshot, BackupTarget, BackupTargetType, BackupTask, BackupValidation } from '../../shared/api/types'
import { PathInput } from './PathInput'
import { BackupRemoteFolderBrowser } from './BackupRemoteFolderBrowser'
import { BACKUP_SCOPE_NOTICE, backupStatusPresentation, backupValidationPresentation, formatBackupDate, formatBackupSize, immediateBackupAvailability } from './backupPresentation'
import { normalizeBackupSettingsData } from './backupFolderBrowser'
import { createRestoreFlow, restoreFlowCanCancel, restoreFlowCanConfirm, restoreFlowCanValidate, restoreFlowNeedsRestart, restoreFlowTransition, restoreStepPresentation, type RestoreFlowState } from './backupFlow'
import { SettingsActionPage, SettingsTask } from './ui/SettingsActionPage'
import { SettingsRow, SettingsStatus } from './ui/SettingsRow'

const snapshotDirectory = 'tangentry/v1/snapshots'
function newID(prefix: string) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }

export function backupDestination(target: BackupTarget): string {
  if (target.type === 'webdav' && target.endpoint) {
    try {
      const url = new URL(target.endpoint)
      const path = [url.pathname, target.remotePath].filter(Boolean).join('/').split('/').filter(Boolean)
      url.pathname = `/${[...path, snapshotDirectory].join('/')}`
      url.search = ''
      url.hash = ''
      return url.toString().replace(/\/$/, '')
    } catch { return `${target.endpoint.replace(/\/$/, '')}/${[target.remotePath, snapshotDirectory].filter(Boolean).join('/')}` }
  }
  if (target.type === 'local' && target.path) return `${target.path.replace(/\/$/, '')}/${snapshotDirectory}`
  return snapshotDirectory
}

export function BackupSettings({ active = true, children }: { active?: boolean; children?: ReactNode }) {
  const [targets, setTargets] = useState<BackupTarget[]>([])
  const [task, setTask] = useState<BackupTask | null>(null)
  const [snapshots, setSnapshots] = useState<BackupSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [planOpen, setPlanOpen] = useState(false)
  const [selectedTargetIDs, setSelectedTargetIDs] = useState<string[]>([])
  const [intervalHours, setIntervalHours] = useState(6)
  const [retention, setRetention] = useState(10)
  const [targetIntervals, setTargetIntervals] = useState<Record<string, number>>({})
  const [includeDownloads, setIncludeDownloads] = useState(false)
  const [automatic, setAutomatic] = useState(false)
  const [savingPlan, setSavingPlan] = useState(false)
  const [encryptionOpen, setEncryptionOpen] = useState(false)
  const [encryptionConfigured, setEncryptionConfigured] = useState(false)
  const [encryptionPassword, setEncryptionPassword] = useState('')
  const [encryptionConfirm, setEncryptionConfirm] = useState('')
  const [savingEncryption, setSavingEncryption] = useState(false)
  const [targetOpen, setTargetOpen] = useState(false)
  const [editingTarget, setEditingTarget] = useState<BackupTarget | null>(null)
  const [targetType, setTargetType] = useState<BackupTargetType>('local')
  const [targetName, setTargetName] = useState('')
  const [targetPath, setTargetPath] = useState('')
  const [targetEndpoint, setTargetEndpoint] = useState('')
  const [targetUsername, setTargetUsername] = useState('')
  const [targetPassword, setTargetPassword] = useState('')
  const [targetRemotePath, setTargetRemotePath] = useState('')
  const [targetEnabled, setTargetEnabled] = useState(true)
  const [allowInsecureTLS, setAllowInsecureTLS] = useState(false)
  const [targetTest, setTargetTest] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [folderBrowserOpen, setFolderBrowserOpen] = useState(false)
  const [savingTarget, setSavingTarget] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [backupRunning, setBackupRunning] = useState(false)
  const [retryingID, setRetryingID] = useState('')
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [restore, setRestore] = useState<RestoreFlowState>(createRestoreFlow)
  const [restoreTargetID, setRestoreTargetID] = useState('')
  const [restorePassword, setRestorePassword] = useState('')
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [restoreNotice, setRestoreNotice] = useState('')
  const read = useRef<AbortController | null>(null)

  function applyPlan(value: BackupTask | null, loadedTargets: BackupTarget[]) {
    setTask(value)
    setSelectedTargetIDs(value?.targetIds ?? loadedTargets.filter(target => target.enabled).map(target => target.id))
    setAutomatic(Boolean(value?.enabled))
    setIncludeDownloads(Boolean(value?.includeDownloads))
    setIntervalHours(value?.intervalHours || 6)
    setRetention(value?.retention || 10)
    setTargetIntervals(value?.targetIntervalHours ?? {})
  }
  async function reload() {
    read.current?.abort()
    const controller = new AbortController()
    read.current = controller
    setLoading(true); setError('')
    try {
      const [loadedTargets, loadedTasks, loadedSnapshots, encryption] = await Promise.all([
        request<BackupTarget[]>('/backup/targets', { signal: controller.signal }),
        request<BackupTask[]>('/backup/tasks', { signal: controller.signal }),
        request<BackupSnapshot[]>('/backup/snapshots', { signal: controller.signal }),
        request<{ configured: boolean }>('/backup/encryption', { signal: controller.signal }),
      ])
      if (controller.signal.aborted) return
      const safeTargets = normalizeBackupSettingsData(loadedTargets)
      setTargets(safeTargets)
      setSnapshots(normalizeBackupSettingsData(loadedSnapshots))
      setEncryptionConfigured(encryption.configured)
      applyPlan(normalizeBackupSettingsData(loadedTasks)[0] ?? null, safeTargets)
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '无法读取备份设置。') }
    finally { if (!controller.signal.aborted) setLoading(false) }
  }
  useEffect(() => {
    if (active) void reload()
    return () => read.current?.abort()
  }, [active])

  const backupTargets = targets.filter(target => target.enabled && selectedTargetIDs.includes(target.id))
  const runAvailability = immediateBackupAvailability({ hasTarget: backupTargets.length > 0, targetCount: backupTargets.length, hasPassword: encryptionConfigured, pendingAction: backupRunning ? 'backup' : null })
  function currentPlan(enabled = automatic): BackupTask {
    return { ...task, id: task?.id ?? newID('task'), name: '自动备份', targetIds: selectedTargetIDs, includeDownloads, retention, intervalHours, targetIntervalHours: Object.fromEntries(Object.entries(targetIntervals).filter(([id, hours]) => selectedTargetIDs.includes(id) && hours > 0)), enabled }
  }
  async function savePlan(enabled = automatic, close = true) {
    if (savingPlan || !selectedTargetIDs.length && (enabled || !task?.targetIds.length)) return
    const previous = automatic
    setAutomatic(enabled); setSavingPlan(true); setError('')
    try {
      const next = currentPlan(enabled)
      if (!enabled && !next.targetIds.length) next.targetIds = task!.targetIds
      await request('/backup/tasks', { method: 'POST', body: JSON.stringify(next) })
      setTask(next)
      if (close) setPlanOpen(false)
      setNotice('备份计划已保存。')
    } catch (cause) { setAutomatic(previous); setError(cause instanceof Error ? cause.message : '保存计划失败。') }
    finally { setSavingPlan(false) }
  }
  async function saveEncryption() {
    if (savingEncryption || encryptionPassword.length < 8 || encryptionPassword !== encryptionConfirm) return
    setSavingEncryption(true); setError('')
    try {
      await request('/backup/encryption', { method: 'PUT', body: JSON.stringify({ password: encryptionPassword }) })
      setEncryptionConfigured(true); setEncryptionPassword(''); setEncryptionConfirm(''); setEncryptionOpen(false)
      setNotice('备份加密密码已保存。')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存密码失败。') }
    finally { setSavingEncryption(false) }
  }
  function openTarget(value: BackupTarget | null = null) {
    setEditingTarget(value); setTargetType(value?.type === 'webdav' || value?.type === 's3' ? value.type : 'local'); setTargetName(value?.name ?? '')
    setTargetPath(value?.path ?? ''); setTargetEndpoint(value?.endpoint ?? ''); setTargetUsername(value?.username ?? '')
    setTargetPassword(''); setTargetRemotePath(value?.remotePath ?? ''); setTargetEnabled(value?.enabled ?? true)
    setAllowInsecureTLS(Boolean(value?.allowInsecureTLS)); setTargetTest('idle'); setFolderBrowserOpen(false); setDeleteConfirm(false); setError(''); setTargetOpen(true)
  }
  const validWebDAV = Boolean(targetEndpoint.trim() && targetUsername.trim() && (targetPassword || editingTarget?.credentialConfigured))
  const validTarget = Boolean(targetName.trim() && (targetType === 'local' ? targetPath.trim() : targetType === 'webdav' && validWebDAV))
  const remoteTarget = { id: editingTarget?.id ?? '', type: 'webdav' as const, endpoint: targetEndpoint.trim(), username: targetUsername.trim(), password: targetPassword, remotePath: targetRemotePath.trim(), allowInsecureTLS }
  async function testTarget() {
    setTargetTest('testing'); setError('')
    try { await request('/backup/targets/test', { method: 'POST', body: JSON.stringify(remoteTarget) }); setTargetTest('success') }
    catch (cause) { setTargetTest('error'); setError(cause instanceof Error ? cause.message : 'WebDAV 连接失败。') }
  }
  async function saveTarget() {
    if (!validTarget || savingTarget) return
    setSavingTarget(true); setError('')
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 15_000)
    try {
      const value: BackupTarget = { ...(targetType === 'webdav' ? { ...remoteTarget, updateCredential: Boolean(targetPassword) } : {}), id: editingTarget?.id ?? newID('target'), name: targetName.trim(), type: targetType, path: targetType === 'local' ? targetPath.trim() : undefined, enabled: targetEnabled }
      await request('/backup/targets', { method: 'POST', body: JSON.stringify(value), signal: controller.signal })
      const redacted = { ...value, password: undefined, updateCredential: undefined, credentialConfigured: targetType === 'webdav' ? true : undefined }
      setTargets(current => editingTarget ? current.map(item => item.id === value.id ? redacted : item) : [...current, redacted])
      if (!editingTarget && targetEnabled) setSelectedTargetIDs(current => [...current, value.id])
      setTargetPassword(''); setTargetOpen(false); setNotice('备份目标已保存。')
    } catch (cause) { setError(controller.signal.aborted ? '保存目标超时，请重试。' : cause instanceof Error ? cause.message : '保存目标失败。') }
    finally { window.clearTimeout(timeout); setSavingTarget(false) }
  }
  async function deleteTarget() {
    if (!editingTarget || savingTarget) return
    setSavingTarget(true); setError('')
    try {
      await request(`/backup/targets/${encodeURIComponent(editingTarget.id)}`, { method: 'DELETE' })
      setTargets(current => current.filter(value => value.id !== editingTarget.id))
      setSelectedTargetIDs(current => current.filter(id => id !== editingTarget.id))
      setTargetOpen(false); setNotice('已移除备份目标，已有快照文件保留。')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '移除目标失败。') }
    finally { setSavingTarget(false) }
  }
  async function runBackup() {
    if (runAvailability.disabled || backupRunning) return
    setBackupRunning(true); setError(''); setNotice('')
    try {
      const next = currentPlan()
      await request('/backup/tasks', { method: 'POST', body: JSON.stringify(next) })
      setTask(next)
      const result = await request<BackupSnapshot>(`/backup/tasks/${encodeURIComponent(next.id)}/run`, { method: 'POST', body: '{}' })
      setSnapshots(current => [result, ...current.filter(value => value.id !== result.id)])
      setNotice(`备份${backupStatusPresentation(result.status).label}。`)
    } catch (cause) {
      const failed = cause instanceof APIError ? (cause.payload as BackupRunErrorResponse | undefined)?.snapshot : undefined
      if (failed) setSnapshots(current => [failed, ...current.filter(value => value.id !== failed.id)])
      try { setSnapshots(normalizeBackupSettingsData(await request<BackupSnapshot[]>('/backup/snapshots'))) } catch { /* Keep the original error. */ }
      setError(cause instanceof Error ? cause.message : '备份失败。')
    } finally { setBackupRunning(false) }
  }
  async function retryFailed(snapshotID: string) {
    setRetryingID(snapshotID); setError('')
    try {
      const result = await request<BackupSnapshot>(`/backup/snapshots/${encodeURIComponent(snapshotID)}/retry-failed`, { method: 'POST' })
      setSnapshots(current => [result, ...current.filter(value => value.id !== result.id)])
    } catch (cause) { setError(cause instanceof Error ? cause.message : '重试失败。') }
    finally { setRetryingID('') }
  }
  function chooseRestoreSnapshot(snapshotID: string) {
    setRestore(restoreFlowTransition(createRestoreFlow(), { type: 'select-snapshot', snapshotId: snapshotID }))
    setRestorePassword(''); setRestoreNotice('')
    const snapshot = snapshots.find(value => value.id === snapshotID)
    setRestoreTargetID(snapshot?.targets?.find(value => value.status === 'succeeded')?.targetId ?? targets[0]?.id ?? '')
  }
  function openRestore(snapshotID = '') { if (!restoreFlowNeedsRestart(restore)) chooseRestoreSnapshot(snapshotID); setRestoreOpen(true); setError('') }
  async function preflightRestore() {
    if (!restoreFlowCanValidate(restore) || !restoreTargetID) return
    const validating = restoreFlowTransition(restore, { type: 'start-validation' })
    setRestore(validating); setRestoreBusy(true)
    try {
      const result = await request<BackupValidation>('/backup/validate', { method: 'POST', body: JSON.stringify({ targetId: restoreTargetID, snapshotId: restore.selectedSnapshotId, password: restorePassword }) })
      setRestore(restoreFlowTransition(validating, { type: 'validation-succeeded', validation: result }))
    } catch (cause) { setRestore(restoreFlowTransition(validating, { type: 'validation-failed', message: cause instanceof Error ? cause.message : '快照校验失败。' })) }
    finally { setRestoreBusy(false) }
  }
  async function confirmRestore() {
    if (!restoreFlowCanConfirm(restore) || !restoreTargetID || !restorePassword.trim()) return
    const confirming = restoreFlowTransition(restore, { type: 'start-confirmation' })
    if (confirming.status !== 'confirming') { setRestore(confirming); return }
    setRestore(confirming); setRestoreBusy(true); setRestoreNotice('')
    try {
      const prepared = await request<BackupRestoreResult>('/backup/restore', { method: 'POST', body: JSON.stringify({ targetId: restoreTargetID, snapshotId: restore.selectedSnapshotId, password: restorePassword }) })
      const confirmed = await request<BackupRestoreResult>(`/backup/restore/${encodeURIComponent(prepared.planId)}/confirm`, { method: 'POST' })
      setRestore(restoreFlowTransition(confirming, { type: 'confirmation-succeeded', planId: confirmed.planId || prepared.planId }))
      setRestorePassword(''); setRestoreNotice('恢复计划已确认，需要重启后生效。')
    } catch (cause) { setRestore(restoreFlowTransition(confirming, { type: 'confirmation-failed', message: cause instanceof Error ? cause.message : '恢复确认失败。' })) }
    finally { setRestoreBusy(false) }
  }
  async function cancelRestore() {
    if (!restoreFlowCanCancel(restore) || !restore.planId) return
    setRestoreBusy(true)
    try {
      await request(`/backup/restore/${encodeURIComponent(restore.planId)}`, { method: 'DELETE' })
      setRestore(current => restoreFlowTransition(current, { type: 'cancel-pending' })); setRestoreNotice('已取消待应用的恢复计划。')
    } catch (cause) { setRestoreNotice(cause instanceof Error ? cause.message : '取消恢复失败。') }
    finally { setRestoreBusy(false) }
  }
  const restoreValidation = restore.validation ? backupValidationPresentation(restore.validation) : null
  const errorFeedback = error && <p className="settings-feedback" role="alert">{error}</p>

  return <SettingsActionPage className="settings-action-data" title="数据与备份" description="文件存放的位置、自动备份计划，以及从快照恢复。" actions={<button type="button" className="button button-primary" disabled={loading || savingPlan || runAvailability.disabled} title={runAvailability.reason} onClick={() => void runBackup()}><RefreshCw size={14} className={backupRunning ? 'spin' : undefined}/>{backupRunning ? '正在备份…' : '立即备份'}</button>}>
    {children}
    <div id="settings-backup">
      {errorFeedback}
      {notice && <p className="settings-feedback" role="status">{notice}</p>}
      <SettingsTask title="自动备份">
        <div className="settings-list-card">
          <SettingsRow setting="automatic-backup" title="自动备份" description={task?.enabled ? `每 ${task.intervalHours} 小时备份，应用运行时执行` : '按计划保存到所选目标，电脑唤醒后补跑逾期任务'}>
            <button type="button" className="text-button" disabled={loading || savingPlan} onClick={() => setPlanOpen(true)}>设置计划</button>
            <input className="settings-switch" role="switch" aria-label="自动备份" type="checkbox" checked={automatic} disabled={loading || savingPlan || !automatic && (!backupTargets.length || !encryptionConfigured)} onChange={event => void savePlan(event.target.checked, false)}/>
          </SettingsRow>
          <SettingsRow setting="backup-encryption" title="备份加密" description="恢复时需要输入备份密码">
            <SettingsStatus tone={encryptionConfigured ? 'positive' : 'warning'}>{encryptionConfigured ? '已设置密码' : '尚未设置'}</SettingsStatus>
            <button type="button" className="button button-secondary" disabled={loading} onClick={() => { setEncryptionPassword(''); setEncryptionConfirm(''); setEncryptionOpen(true) }}>{encryptionConfigured ? '修改密码' : '设置密码'}</button>
          </SettingsRow>
        </div>
      </SettingsTask>
      <SettingsTask title="备份目标" actions={<button type="button" className="text-button" disabled={loading} onClick={() => openTarget()}><Plus size={14}/>添加目标</button>}>
        <div className="settings-list-card" data-setting="backup-targets">
          {!targets.length && <p className="settings-empty">{loading ? '正在读取备份目标…' : '尚未配置目标。添加本地目录或 WebDAV 位置。'}</p>}
          {targets.map(target => {
            const latest = snapshots.flatMap(snapshot => snapshot.targets ?? []).find(value => value.targetId === target.id)
            return <SettingsRow key={target.id} title={target.name} description={<span className="settings-mono">{target.type === 'webdav' ? `${target.endpoint}${target.remotePath ? `/${target.remotePath}` : ''}` : target.path}</span>}>
              <SettingsStatus tone={!target.enabled ? 'neutral' : latest?.status === 'failed' ? 'danger' : latest?.status === 'succeeded' ? 'positive' : 'neutral'}>{!target.enabled ? '已停用' : latest?.status === 'succeeded' ? '最近备份成功' : latest?.status === 'failed' ? '上传失败' : target.type === 'webdav' ? 'WebDAV' : '本地文件夹'}</SettingsStatus>
              <button type="button" className="text-button" onClick={() => openTarget(target)}>编辑</button>
            </SettingsRow>
          })}
        </div>
      </SettingsTask>
      <SettingsTask title="快照" actions={<><button type="button" className="text-button" onClick={() => openRestore()}><RotateCcw size={14}/>恢复数据</button><button type="button" className="icon-button" aria-label="刷新备份状态" title="刷新备份状态" disabled={loading} onClick={() => void reload()}><RefreshCw size={15} className={loading ? 'spin' : undefined}/></button></>}>
        <div className="settings-list-card" data-setting="backup-snapshots">
          {!snapshots.length && <p className="settings-empty">{loading ? '正在读取快照…' : '暂无备份快照。完成一次备份后会显示在这里。'}</p>}
          {snapshots.map(snapshot => {
            const status = backupStatusPresentation(snapshot.status)
            const successfulTargets = snapshot.targets?.filter(value => value.status === 'succeeded') ?? []
            return <SettingsRow key={snapshot.id} title={formatBackupDate(snapshot.createdAt)} description={<>{successfulTargets.map(value => value.name || value.targetId).join('、') || snapshot.id} · 已加密 · {formatBackupSize(snapshot.size)}{snapshot.targets?.filter(value => value.status === 'failed').map(value => <span key={value.targetId} className="backup-target-failure"> · {value.name || value.targetId}：{value.error || '上传失败'}</span>)}</>}>
              <SettingsStatus tone={status.tone === 'success' ? 'positive' : status.tone === 'danger' ? 'danger' : status.tone === 'warning' ? 'warning' : 'neutral'}>{status.label}</SettingsStatus>
              {snapshot.status !== 'succeeded' && <button type="button" className="button button-secondary" disabled={Boolean(retryingID) || !snapshot.retryAvailable} title={snapshot.retryUnavailableReason} onClick={() => void retryFailed(snapshot.id)}>{retryingID === snapshot.id ? '正在重试…' : '重试失败目标'}</button>}
              <button type="button" className="button button-secondary" disabled={snapshot.status !== 'succeeded' && !successfulTargets.length} onClick={() => openRestore(snapshot.id)}>恢复…</button>
            </SettingsRow>
          })}
        </div>
      </SettingsTask>
    </div>
    <Dialog className="settings-dialog" open={planOpen} closeDisabled={savingPlan} title="备份计划" onClose={() => { applyPlan(task, targets); setPlanOpen(false) }}>
      <div className="backup-run-form">
        <div className="backup-plan-settings"><label>默认备份间隔（小时）<input aria-label="默认备份间隔小时" type="number" min={1} max={720} value={intervalHours} onChange={event => setIntervalHours(Math.max(1, Math.min(720, Number(event.target.value) || 1)))}/></label><label>每个位置最多保留<input type="number" min={1} max={1000} value={retention} onChange={event => setRetention(Math.max(1, Math.min(1000, Number(event.target.value) || 1)))}/></label></div>
        <fieldset className="backup-target-checkboxes"><legend>保存位置与频率</legend>{!targets.length && <p className="field-hint">请先添加备份目标。</p>}{targets.map(target => <div className="backup-plan-target" key={target.id}><label><input type="checkbox" checked={selectedTargetIDs.includes(target.id)} disabled={!target.enabled} onChange={event => setSelectedTargetIDs(current => event.target.checked ? [...current, target.id] : current.filter(id => id !== target.id))}/>{target.name}{!target.enabled && '（已停用）'}</label><label className="backup-target-interval">间隔小时<input aria-label={`${target.name}备份间隔小时`} type="number" min={1} max={720} placeholder={`默认 ${intervalHours}`} disabled={!selectedTargetIDs.includes(target.id) || !target.enabled} value={targetIntervals[target.id] || ''} onChange={event => setTargetIntervals(current => ({ ...current, [target.id]: Math.max(0, Math.min(720, Number(event.target.value))) }))}/></label></div>)}</fieldset>
        {backupTargets.length > 0 && <div className="backup-destinations"><span>快照将写入</span>{backupTargets.map(target => <div key={target.id}><strong>{target.name}</strong><code>{backupDestination(target)}</code></div>)}</div>}
        <label className="backup-checkbox"><input type="checkbox" checked={includeDownloads} onChange={event => setIncludeDownloads(event.target.checked)}/>包含下载媒体</label>
        <p className="field-hint">{BACKUP_SCOPE_NOTICE}</p>
        {errorFeedback}
      </div>
      <div className="settings-dialog-actions"><button type="button" className="button button-primary" disabled={savingPlan || !backupTargets.length || backupRunning} onClick={() => void savePlan()}>{savingPlan ? '正在保存…' : '保存计划'}</button></div>
    </Dialog>
    <Dialog className="settings-dialog" open={encryptionOpen} closeDisabled={savingEncryption} title={encryptionConfigured ? '修改备份密码' : '设置备份密码'} onClose={() => { setEncryptionOpen(false); setEncryptionPassword(''); setEncryptionConfirm('') }}>
      <div className="backup-password-grid"><label>备份文件加密密码<input type="password" autoComplete="new-password" placeholder="至少 8 个字符" value={encryptionPassword} onChange={event => setEncryptionPassword(event.target.value)}/></label><label>确认加密密码<input type="password" autoComplete="new-password" value={encryptionConfirm} onChange={event => setEncryptionConfirm(event.target.value)}/></label></div>
      <p className="field-hint">这是快照加密密码，不是 WebDAV 登录密码。忘记后无法恢复。修改密码只影响新备份，旧快照仍使用原密码。</p>
      {encryptionConfirm && encryptionPassword !== encryptionConfirm && <p className="settings-feedback" role="alert">两次输入的密码不一致。</p>}
      {errorFeedback}
      <div className="settings-dialog-actions"><button type="button" className="button button-primary" disabled={savingEncryption || encryptionPassword.length < 8 || encryptionPassword !== encryptionConfirm} onClick={() => void saveEncryption()}>{savingEncryption ? '正在保存…' : '保存加密密码'}</button></div>
    </Dialog>
    <Dialog className="settings-dialog" open={targetOpen} closeDisabled={savingTarget} title={editingTarget ? '编辑备份目标' : '添加备份目标'} onClose={() => { setTargetOpen(false); setTargetPassword('') }}>
      <div className="backup-form-grid">
        <label>目标类型<select value={targetType} disabled={Boolean(editingTarget)} onChange={event => { setTargetType(event.target.value as BackupTargetType); setFolderBrowserOpen(false) }}><option value="local">本地目录</option><option value="webdav">WebDAV</option>{targetType === 's3' && <option value="s3">S3 兼容</option>}</select></label>
        <label>名称<input value={targetName} maxLength={120} onChange={event => setTargetName(event.target.value)}/></label>
        {targetType === 'local' ? <div className="backup-form-wide"><PathInput label="目录" ariaLabel="备份目录" value={targetPath} kind="backup-directory" placeholder="填写备份目录" onChange={setTargetPath}/></div> : targetType === 'webdav' && <>
          <label className="backup-form-wide">WebDAV 地址<input value={targetEndpoint} placeholder="https://nas.example/dav" onChange={event => { setTargetEndpoint(event.target.value); setTargetTest('idle'); setFolderBrowserOpen(false) }}/></label>
          <label>用户名<input value={targetUsername} autoComplete="username" onChange={event => { setTargetUsername(event.target.value); setTargetTest('idle'); setFolderBrowserOpen(false) }}/></label>
          <label>密码<input type="password" value={targetPassword} autoComplete="new-password" placeholder={editingTarget?.credentialConfigured ? '留空保留当前密码' : '输入 WebDAV 密码'} onChange={event => { setTargetPassword(event.target.value); setTargetTest('idle'); setFolderBrowserOpen(false) }}/></label>
          <div className="backup-form-wide backup-remote-path"><label htmlFor="backup-remote-path">远端目录</label><div><input id="backup-remote-path" value={targetRemotePath || '根目录'} readOnly/><button type="button" className="button button-secondary" disabled={!validWebDAV} onClick={() => setFolderBrowserOpen(value => !value)}><FolderOpen size={15}/>浏览…</button></div></div>
          <label className="backup-checkbox backup-form-wide"><input type="checkbox" checked={allowInsecureTLS} onChange={event => { setAllowInsecureTLS(event.target.checked); setTargetTest('idle'); setFolderBrowserOpen(false) }}/>允许自签名证书</label>
          <div className="backup-editor-actions backup-form-wide"><button type="button" className="button button-secondary" disabled={targetTest === 'testing' || !validWebDAV} onClick={() => void testTarget()}>{targetTest === 'testing' ? '正在测试…' : '测试连接'}</button>{targetTest === 'success' && <SettingsStatus tone="positive">连接成功</SettingsStatus>}</div>
          {folderBrowserOpen && <div className="backup-form-wide"><BackupRemoteFolderBrowser target={remoteTarget} onSelect={path => { setTargetRemotePath(path); setFolderBrowserOpen(false) }} onClose={() => setFolderBrowserOpen(false)}/></div>}
        </>}
        <label className="backup-checkbox backup-form-wide"><input type="checkbox" checked={targetEnabled} onChange={event => setTargetEnabled(event.target.checked)}/>启用此目标</label>
      </div>
      {errorFeedback}
      {deleteConfirm && <div className="cookie-confirm"><p>移除“{editingTarget?.name}”？目标中的已有快照文件会保留。</p><button type="button" className="button button-secondary" disabled={savingTarget} onClick={() => void deleteTarget()}>确认移除</button></div>}
      <div className="settings-dialog-actions">{editingTarget && <button type="button" className="text-button" disabled={savingTarget} onClick={() => setDeleteConfirm(value => !value)}><Trash2 size={14}/>移除目标</button>}<button type="button" className="button button-primary" disabled={savingTarget || !validTarget} onClick={() => void saveTarget()}>{savingTarget ? '正在保存…' : editingTarget ? '保存目标' : '添加目标'}</button></div>
    </Dialog>
    <Dialog className="settings-dialog" open={restoreOpen} closeDisabled={restoreBusy} title="恢复数据" onClose={() => { setRestoreOpen(false); setRestorePassword('') }}>
      <div className="backup-stepper">{(['select-snapshot', 'enter-password', 'preflight', 'confirm'] as const).map((step, index) => { const item = restoreStepPresentation(step); return <div className={restore.step === step ? 'active' : ''} key={step}><span>{item.number}</span><small>{item.title}</small>{index < 3 && <ChevronRight size={14}/>}</div> })}</div>
      <div className="backup-restore-form">
        <label>选择快照<select value={restore.selectedSnapshotId} disabled={restoreBusy || restoreFlowNeedsRestart(restore)} onChange={event => chooseRestoreSnapshot(event.target.value)}><option value="">请选择快照</option>{snapshots.map(snapshot => <option key={snapshot.id} value={snapshot.id}>{formatBackupDate(snapshot.createdAt)} · {snapshot.id}</option>)}</select></label>
        <label>恢复目标<select value={restoreTargetID} disabled={restoreBusy || restoreFlowNeedsRestart(restore)} onChange={event => { setRestoreTargetID(event.target.value); setRestore(restoreFlowTransition(createRestoreFlow(), { type: 'select-snapshot', snapshotId: restore.selectedSnapshotId })); setRestorePassword('') }}><option value="">请选择目标</option>{targets.map(target => <option key={target.id} value={target.id}>{target.name}</option>)}</select></label>
        {!snapshots.length && <p className="field-hint">暂无可恢复的快照。</p>}
        {restore.step === 'enter-password' && <div className="backup-restore-step"><label>备份密码<input type="password" autoComplete="off" value={restorePassword} onChange={event => setRestorePassword(event.target.value)}/></label><button type="button" className="button button-secondary" disabled={!restorePassword.trim() || !restoreTargetID} onClick={() => { const withPassword = restoreFlowTransition(restore, { type: 'set-password', hasPassword: Boolean(restorePassword.trim()) }); setRestore(restoreFlowTransition(withPassword, { type: 'submit-password' })) }}>继续预检</button></div>}
        {restore.step === 'preflight' && <div className="backup-restore-step"><p>预检将校验文件完整性与格式兼容性。</p><button type="button" className="button button-secondary" disabled={!restoreFlowCanValidate(restore) || restoreBusy || !restoreTargetID} onClick={() => void preflightRestore()}>{restoreBusy ? '校验中…' : '开始预检'}</button><button type="button" className="text-button" disabled={restoreBusy} onClick={() => setRestore(restoreFlowTransition(createRestoreFlow(), { type: 'select-snapshot', snapshotId: restore.selectedSnapshotId }))}>返回输入密码</button></div>}
        {restoreValidation && <div className="backup-validation-panel"><strong>预检结果</strong><p>格式 v{restoreValidation.formatVersion ?? '?'} · 数据库架构 v{restoreValidation.schemaVersion ?? '?'} · {restoreValidation.fileCount} 个文件 · {restoreValidation.size}</p><details className="backup-validation-details"><summary>查看文件校验</summary>{restoreValidation.files.map(file => <div key={file.path}><code>{file.path}</code><span>{file.size} · SHA-256 {file.sha256}</span></div>)}</details></div>}
        {restore.step === 'confirm' && <div className="backup-restore-step"><p>确认后写入恢复计划，重启后应用。运行中的数据不会立即替换。</p><button type="button" className="button button-primary" disabled={!restoreFlowCanConfirm(restore) || restoreBusy} onClick={() => void confirmRestore()}>{restoreBusy ? '正在确认…' : '确认恢复'}</button></div>}
        {restoreFlowNeedsRestart(restore) && <div className="backup-pending-restore" role="status"><Check size={16}/><div><strong>恢复计划待应用</strong><p>重启后生效。计划标识：{restore.planId}</p></div><button type="button" className="button button-secondary" disabled={restoreBusy} onClick={() => void cancelRestore()}>取消待应用恢复</button></div>}
        {restore.error && <p className="settings-feedback" role="alert">{restore.error}</p>}
        {restoreNotice && <p className="settings-feedback" role="status">{restoreNotice}</p>}
      </div>
    </Dialog>
  </SettingsActionPage>
}
