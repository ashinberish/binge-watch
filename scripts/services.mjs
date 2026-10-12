#!/usr/bin/env node
// `pnpm services:up` / `pnpm services:down`: Postgres + Redis via docker compose,
// with a readable message when the Docker engine isn't running.
import { spawnSync } from 'node:child_process'

const action = process.argv[2] === 'down' ? 'down' : 'up'
const shell = process.platform === 'win32'

const info = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
  encoding: 'utf8',
  shell,
})

if (info.error || info.status !== 0) {
  const notInstalled =
    info.error?.code === 'ENOENT' || /not recognized|not found/i.test(info.stderr)
  const steps = notInstalled
    ? {
        win32: 'Install Docker Desktop: winget install Docker.DockerDesktop',
        darwin: 'Install Docker Desktop: brew install --cask docker',
        linux: 'Install Docker Engine: https://docs.docker.com/engine/install/',
      }
    : {
        win32: [
          'Start Docker Desktop and wait until the tray icon says "Docker Desktop is running".',
          'Still failing? Run `wsl --update` in an admin PowerShell, and in Docker Desktop',
          'Settings > General turn on "Use the WSL 2 based engine".',
        ].join('\n  '),
        darwin: 'Start Docker Desktop and wait until it says it is running.',
        linux: 'Start the daemon: sudo systemctl start docker',
      }
  console.error(
    `\nDocker ${notInstalled ? 'is not installed' : 'is installed but its engine is not running'}.\n  ${
      steps[process.platform] ?? steps.linux
    }\n`,
  )
  process.exit(1)
}

const args =
  action === 'up' ? ['compose', 'up', '-d', '--wait', 'postgres', 'redis'] : ['compose', 'down']
const result = spawnSync('docker', args, { stdio: 'inherit', shell })
process.exit(result.status ?? 1)
