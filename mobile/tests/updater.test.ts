import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  compareVersions,
  formatBytes,
  isNewerVersion,
  parseMobileRelease,
  pickLatestRelease,
  releaseNotesExcerpt
} from '../src/lib/updater'

test('SemVer comparison follows precedence rules', () => {
  assert.equal(compareVersions('0.0.2', '0.0.1'), 1)
  assert.equal(compareVersions('0.1.0', '0.0.9'), 1)
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0)
  assert.equal(compareVersions('0.0.1', '0.0.2'), -1)
  assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.11'), -1)
  assert.equal(compareVersions('1.0.0', '1.0.0-rc.1'), 1)
  assert.equal(isNewerVersion('0.0.10', '0.0.9'), true)
  assert.equal(isNewerVersion('0.0.9', '0.0.9'), false)
})

test('mobile releases are parsed from their assets', () => {
  const release = parseMobileRelease({
    tag_name: '9.3-0.0/20261020',
    html_url: 'https://github.com/brnalemusic/Prism/releases/tag/x',
    published_at: '2026-10-20T10:00:00Z',
    body: '## Mobile\n- Streamed replies\n- Faster boot',
    assets: [
      {
        name: 'prism-mobile-0.0.2.apk',
        browser_download_url: 'https://example.com/app.apk'
      },
      {
        name: 'prism-mobile-0.0.2-unsigned.ipa',
        browser_download_url: 'https://example.com/app.ipa'
      },
      {
        name: 'prism-invisible-setup-9.3.0.exe',
        browser_download_url: 'https://example.com/setup.exe'
      }
    ]
  })

  assert.ok(release)
  assert.equal(release?.version, '0.0.2')
  assert.equal(release?.apkUrl, 'https://example.com/app.apk')
  assert.equal(release?.ipaUrl, 'https://example.com/app.ipa')
  assert.match(release?.notes ?? '', /Streamed replies/)
})

test('releases without a mobile package or with drafts are ignored', () => {
  assert.equal(
    parseMobileRelease({
      html_url: 'https://example.com',
      assets: [{ name: 'prism-invisible-setup-9.3.0.exe', browser_download_url: 'https://x' }]
    }),
    null
  )
  assert.equal(
    parseMobileRelease({
      draft: true,
      html_url: 'https://example.com',
      assets: [{ name: 'prism-mobile-0.0.2.apk', browser_download_url: 'https://x' }]
    }),
    null
  )
  assert.equal(
    parseMobileRelease({
      html_url: 'https://example.com',
      assets: [{ name: 'prism-mobile-not-semver.apk', browser_download_url: 'https://x' }]
    }),
    null
  )
})

test('latest release is the highest mobile version, not the newest entry', () => {
  const release = (version: string, draft = false) => ({
    html_url: `https://example.com/${version}`,
    draft,
    assets: [{ name: `prism-mobile-${version}.apk`, browser_download_url: `https://x/${version}` }]
  })
  const latest = pickLatestRelease([
    release('0.0.2'),
    release('0.0.10'),
    release('0.1.0', true),
    release('0.0.3')
  ])
  assert.equal(latest?.version, '0.0.10')
  assert.equal(pickLatestRelease([]), null)
  assert.equal(pickLatestRelease([{ html_url: 'https://x', assets: [] }]), null)
})

test('notes are trimmed to a readable excerpt', () => {
  const excerpt = releaseNotesExcerpt('# Title\n\n' + 'word '.repeat(200), 80)
  assert.ok(excerpt.length <= 81)
  assert.equal(excerpt.includes('#'), false)
  assert.equal(releaseNotesExcerpt(undefined), '')
})

test('byte formatting is human readable', () => {
  assert.equal(formatBytes(0), '')
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(1024 * 1024 * 1.5), '1.5 MB')
  assert.equal(formatBytes(1024 * 1024 * 24.5), '25 MB')
})
