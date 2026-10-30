import { renderToString } from 'react-dom/server'
import { expect, test } from 'vitest'
import type { useDownloads } from '../../downloads/useDownloads'
import { DataSettingsPage } from './DataSettingsPage'

test('data settings render storage and backup as one continuous workspace', () => {
  const html = renderToString(<DataSettingsPage
    value="storage"
    downloads={{ tools: null } as unknown as ReturnType<typeof useDownloads>}
  />)

  expect(html).toContain('存储位置')
  expect(html).toContain('自动备份')
  expect(html).toContain('备份目标')
  expect(html).toContain('data-setting="backup-snapshots"')
  expect(html).toContain('恢复数据')
  expect(html).not.toContain('数据与备份分区')
  expect(html).not.toContain('模型存储目录')
})
