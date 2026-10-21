import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const isWindows = process.platform === 'win32';

function isSupportedJdk(javaHome) {
  const java = join(javaHome, 'bin', isWindows ? 'java.exe' : 'java');
  if (!existsSync(java)) return false;

  const result = spawnSync(java, ['-version'], { encoding: 'utf8' });
  const output = `${result.stderr ?? ''}${result.stdout ?? ''}`;
  const match = output.match(/version "(\d+)(?:\.(\d+))?/);
  if (!match) return false;

  const major = Number(match[1]);
  const minor = Number(match[2] ?? 0);
  return major >= 17 || (major === 1 && minor >= 17);
}

function resolveJdk() {
  const candidates = [
    process.env.JAVA_HOME,
    isWindows ? 'C:\\Program Files\\Android\\Android Studio\\jbr' : undefined,
    process.env.ANDROID_STUDIO_JBR,
  ];

  return candidates.find((candidate) => candidate && isSupportedJdk(candidate));
}

const javaHome = resolveJdk();
if (javaHome) {
  process.env.JAVA_HOME = javaHome;
} else if (isWindows) {
  console.error(
    'Prism mobile requires JDK 17 or newer. Set JAVA_HOME to a JDK 17+ installation.'
  );
  process.exit(1);
}

if (isWindows && !process.env.ANDROID_HOME) {
  const sdk = join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk');
  if (existsSync(sdk)) process.env.ANDROID_HOME = sdk;
}

// Keep the machine responsive during native builds unless the caller opted out.
if (!process.env.GRADLE_OPTS) {
  process.env.GRADLE_OPTS = '-Dorg.gradle.workers.max=2';
}

const args = [
  '--prefix',
  'mobile',
  'run',
  'android',
  '--',
  ...process.argv.slice(2),
];

const result = spawnSync('npm', args, {
  stdio: 'inherit',
  env: process.env,
  shell: isWindows,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
