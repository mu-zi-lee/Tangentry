import { renderToString } from 'react-dom/server'
import { expect, test } from 'vitest'
import { BackupSettings, backupDestination } from './BackupSettings'
import { normalizeBackupSettingsData } from './backupFolderBrowser'

test('backup settings render safely before empty API responses arrive', () => {
  const html = renderToString(<BackupSettings />)
  expect(html).toContain('备份目标')
})

test('backup settings can initialize with empty or missing API data', () => {
  const targets = normalizeBackupSettingsData<{ id: string }>(undefined)
  const tasks = normalizeBackupSettingsData<{ id: string }>(null)
  const snapshots = normalizeBackupSettingsData<{ id: string }>([])
  expect(targets).toEqual([])
  expect(tasks).toEqual([])
  expect(snapshots).toEqual([])
})

test('backup settings show a focused backup workspace and the actual snapshot directory', () => {
  const html = renderToString(<BackupSettings />)
  expect(html).toContain('立即备份')
  expect(html).toContain('自动备份')
  expect(html).toContain('data-setting="backup-snapshots"')
  expect(html).not.toContain('backup-overview-strip')
  expect(html).not.toContain('backup-panel')
  expect(backupDestination({ id: 'dav', name: 'NAS', type: 'webdav', endpoint: 'https://nas.example/dav', remotePath: 'archive/Tangentry', enabled: true }))
    .toBe('https://nas.example/dav/archive/Tangentry/tangentry/v1/snapshots')
  expect(backupDestination({ id: 'local', name: 'Disk', type: 'local', path: '/tmp/backups', enabled: true }))
    .toBe('/tmp/backups/tangentry/v1/snapshots')
})

test('backup settings distinguish archive encryption from WebDAV authentication', () => {
  const html = renderToString(<BackupSettings />)
  expect(html).toContain('备份文件加密密码')
  expect(html).toContain('确认加密密码')
  expect(html).toContain('不是 WebDAV 登录密码')
})

test('backup settings present a single scheduled plan with destination interval overrides', () => {
  const html = renderToString(<BackupSettings />)
  expect(html).toContain('备份计划')
  expect(html).toContain('默认备份间隔小时')
  expect(html).toContain('保存位置与频率')
  expect(html).toContain('每个位置最多保留')
  expect(html).not.toContain('删除备份任务')
})
