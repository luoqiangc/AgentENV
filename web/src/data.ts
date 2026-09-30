import type { APITemplate } from './api/client'

export type Sandbox = {
  id: string
  name: string
  image: string
  state: 'running' | 'paused'
  cpu: number
  memory: number
  created: string
  purpose: string
}
export type Snapshot = {
  id: string
  name: string
  image: string
  size?: string
  created: string
  cpu: number
  memory: number
}
export type Volume = {
  id: string
  name: string
  size: number
  used?: number
  status?: string
  mode: 'exclusive' | 'ro'
  mounted: string | null
}

export const initialSandboxes: Sandbox[] = [
  {
    id: 'sbx_7f2a9c',
    name: 'research-agent',
    image: 'python:3.12',
    state: 'running',
    cpu: 2,
    memory: 2048,
    created: '2026-10-01T08:42:00',
    purpose: 'Research & analysis',
  },
  {
    id: 'sbx_3b8e1d',
    name: 'code-interpreter',
    image: 'python:3.12',
    state: 'running',
    cpu: 2,
    memory: 1024,
    created: '2026-10-01T08:30:00',
    purpose: 'Code execution',
  },
  {
    id: 'sbx_9d4c2f',
    name: 'browser-worker',
    image: 'ubuntu:24.04',
    state: 'running',
    cpu: 2,
    memory: 2048,
    created: '2026-10-01T08:18:00',
    purpose: 'Browser automation',
  },
  {
    id: 'sbx_1a6f3b',
    name: 'evaluation-runner',
    image: 'node:22',
    state: 'paused',
    cpu: 2,
    memory: 1024,
    created: '2026-10-01T07:56:00',
    purpose: 'Model evaluation',
  },
  {
    id: 'sbx_5e8b0a',
    name: 'data-workbench',
    image: 'python:3.12',
    state: 'running',
    cpu: 2,
    memory: 2048,
    created: '2026-10-01T07:35:00',
    purpose: 'Data processing',
  },
  {
    id: 'sbx_2c7d4e',
    name: 'quick-experiment',
    image: 'alpine:3.21',
    state: 'paused',
    cpu: 1,
    memory: 512,
    created: '2026-09-30T16:12:00',
    purpose: 'Experiment',
  },
]
export const initialSnapshots: Snapshot[] = [
  {
    id: 'snap_8c1a',
    name: 'python-research-ready',
    image: 'python:3.12',
    size: '482 MB',
    created: '2026-10-01T08:40:00',
    cpu: 2,
    memory: 2048,
  },
  {
    id: 'snap_4b2d',
    name: 'browser-base',
    image: 'ubuntu:24.04',
    size: '1.2 GB',
    created: '2026-09-30T14:20:00',
    cpu: 2,
    memory: 2048,
  },
  {
    id: 'snap_6e9f',
    name: 'minimal-workspace',
    image: 'alpine:3.21',
    size: '64 MB',
    created: '2026-09-29T10:05:00',
    cpu: 1,
    memory: 512,
  },
]
export const initialVolumes: Volume[] = [
  {
    id: 'vol_a31f',
    name: 'research-datasets',
    size: 20,
    used: 6.4,
    mode: 'ro',
    mounted: 'research-agent',
  },
  {
    id: 'vol_b82c',
    name: 'browser-downloads',
    size: 10,
    used: 2.1,
    mode: 'exclusive',
    mounted: 'browser-worker',
  },
  {
    id: 'vol_c45e',
    name: 'shared-artifacts',
    size: 50,
    used: 12.8,
    mode: 'ro',
    mounted: null,
  },
]
export const memoryLabel = (mb: number) =>
  mb < 1024 ? `${mb} MB` : `${Number((mb / 1024).toFixed(1))} GB`
export const dateLabel = (date: string) =>
  new Date(date).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

export const initialTemplates: APITemplate[] = [
  {
    templateID: 'tpl_python',
    buildID: 'build_python',
    names: ['python-workspace'],
    cpuCount: 2,
    memoryMB: 1024,
    diskSizeMB: 2048,
    public: false,
    createdAt: '2026-09-30T08:00:00Z',
    updatedAt: '2026-09-30T08:02:00Z',
    lastSpawnedAt: null,
    spawnCount: 0,
    buildCount: 1,
    envdVersion: 'demo',
    buildStatus: 'ready',
  },
]
