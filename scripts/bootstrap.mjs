#!/usr/bin/env node
// Cross-platform first-time setup (Windows, macOS, Linux): `pnpm bootstrap`.
// Checks prerequisites, creates local .env files and installs JS + Python dependencies.
import { execSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const isWindows = process.platform === 'win32'

const install = {
  node: {
    win32: 'winget install OpenJS.NodeJS.LTS',
    darwin: 'brew install node@22',
    linux: 'https://nodejs.org/en/download',
  },
  pnpm: { all: 'corepack enable pnpm' },
  uv: {
    win32: 'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"',
    darwin: 'brew install uv',
    linux: 'curl -LsSf https://astral.sh/uv/install.sh | sh',
  },
  docker: {
    win32: 'winget install Docker.DockerDesktop',
    darwin: 'brew install --cask docker',
    linux: 'https://docs.docker.com/engine/install/',
  },
}

const hint = (tool) => install[tool].all ?? install[tool][process.platform] ?? install[tool].linux

function version(cmd) {
  try {
    return execSync(`${cmd} --version`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return null
  }
}

function run(cmd, args, cwd = root) {
  console.log(`\n> ${cmd} ${args.join(' ')}`)
  // shell: true resolves pnpm.cmd / uv.exe on Windows the same way a terminal does.
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: isWindows })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

console.log('Checking prerequisites…')
const missing = []

const [major] = process.versions.node.split('.').map(Number)
if (major < 22) missing.push(['node', `Node 22+ is required (found ${process.versions.node})`])
for (const tool of ['pnpm', 'uv']) {
  const found = version(tool)
  if (found) console.log(`  ✓ ${tool} ${found}`)
  else missing.push([tool, `${tool} is not on PATH`])
}

if (missing.length) {
  console.error('\nMissing prerequisites:')
  for (const [tool, why] of missing) console.error(`  ✗ ${why}\n      install: ${hint(tool)}`)
  process.exit(1)
}

const docker = version('docker')
if (docker) console.log(`  ✓ ${docker}`)
else console.warn(`  ! docker not found — needed for Postgres/Redis. install: ${hint('docker')}`)

console.log('\nCreating local env files…')
for (const dir of ['.', 'apps/api', 'apps/web', 'apps/extension']) {
  const example = join(root, dir, '.env.example')
  const target = join(root, dir, '.env')
  if (!existsSync(example)) continue
  if (existsSync(target)) {
    console.log(`  · ${dir}/.env exists, left as is`)
  } else {
    copyFileSync(example, target)
    console.log(`  ✓ ${dir}/.env`)
  }
}

run('pnpm', ['install'])
run('uv', ['sync', '--directory', 'apps/api'])

console.log(`
Done. Next:
  pnpm services:up   start Postgres and Redis (Docker)
  pnpm migrate       create the database schema
  pnpm dev           API on :8000, web on :5173, extension in watch mode
`)
