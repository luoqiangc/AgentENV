import { useState } from 'react'
import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  Box,
  ChevronDown,
  Cpu,
  Plus,
  Search,
  Terminal,
  Trash2,
  Play,
} from 'lucide-react'
import { api } from './api/client'
import type {
  APITemplate,
  APITemplateBuild,
  TemplateReservation,
} from './api/client'
import { Dialog } from './Dialog'
import { dateLabel, memoryLabel } from './data'

const activeBuild = (status: string) =>
  status === 'waiting' || status === 'building'
const nameOf = (template: APITemplate) =>
  template.names[0] || template.templateID
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : 'The operation failed.'
const labels = {
  waiting: 'Waiting',
  building: 'Building',
  ready: 'Ready',
  error: 'Failed',
}

function BuildStatus({ status }: { status: APITemplate['buildStatus'] }) {
  return (
    <span className={`status build-status ${status}`}>
      <span />
      {labels[status] || status}
    </span>
  )
}

function CreateTemplate({
  demo,
  onClose,
  onCreated,
  onRefresh,
}: {
  demo: boolean
  onClose: () => void
  onCreated: (template: APITemplate) => void
  onRefresh: () => Promise<void>
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [reservation, setReservation] = useState<TemplateReservation | null>(
    null,
  )
  const [resources, setResources] = useState({ cpuCount: 2, memoryMB: 1024 })
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const name = String(data.get('name') || '').trim()
    const image = String(data.get('image') || '').trim()
    const { cpuCount, memoryMB } = resources
    if (!name || !image) {
      setError('Enter a template name and OCI image.')
      return
    }
    setPending(true)
    setError('')
    try {
      let record = reservation
      if (demo) {
        record = {
          templateID: `tpl_${crypto.randomUUID()}`,
          buildID: crypto.randomUUID(),
          names: [name],
          aliases: [name],
          tags: [],
          public: false,
        }
      } else {
        if (!record) {
          record = await api.reserveTemplate({ name, cpuCount, memoryMB })
          setReservation(record)
        }
        await api.startTemplateBuild(record.templateID, record.buildID, image)
        await onRefresh()
      }
      const now = new Date().toISOString()
      onCreated({
        templateID: record.templateID,
        buildID: record.buildID,
        names: record.names,
        cpuCount,
        memoryMB,
        diskSizeMB: 0,
        public: false,
        createdAt: now,
        updatedAt: now,
        lastSpawnedAt: null,
        spawnCount: 0,
        buildCount: 1,
        envdVersion: demo ? 'demo' : '',
        buildStatus: demo ? 'ready' : 'waiting',
      })
    } catch (error) {
      setError(messageOf(error))
      void onRefresh()
    } finally {
      setPending(false)
    }
  }
  return (
    <Dialog
      title="New template"
      onClose={() => {
        if (!pending) onClose()
      }}
    >
      <p className="dialog-description">
        Prepare an OCI image once. Launch fresh sandboxes from the saved
        environment.
      </p>
      {demo && (
        <div className="demo-callout">Demo only. No image will be pulled.</div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {reservation && (
        <p className="template-notice">
          Template registered. Retrying continues this build without creating
          another template.
        </p>
      )}
      <form onSubmit={(e) => void submit(e)}>
        <label className="form-field">
          Template name
          <input
            name="name"
            required
            maxLength={128}
            placeholder="e.g. python-dev"
            readOnly={pending || Boolean(reservation)}
            data-initial-focus
          />
        </label>
        <label className="form-field">
          OCI image
          <input
            name="image"
            required
            placeholder="e.g. python:3.12 or registry.example.com/team/image:tag"
            defaultValue="python:3.12"
            readOnly={pending}
          />
        </label>
        <div className="form-columns">
          <label className="form-field">
            CPU
            <span className="select-wrap">
              <select
                name="cpu"
                aria-label="Template CPU"
                value={resources.cpuCount}
                onChange={(e) =>
                  setResources((r) => ({
                    ...r,
                    cpuCount: Number(e.target.value),
                  }))
                }
                disabled={pending || Boolean(reservation)}
              >
                {[1, 2, 4].map((n) => (
                  <option value={n} key={n}>
                    {n} vCPU
                  </option>
                ))}
              </select>
              <ChevronDown size={16} />
            </span>
          </label>
          <label className="form-field">
            Memory
            <span className="select-wrap">
              <select
                name="memory"
                aria-label="Template memory"
                value={resources.memoryMB}
                onChange={(e) =>
                  setResources((r) => ({
                    ...r,
                    memoryMB: Number(e.target.value),
                  }))
                }
                disabled={pending || Boolean(reservation)}
              >
                {[512, 1024, 2048, 4096].map((n) => (
                  <option value={n} key={n}>
                    {memoryLabel(n)}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} />
            </span>
          </label>
        </div>
        <p className="template-notice">
          The image is imported as-is. Private registries use the runtime’s
          configured Docker credentials. Builds continue after you leave this
          page.
        </p>
        <div className="dialog-footer">
          <button
            type="button"
            className="button secondary"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="button primary" disabled={pending}>
            {pending
              ? 'Submitting…'
              : reservation
                ? 'Retry build'
                : 'Create template'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function TemplateDetails({
  template,
  demo,
  onClose,
  onLaunch,
  onDelete,
}: {
  template: APITemplate
  demo: boolean
  onClose: () => void
  onLaunch: () => void
  onDelete: () => void
}) {
  const [buildID, setBuildID] = useState(template.buildID)
  const history = useQuery({
    queryKey: ['workspace', 'template-builds', template.templateID],
    queryFn: ({ signal }) => api.templateBuilds(template.templateID, signal),
    enabled: !demo,
    refetchInterval: activeBuild(template.buildStatus) ? 2500 : false,
  })
  const build = useInfiniteQuery({
    queryKey: ['workspace', 'template-build', template.templateID, buildID],
    queryFn: ({ signal, pageParam }) =>
      api.templateBuild(template.templateID, buildID, pageParam, signal),
    initialPageParam: 0,
    getNextPageParam: (page, _pages, offset) =>
      page.logEntries.length === 100 ? offset + 100 : undefined,
    enabled: !demo && Boolean(buildID),
    refetchInterval: (query) =>
      !query.state.data || activeBuild(query.state.data.pages[0].status)
        ? 2500
        : false,
  })
  const info = build.data?.pages[0]
  const status = info?.status ?? template.buildStatus
  const entries = build.data?.pages.flatMap((page) => page.logEntries) ?? []
  const demoHistory: APITemplateBuild[] = [
    {
      buildID: template.buildID,
      status: template.buildStatus,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
      cpuCount: template.cpuCount,
      memoryMB: template.memoryMB,
    },
  ]
  return (
    <Dialog title="Template details" wide onClose={onClose}>
      <div className="template-detail-heading">
        <div>
          <h3>{nameOf(template)}</h3>
          <p>{template.templateID}</p>
        </div>
        <BuildStatus status={template.buildStatus} />
      </div>
      <dl className="detail-list template-facts">
        <div>
          <dt>Resources</dt>
          <dd>
            {template.cpuCount} vCPU · {memoryLabel(template.memoryMB)}
          </dd>
        </div>
        <div>
          <dt>Names</dt>
          <dd>{template.names.join(', ') || 'Unnamed'}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{dateLabel(template.createdAt)}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{dateLabel(template.updatedAt)}</dd>
        </div>
      </dl>
      <div className="template-build-heading">
        <h3>Build history</h3>
        <span>{(demo ? demoHistory : (history.data ?? [])).length} builds</span>
      </div>
      {history.error && (
        <p className="form-error" role="alert">
          {messageOf(history.error)}{' '}
          <button
            className="text-button"
            onClick={() => void history.refetch()}
          >
            Retry
          </button>
        </p>
      )}
      {history.isPending && !demo && (
        <p className="template-notice">Loading build history…</p>
      )}
      <div className="template-history" aria-label="Build history">
        {(demo ? demoHistory : (history.data ?? [])).map((item) => (
          <button
            key={item.buildID}
            className={`template-build-row ${buildID === item.buildID ? 'selected' : ''}`}
            aria-pressed={buildID === item.buildID}
            onClick={() => setBuildID(item.buildID)}
          >
            <code>{item.buildID}</code>
            <span>{dateLabel(item.createdAt)}</span>
            <BuildStatus status={item.status} />
          </button>
        ))}
      </div>
      <div className="template-build-heading">
        <h3>Build output</h3>
        <BuildStatus status={status} />
      </div>
      {info?.reason && (
        <div className="form-error" role="alert">
          <strong>{info.reason.message}</strong>
          {info.reason.step && <p>Step: {info.reason.step}</p>}
        </div>
      )}
      {build.error && (
        <p className="form-error" role="alert">
          {messageOf(build.error)}{' '}
          <button className="text-button" onClick={() => void build.refetch()}>
            Retry
          </button>
        </p>
      )}
      <pre className="template-logs" aria-label="Build logs" tabIndex={0}>
        {demo
          ? '[demo] Image imported. Template is ready.'
          : entries.length
            ? entries
                .map(
                  (entry) =>
                    `${entry.timestamp}  ${entry.level.toUpperCase()}${entry.step ? ` [${entry.step}]` : ''}  ${entry.message}`,
                )
                .join('\n')
            : build.isPending
              ? 'Loading build output…'
              : 'No build output yet.'}
      </pre>
      {build.hasNextPage && (
        <button
          className="text-button"
          disabled={build.isFetchingNextPage}
          onClick={() => void build.fetchNextPage()}
        >
          {build.isFetchingNextPage ? 'Loading…' : 'Load more logs'}
        </button>
      )}
      <div className="dialog-footer template-detail-actions">
        <button
          className="button danger"
          onClick={onDelete}
          disabled={template.buildStatus === 'building'}
          title={
            template.buildStatus === 'building'
              ? 'Wait for the build to finish before deleting.'
              : undefined
          }
        >
          <Trash2 size={16} />
          Delete template
        </button>
        <button
          className="button primary"
          onClick={onLaunch}
          disabled={template.buildStatus !== 'ready'}
        >
          <Play size={16} />
          Launch sandbox
        </button>
      </div>
    </Dialog>
  )
}

export function Templates({
  templates,
  demo,
  onDemoChange,
  onRefresh,
  onLaunch,
}: {
  templates: APITemplate[]
  demo: boolean
  onDemoChange: Dispatch<SetStateAction<APITemplate[]>>
  onRefresh: () => Promise<void>
  onLaunch: (template: APITemplate) => void
}) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState<APITemplate | null>(null)
  const [deleting, setDeleting] = useState<APITemplate | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const current =
    selected &&
    (templates.find((t) => t.templateID === selected.templateID) ?? selected)
  const filtered = templates.filter(
    (t) =>
      `${nameOf(t)} ${t.templateID} ${t.names.join(' ')}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (filter === 'all' ||
        (filter === 'active'
          ? activeBuild(t.buildStatus)
          : t.buildStatus === filter)),
  )
  const remove = async () => {
    if (!deleting) return
    setPending(true)
    setError('')
    try {
      if (demo)
        onDemoChange((all) =>
          all.filter((t) => t.templateID !== deleting.templateID),
        )
      else {
        await api.deleteTemplate(deleting.templateID)
        await onRefresh()
      }
      setDeleting(null)
      setSelected(null)
    } catch (error) {
      setError(messageOf(error))
    } finally {
      setPending(false)
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">BUILD ONCE. START FRESH.</div>
          <h1>Templates</h1>
          <p>Your reusable environments, ready for the next sandbox.</p>
        </div>
        <button className="button primary" onClick={() => setCreating(true)}>
          <Plus size={17} />
          New template
        </button>
      </div>
      <div className="template-toolbar">
        <div className="segmented" aria-label="Filter templates">
          {[
            ['all', 'All'],
            ['ready', 'Ready'],
            ['active', 'In progress'],
            ['error', 'Failed'],
          ].map(([value, label]) => (
            <button
              key={value}
              className={filter === value ? 'selected' : ''}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label="Search templates"
            placeholder="Find a template…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      {filtered.length ? (
        <div className="panel template-table-wrap">
          <table className="template-table">
            <thead>
              <tr>
                <th>Template</th>
                <th>Status</th>
                <th>Resources</th>
                <th>Updated</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((template) => (
                <tr key={template.templateID}>
                  <td>
                    <button
                      className="template-name"
                      onClick={() => setSelected(template)}
                    >
                      <span className="template-symbol">
                        <Box size={22} strokeWidth={1.6} />
                      </span>
                      <span>
                        <strong>{nameOf(template)}</strong>
                        <small>{template.templateID}</small>
                      </span>
                    </button>
                  </td>
                  <td>
                    <BuildStatus status={template.buildStatus} />
                  </td>
                  <td>
                    <span className="template-resources">
                      <Cpu size={14} />
                      {template.cpuCount} vCPU ·{' '}
                      {memoryLabel(template.memoryMB)}
                    </span>
                  </td>
                  <td className="template-updated">
                    {dateLabel(template.updatedAt)}
                  </td>
                  <td>
                    <div className="template-row-actions">
                      <button
                        className="icon-button"
                        aria-label={`Build details for ${nameOf(template)}`}
                        title="Build details and logs"
                        onClick={() => setSelected(template)}
                      >
                        <Terminal size={17} />
                      </button>
                      <button
                        className="button secondary"
                        aria-label={`Launch ${nameOf(template)}`}
                        disabled={template.buildStatus !== 'ready'}
                        onClick={() => onLaunch(template)}
                      >
                        <Play size={14} />
                        Launch
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Delete template ${nameOf(template)}`}
                        disabled={template.buildStatus === 'building'}
                        onClick={() => {
                          setError('')
                          setDeleting(template)
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel template-empty">
          <Box size={36} strokeWidth={1.2} />
          <h3>
            {templates.length
              ? 'No matching templates'
              : 'A good starting point, saved.'}
          </h3>
          <p>
            {templates.length
              ? 'Try another search or build status.'
              : 'Import an OCI image to prepare your first reusable environment.'}
          </p>
          {!templates.length && (
            <button
              className="button primary"
              onClick={() => setCreating(true)}
            >
              <Plus size={16} />
              Create your first template
            </button>
          )}
        </div>
      )}
      <p className="template-footnote">
        Templates prepare reusable environments. Snapshots save checkpoints from
        existing sandboxes.{demo && ' This is a simulated workspace.'}
      </p>
      {creating && (
        <CreateTemplate
          demo={demo}
          onClose={() => setCreating(false)}
          onRefresh={onRefresh}
          onCreated={(template) => {
            if (demo) onDemoChange((all) => [template, ...all])
            setCreating(false)
            setSelected(template)
          }}
        />
      )}
      {current && !deleting && (
        <TemplateDetails
          key={current.templateID}
          template={current}
          demo={demo}
          onClose={() => setSelected(null)}
          onLaunch={() => {
            setSelected(null)
            onLaunch(current)
          }}
          onDelete={() => {
            setError('')
            setDeleting(current)
          }}
        />
      )}
      {deleting && (
        <Dialog
          title="Delete template"
          onClose={() => {
            if (!pending) setDeleting(null)
          }}
        >
          <p className="dialog-description">
            Delete <strong>{nameOf(deleting)}</strong>? Its saved build will no
            longer be available for new sandboxes. Existing sandboxes keep
            running.
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-footer">
            <button
              className="button secondary"
              disabled={pending}
              onClick={() => setDeleting(null)}
            >
              Cancel
            </button>
            <button
              className="button danger"
              disabled={pending}
              onClick={() => void remove()}
            >
              {pending ? 'Deleting…' : 'Delete template'}
            </button>
          </div>
        </Dialog>
      )}
    </>
  )
}
