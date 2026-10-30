import { expect, test } from './e2e'
import type { BackupSnapshot, BackupTarget, BackupTask } from '../src/shared/api/types'

test('backup dialogs preserve manual schedules and require preflight before restoration', async ({ page }) => {
  let targets: BackupTarget[] = [{ id:'disk', name:'测试备份磁盘', type:'local', path:'/fixture/backups', enabled:true }]
  let tasks: BackupTask[] = [{ id:'plan', name:'自动备份', targetIds:['disk'], intervalHours:12, retention:8, enabled:false, includeDownloads:false }]
  const snapshots: BackupSnapshot[] = [{ id:'snapshot-1', createdAt:'2026-10-29T03:00:00Z', status:'succeeded', size:4096, targets:[{ targetId:'disk', name:'测试备份磁盘', status:'succeeded' }] }]
  const calls: string[] = []
  await page.route('**/api/backup/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/backup/', '')
    const method = route.request().method()
    if (method === 'GET') return route.fulfill({ json: path === 'targets' ? targets : path === 'tasks' ? tasks : path === 'snapshots' ? snapshots : { configured:true } })
    calls.push(`${method} ${path}`)
    if (path === 'tasks') { tasks = [route.request().postDataJSON()]; return route.fulfill({ json:tasks[0] }) }
    if (path === 'tasks/plan/run') return route.fulfill({ json:snapshots[0] })
    if (path === 'targets') { targets = targets.map(target => target.id === route.request().postDataJSON().id ? route.request().postDataJSON() : target); return route.fulfill({ json:{} }) }
    if (path === 'validate') return route.fulfill({ json:{ snapshotId:'snapshot-1', size:4096, manifest:{ formatVersion:1, schemaVersion:1, snapshotID:'snapshot-1', includeDownloads:false, files:[] } } })
    if (path === 'restore' || path === 'restore/restore-plan/confirm') return route.fulfill({ json:{ planId:'restore-plan', restartRequired:true } })
    if (path === 'restore/restore-plan' && method === 'DELETE') return route.fulfill({ status:204 })
    return route.fulfill({ status:404 })
  })
  await page.goto('/tools#data')
  await expect(page.getByRole('switch', { name:'自动备份', exact:true })).not.toBeChecked()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.backup-overview-strip,.backup-panel')).toHaveCount(0)
  await page.getByRole('button', { name:'立即备份', exact:true }).click()
  await expect.poll(() => calls.includes('POST tasks/plan/run')).toBe(true)
  expect(tasks[0].enabled).toBe(false)
  await page.getByRole('switch', { name:'自动备份', exact:true }).check()
  await expect.poll(() => tasks[0].enabled).toBe(true)

  await page.getByRole('button', { name:'设置计划', exact:true }).click()
  const plan = page.getByRole('dialog', { name:'备份计划', exact:true })
  await plan.getByRole('spinbutton', { name:'默认备份间隔小时', exact:true }).fill('24')
  await plan.getByRole('button', { name:'关闭', exact:true }).click()
  await page.getByRole('button', { name:'设置计划', exact:true }).click()
  await expect(plan.getByRole('spinbutton', { name:'默认备份间隔小时', exact:true })).toHaveValue('12')
  await plan.getByRole('button', { name:'关闭', exact:true }).click()

  await page.getByRole('button', { name:'恢复…', exact:true }).click()
  const restore = page.getByRole('dialog', { name:'恢复数据', exact:true })
  await expect(restore.getByRole('button', { name:'确认恢复', exact:true })).toHaveCount(0)
  await restore.getByLabel('备份密码', { exact:true }).fill('synthetic-fixture-password')
  await restore.getByRole('button', { name:'继续预检', exact:true }).click()
  expect(calls.includes('POST validate')).toBe(false)
  await restore.getByRole('button', { name:'开始预检', exact:true }).click()
  await expect(restore.getByRole('button', { name:'确认恢复', exact:true })).toBeEnabled()
  expect(calls.includes('POST restore')).toBe(false)
  await restore.getByRole('button', { name:'确认恢复', exact:true }).click()
  await expect(restore.locator('.backup-pending-restore')).toContainText('恢复计划待应用')
  await restore.getByRole('button', { name:'关闭', exact:true }).click()
  await page.getByRole('button', { name:'恢复数据', exact:true }).click()
  await expect(restore.getByRole('button', { name:'取消待应用恢复', exact:true })).toBeEnabled()
  await restore.getByRole('button', { name:'取消待应用恢复', exact:true }).click()
  await expect.poll(() => calls.includes('DELETE restore/restore-plan')).toBe(true)
})

test('account rows expand without losing manual credential drafts', async ({ page }) => {
  await page.goto('/tools#accounts/youtube')
  const youtube = page.getByRole('region', { name:'YouTube登录设置', exact:true })
  await youtube.getByRole('button', { name:'粘贴 Cookie', exact:true }).click()
  await youtube.getByLabel('YouTube Cookie', { exact:true }).fill('synthetic=private-draft')
  await page.getByRole('button', { name:'连接哔哩哔哩', exact:true }).click()
  await expect(youtube).toBeHidden()
  await page.getByRole('button', { name:'连接YouTube', exact:true }).click()
  await expect(youtube.getByLabel('YouTube Cookie', { exact:true })).toHaveValue('synthetic=private-draft')
  await expect(youtube.getByLabel('YouTube Cookie', { exact:true })).toHaveAttribute('type', 'password')
})

test('narrow settings pages and dialogs fit the viewport', async ({ page }) => {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height:844 })
    for (const hash of ['overview', 'appearance', 'discovery', 'accounts', 'ai/provider', 'ai/text', 'ai/asr', 'agent', 'data', 'system']) {
      await page.goto(`/tools#${hash}`)
      await expect(page.locator('.settings-action-page h1')).toBeVisible()
      await expect(page.getByRole('button', { name:'返回设置列表', exact:true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await page.goto('/tools#data')
    await page.getByRole('button', { name:'添加目标', exact:true }).click()
    const dialog = page.getByRole('dialog', { name:'添加备份目标', exact:true })
    await dialog.getByRole('combobox', { name:'目标类型', exact:true }).selectOption('webdav')
    await expect(dialog.getByRole('button', { name:'测试连接', exact:true })).toBeDisabled()
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
  }
})
