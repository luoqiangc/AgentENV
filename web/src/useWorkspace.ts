import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { APIError, loadWorkspace } from './api/client'
import {
  initialSandboxes,
  initialSnapshots,
  initialVolumes,
  initialTemplates,
} from './data'
import type { Sandbox, Snapshot, Volume } from './data'

export function useWorkspace(demo: boolean, enabled: boolean) {
  const [sampleSandboxes, setSandboxes] = useState(initialSandboxes)
  const [sampleSnapshots, setSnapshots] = useState(initialSnapshots)
  const [sampleTemplates, setTemplates] = useState(initialTemplates)
  const client = useQueryClient()
  const live = useQuery({
    queryKey: ['workspace'],
    queryFn: ({ signal }) => loadWorkspace(signal),
    enabled: !demo && enabled,
    refetchInterval: 10_000,
    retry: (count, error) =>
      !(error instanceof APIError && error.status === 401) && count < 1,
  })
  const sandboxes: Sandbox[] = demo
    ? sampleSandboxes
    : (live.data?.sandboxes ?? []).map((s) => ({
        id: s.sandboxID,
        name: s.metadata?.name || s.alias || s.sandboxID,
        image:
          s.metadata?.['dashboard.image'] ||
          s.alias ||
          s.templateID ||
          'Unknown image',
        state: s.state,
        cpu: s.cpuCount,
        memory: s.memoryMB,
        created: s.startedAt,
        purpose: s.metadata?.purpose || 'AgentENV sandbox',
      }))
  const snapshots: Snapshot[] = demo
    ? sampleSnapshots
    : (live.data?.snapshots ?? []).map((s) => ({
        id: s.snapshotID,
        name: s.names[0] || s.snapshotID,
        image: s.imageRef || 'Snapshot',
        cpu: s.cpuCount,
        memory: s.memoryMB,
        created: s.createdAt,
      }))
  const volumes: Volume[] = demo
    ? initialVolumes.map((v) => ({
        ...v,
        mounted: sandboxes.some((s) => s.name === v.mounted) ? v.mounted : null,
      }))
    : (live.data?.volumes ?? []).map((v) => ({
        id: v.volumeID,
        name: v.name,
        size: v.sizeMB / 1024,
        mode: v.mode === 'ro' ? 'ro' : 'exclusive',
        status: v.status,
        mounted:
          live.data?.sandboxes
            .filter((s) => s.volumeMounts?.some((m) => m.name === v.name))
            .map((s) => s.metadata?.name || s.sandboxID)
            .join(', ') || null,
      }))
  const nodes = live.data?.nodes ?? []
  return {
    sandboxes,
    snapshots,
    volumes,
    templates: demo ? sampleTemplates : (live.data?.templates ?? []),
    setTemplates,
    setSandboxes,
    setSnapshots,
    live,
    capacityCPU: demo
      ? 16
      : nodes.reduce((n, node) => n + node.metrics.cpuCount, 0),
    capacityMemory: demo
      ? 32768
      : nodes.reduce(
          (n, node) => n + node.metrics.memoryTotalBytes / 1048576,
          0,
        ),
    nodeLabel: demo
      ? 'local-node-01'
      : nodes.length === 1
        ? nodes[0].id
        : `${nodes.length} nodes`,
    refresh: () => client.invalidateQueries({ queryKey: ['workspace'] }),
    reset: () => {
      setSandboxes(initialSandboxes)
      setSnapshots(initialSnapshots)
      setTemplates(initialTemplates)
    },
  }
}
