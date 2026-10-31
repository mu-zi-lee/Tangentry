import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

// The runner sets the run id once; workers inherit it, so every process agrees
// on the shared run directory and the prebuilt server binary.
process.env.TANGENTRY_E2E_RUN ??= `${Date.now()}-${randomUUID()}`

export const e2eRunDirectory = fileURLToPath(new URL(`../../data/e2e/${process.env.TANGENTRY_E2E_RUN}`, import.meta.url))
export const e2eServerBinary = `${e2eRunDirectory}/tangentry-e2e-server`

const fakeMediaTool = fileURLToPath(new URL('./fake-media-tool.py', import.meta.url))

export function e2eServerEnv(data: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TANGENTRY_YTDLP_PATH: fakeMediaTool,
    TANGENTRY_FFMPEG_PATH: fakeMediaTool,
    TANGENTRY_BILIBILI_COOKIE_FILE: '',
    TANGENTRY_BILIBILI_COOKIE: '',
    TANGENTRY_DOWNLOAD_DIR: `${data}/downloads`,
  }
}
