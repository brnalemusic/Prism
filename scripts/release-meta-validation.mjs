import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  assertTagMatchesVersions,
  parseReleaseTag,
  resolveReleaseMeta,
  semverMajorMinor
} from './release-meta.mjs'
import { androidVersionCode, syncVersions } from './sync-versions.mjs'

function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-release-'))
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.email=ci@example.com', '-c', 'user.name=CI', ...args], {
      cwd: dir,
      encoding: 'utf8'
    })
  git('init', '-q')
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), content)
  }
  return {
    dir,
    git,
    write,
    commit: (message) => {
      git('add', '-A')
      git('commit', '-q', '-m', message)
    },
    read: (file) => fs.readFileSync(path.join(dir, file), 'utf8')
  }
}

test('parses the slash tag format into both app prefixes', () => {
  const meta = parseReleaseTag('10.0-0.0/20270710')
  assert.equal(meta.desktopPrefix, '10.0')
  assert.equal(meta.mobilePrefix, '0.0')
  assert.equal(meta.date, '2027-07-10')
})

test('rejects malformed tags and impossible dates', () => {
  assert.throws(() => parseReleaseTag('9.3.0'), /invalid/)
  assert.throws(() => parseReleaseTag('10.0-0.0-20270710'), /invalid/)
  assert.throws(() => parseReleaseTag('10.0-0.0/20270231'), /invalid date/)
})

test('compares tag prefixes against full SemVer versions', () => {
  assert.equal(semverMajorMinor('10.0.3'), '10.0')
  assert.equal(semverMajorMinor('0.0.1'), '0.0')
  const tag = parseReleaseTag('10.0-0.0/20270710')
  assert.doesNotThrow(() => assertTagMatchesVersions(tag, '10.0.3', '0.0.1'))
  assert.throws(() => assertTagMatchesVersions(tag, '10.1.0', '0.0.1'), /desktop segment/)
  assert.throws(() => assertTagMatchesVersions(tag, '10.0.3', '0.1.0'), /mobile segment/)
})

test('first release builds both apps', () => {
  const repo = makeTempRepo()
  repo.write('version.txt', '9.3.0')
  repo.write('version_m.txt', '0.0.1')
  repo.commit('initial')
  repo.git('tag', '9.3-0.0/20261020')

  const meta = resolveReleaseMeta('9.3-0.0/20261020', repo.dir)
  assert.equal(meta.desktopChanged, true)
  assert.equal(meta.mobileChanged, true)
  assert.equal(meta.previousTag, null)
})

test('only a mobile version bump builds the mobile app', () => {
  const repo = makeTempRepo()
  repo.write('version.txt', '9.3.0')
  repo.write('version_m.txt', '0.0.1')
  repo.commit('initial')
  repo.git('tag', '9.3-0.0/20261020')

  repo.write('version_m.txt', '0.0.2')
  repo.write('mobile/app.json', '{"expo":{"version":"0.0.2"}}')
  repo.commit('mobile 0.0.2')
  repo.git('tag', '9.3-0.0/20261021')

  const meta = resolveReleaseMeta('9.3-0.0/20261021', repo.dir)
  assert.equal(meta.mobileChanged, true)
  assert.equal(meta.desktopChanged, false)
  assert.equal(meta.previousTag, '9.3-0.0/20261020')
})

test('a tag that changes no version file is rejected', () => {
  const repo = makeTempRepo()
  repo.write('version.txt', '9.3.0')
  repo.write('version_m.txt', '0.0.1')
  repo.commit('initial')
  repo.git('tag', '9.3-0.0/20261020')
  repo.write('README.md', 'docs only')
  repo.commit('docs')
  repo.git('tag', '9.3-0.0/20261021')

  assert.throws(() => resolveReleaseMeta('9.3-0.0/20261021', repo.dir), /Neither version/)
})

test('version sync updates both apps, preserves unchanged ones and is idempotent', () => {
  const repo = makeTempRepo()
  repo.write('version.txt', '9.3.0')
  repo.write('version_m.txt', '0.0.1')
  repo.write(
    'package.json',
    JSON.stringify({ name: 'prism', version: '9.3.0' }, null, 4) + '\n'
  )
  repo.write(
    'package-lock.json',
    JSON.stringify({ name: 'prism', version: '9.3.0', packages: { '': { version: '9.3.0' } } }, null, 2) + '\n'
  )
  repo.write(
    'README.md',
    '[![Version](https://img.shields.io/badge/version-9.3.0-38bdf8?style=flat)](https://github.com/brnalemusic/Prism)'
  )
  repo.write('mobile/package.json', JSON.stringify({ name: 'prism-mobile', version: '9.3.0' }, null, 2) + '\n')
  repo.write(
    'mobile/package-lock.json',
    JSON.stringify({ name: 'prism-mobile', version: '9.3.0', packages: { '': { version: '9.3.0' } } }, null, 2) + '\n'
  )
  repo.write(
    'mobile/app.json',
    JSON.stringify({ expo: { version: '9.3.0', android: { versionCode: 90300 } } }, null, 2) + '\n'
  )

  const first = syncVersions(repo.dir)
  assert.equal(first.desktop.changed, false)
  assert.equal(first.mobile.changed, true)
  assert.equal(first.mobile.versionCode, 1)

  const mobile = JSON.parse(repo.read('mobile/package.json'))
  const app = JSON.parse(repo.read('mobile/app.json'))
  const lock = JSON.parse(repo.read('mobile/package-lock.json'))
  assert.equal(mobile.version, '0.0.1')
  assert.equal(app.expo.version, '0.0.1')
  assert.equal(app.expo.android.versionCode, 1)
  assert.equal(lock.version, '0.0.1')
  assert.equal(lock.packages[''].version, '0.0.1')
  assert.match(repo.read('README.md'), /badge\/version-9\.3\.0-/)

  const second = syncVersions(repo.dir)
  assert.equal(second.desktop.changed, false)
  assert.equal(second.mobile.changed, false)

  repo.write('version.txt', '9.4.0')
  repo.write('version_m.txt', '0.0.2')
  const third = syncVersions(repo.dir)
  assert.equal(third.desktop.changed, true)
  assert.equal(third.mobile.changed, true)
  assert.equal(JSON.parse(repo.read('package.json')).version, '9.4.0')
  assert.equal(JSON.parse(repo.read('package-lock.json')).packages[''].version, '9.4.0')
  assert.match(repo.read('README.md'), /badge\/version-9\.4\.0-/)
})

test('Android version codes stay monotonic per SemVer bump', () => {
  assert.equal(androidVersionCode('0.0.1'), 1)
  assert.equal(androidVersionCode('0.2.5'), 205)
  assert.equal(androidVersionCode('10.0.3'), 100003)
})
