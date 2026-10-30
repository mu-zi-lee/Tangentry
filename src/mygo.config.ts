import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const configRoot = dirname(fileURLToPath(import.meta.url))

// tools/desktop/prepare.mjs writes each platform's runtime to
// resources/<os>-<arch>/runtime, which MyGo ships to that platform only.
const macRuntime = join(configRoot, 'resources/darwin-arm64/runtime/manifest.json')
const minimumSystemVersion = existsSync(macRuntime)
  ? JSON.parse(readFileSync(macRuntime, 'utf8')).minimumSystemVersion
  : undefined
const qa = process.env.TANGENTRY_DESKTOP_QA === '1'
const updatePublicKeyPath = join(configRoot, 'updater/mygo-update.pub')
const updatePublicKey = existsSync(updatePublicKeyPath) ? readFileSync(updatePublicKeyPath, 'utf8').trim() : ''

export default {
  name: qa ? 'Tangentry QA' : 'Tangentry',
  identifier: qa ? 'dev.tangentry.qa' : 'dev.tangentry.desktop',
  version: process.env.TANGENTRY_VERSION || '0.0.3.4',
  main: './cmd/tangentry-desktop',
  out: '../build',
  frontendDist: './web/dist',
  resources: ['../docs/licenses'],
  ...(updatePublicKey
    ? { updates: { publicKey: updatePublicKey, github: 'mu-zi-lee/Tangentry' } }
    : {}),
  macos: {
    ...(minimumSystemVersion ? { minimumSystemVersion } : {}),
    signingIdentity: process.env.MACOS_SIGNING_IDENTITY || '-',
    ...(process.env.MACOS_NOTARY_PROFILE
      ? { notarize: { keychainProfile: process.env.MACOS_NOTARY_PROFILE, keychain: process.env.NOTARY_KEYCHAIN } }
      : {}),
    infoPlist: {
      LSApplicationCategoryType: 'public.app-category.productivity',
    },
  },
  // Unsigned unless CI provides a certificate; SmartScreen then warns users.
  windows: process.env.WINDOWS_CERTIFICATE_FILE ? { certificate: process.env.WINDOWS_CERTIFICATE_FILE } : {},
  linux: {
    comment: '个人多媒体内容聚合、发现与阅读',
    categories: ['AudioVideo', 'Network'],
    // The bundled whisper.cpp CPU backends use OpenMP; media processing uses
    // the distribution's FFmpeg instead of bundled libraries.
    depends: ['libgomp1', 'ffmpeg'],
    command: 'tangentry',
  },
}
