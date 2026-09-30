import { StrictMode, Suspense, lazy, useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ArrowRight,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Command,
  Copy,
  Cpu,
  Database,
  FlaskConical,
  HardDrive,
  Layers,
  LayoutGrid,
  Menu,
  Monitor,
  Moon,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Terminal,
  Trash2,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { dateLabel, memoryLabel } from './data'
import type { Sandbox, Snapshot, Volume } from './data'
import '@fontsource-variable/dm-sans'
import './styles.css'
import { BrowserRouter, useLocation, useNavigate } from 'react-router'
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { APIError, api } from './api/client'
import { useWorkspace } from './useWorkspace'
import { Login } from './Login'
import { Dialog } from './Dialog'
import { Templates } from './Templates'
import type { APITemplate } from './api/client'
const LiveShell = lazy(() => import('./LiveShell'))
const queryClient = new QueryClient()
import { WebShell } from './WebShell'

type Page =
  'Overview' | 'Sandboxes' | 'Templates' | 'Snapshots' | 'Volumes' | 'Settings'
type Modal = 'create' | 'search' | 'help' | 'reset' | null
const pages: { name: Page; icon: LucideIcon }[] = [
  { name: 'Overview', icon: LayoutGrid },
  { name: 'Sandboxes', icon: Box },
  { name: 'Templates', icon: Box },
  { name: 'Snapshots', icon: Layers },
  { name: 'Volumes', icon: HardDrive },
]
const images = ['python:3.12', 'ubuntu:24.04', 'node:22', 'alpine:3.21']
const imageNames: Record<string, string> = {
  'python:3.12': 'Python',
  'ubuntu:24.04': 'Ubuntu',
  'node:22': 'Node.js',
  'alpine:3.21': 'Alpine',
}
function ImageIcon({
  image,
  small = false,
}: {
  image: string
  small?: boolean
}) {
  return (
    <span
      className={`image-icon ${image.split(':')[0]} ${small ? 'small' : ''}`}
    >
      <Terminal size={small ? 17 : 22} strokeWidth={1.7} />
    </span>
  )
}
function Status({ state }: { state: string }) {
  return (
    <span className={`status ${state}`}>
      <span />
      {state === 'running' ? 'Running' : state === 'paused' ? 'Paused' : state}
    </span>
  )
}
function Empty({
  title,
  text,
  action,
}: {
  title: string
  text: string
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <Box size={32} strokeWidth={1.2} />
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  )
}
function App() {
  const location = useLocation()
  const route = useNavigate()
  const client = useQueryClient()
  const demo = new URLSearchParams(location.search).get('demo') === '1'
  const page =
    (
      {
        '/': 'Overview',
        '/sandboxes': 'Sandboxes',
        '/templates': 'Templates',
        '/snapshots': 'Snapshots',
        '/volumes': 'Volumes',
        '/settings': 'Settings',
      } as Record<string, Page>
    )[location.pathname] ?? 'Overview'
  const session = useQuery({
    queryKey: ['session'],
    queryFn: ({ signal }) => api.session(signal),
    enabled: !demo,
    retry: false,
    refetchInterval: 60_000,
  })
  const workspace = useWorkspace(demo, Boolean(session.data?.authenticated))
  const {
    sandboxes,
    snapshots,
    volumes,
    templates,
    setTemplates,
    setSandboxes,
    setSnapshots,
    capacityCPU,
    capacityMemory,
    nodeLabel,
  } = workspace
  const [pending, setPending] = useState(false)
  const [actionError, setActionError] = useState('')
  const [modal, setModal] = useState<Modal>(null)
  const [shell, setShell] = useState<Sandbox | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedVolume, setSelectedVolume] = useState<Volume | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Sandbox | null>(null)
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [globalQuery, setGlobalQuery] = useState('')
  const [toast, setToast] = useState('')
  const [dark, setDark] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [createImage, setCreateImage] = useState('python:3.12')
  const [createSource, setCreateSource] = useState<
    | (Pick<Snapshot, 'id' | 'name' | 'image' | 'cpu' | 'memory'> & {
        kind: 'snapshot' | 'template'
      })
    | null
  >(null)
  const active = sandboxes.filter((s) => s.state === 'running')
  const cpu = active.reduce((n, s) => n + s.cpu, 0)
  const memory = active.reduce((n, s) => n + s.memory, 0)
  const detail = sandboxes.find((s) => s.id === selected)
  const filtered = sandboxes.filter(
    (s) =>
      (filter === 'all' || s.state === filter) &&
      `${s.name} ${s.id} ${s.image}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  )
  const navigate = (next: Page) => {
    route({
      pathname: next === 'Overview' ? '/' : `/${next.toLowerCase()}`,
      search: demo ? '?demo=1' : '',
    })
    setQuery('')
    setFilter('all')
    setMobileNav(false)
  }
  const notify = (message: string) => setToast(message)
  const perform = async (action: () => Promise<unknown>, message: string) => {
    setPending(true)
    setActionError('')
    try {
      await action()
      await workspace.refresh()
      notify(message)
      return true
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'The operation failed.',
      )
      return false
    } finally {
      setPending(false)
    }
  }
  const logout = async () => {
    try {
      await api.logout()
      await client.cancelQueries()
      client.removeQueries({ queryKey: ['workspace'] })
      client.setQueryData(['session'], null)
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Sign out failed.',
      )
    }
  }
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [dark])
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(''), 4000)
    return () => clearTimeout(id)
  }, [toast])
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setModal((m) => (m === 'search' ? null : 'search'))
      }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [])
  const openCreate = (
    image = 'python:3.12',
    snapshot: Snapshot | null = null,
  ) => {
    setCreateImage(image)
    setCreateSource(snapshot ? { ...snapshot, kind: 'snapshot' } : null)
    setModal('create')
  }
  const templateSource = (template: APITemplate) => ({
    id: template.templateID,
    name: template.names[0] || template.templateID,
    image: `Template: ${template.names[0] || template.templateID}`,
    cpu: template.cpuCount,
    memory: template.memoryMB,
    kind: 'template' as const,
  })
  const launchTemplate = (template: APITemplate) => {
    const source = templateSource(template)
    setCreateImage(source.image)
    setCreateSource(source)
    setActionError('')
    setModal('create')
  }
  const toggle = (sandbox: Sandbox) => {
    if (!demo) {
      void perform(
        () =>
          sandbox.state === 'running'
            ? api.pause(sandbox.id)
            : api.resume(sandbox.id),
        `${sandbox.name} ${sandbox.state === 'running' ? 'paused' : 'resumed'}.`,
      )
      return
    }
    setSandboxes((all) =>
      all.map((s) =>
        s.id === sandbox.id
          ? { ...s, state: s.state === 'running' ? 'paused' : 'running' }
          : s,
      ),
    )
    notify(
      `${sandbox.name} ${sandbox.state === 'running' ? 'paused' : 'resumed'} in the demo.`,
    )
  }
  const capture = (sandbox: Sandbox) => {
    if (!demo) {
      void perform(
        () => api.capture(sandbox.id, `${sandbox.name}-snapshot`),
        'Snapshot saved.',
      )
      return
    }
    setSnapshots((all) => [
      {
        id: `snap_${crypto.randomUUID().slice(0, 8)}`,
        name: `${sandbox.name}-snapshot`,
        image: sandbox.image,
        size: '128 MB',
        created: new Date().toISOString(),
        cpu: sandbox.cpu,
        memory: sandbox.memory,
      },
      ...all,
    ])
    notify(`Demo snapshot created for ${sandbox.name}.`)
  }
  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const name = String(data.get('name')).trim()
    if (!name) return
    if (!demo) {
      const metadata = { name, 'dashboard.image': createImage }
      const success = await perform(
        () =>
          createSource
            ? api.launch({
                templateID: createSource.id,
                timeout: 300,
                autoPause: true,
                metadata,
              })
            : api.create({
                image: createImage,
                cpuCount: Number(data.get('cpu')),
                memoryMB: Number(data.get('memory')),
                timeout: 300,
                autoPause: true,
                secure: true,
                metadata,
              }),
        `${name} is ready.`,
      )
      if (success) {
        setModal(null)
        navigate('Sandboxes')
      }
      return
    }
    setSandboxes((all) => [
      {
        id: `sbx_${crypto.randomUUID().slice(0, 8)}`,
        name,
        image: createImage,
        state: 'running',
        cpu: Number(data.get('cpu')),
        memory: Number(data.get('memory')),
        created: new Date().toISOString(),
        purpose: createSource
          ? `From ${createSource.name}`
          : 'Personal workspace',
      },
      ...all,
    ])
    setModal(null)
    navigate('Sandboxes')
    notify(`${name} is ready. Demo changes stay in this tab.`)
  }
  if (
    !demo &&
    (session.isPending ||
      !session.data?.authenticated ||
      (session.error instanceof APIError && session.error.status === 401) ||
      (workspace.live.error instanceof APIError &&
        workspace.live.error.status === 401))
  )
    return <Login checking={session.isPending} />
  if (!demo && !workspace.live.data)
    return (
      <main className="login-page">
        <section className="login-panel panel">
          <h1>
            {workspace.live.isError
              ? 'Workspace unavailable'
              : 'Opening your workspace…'}
          </h1>
          <p role={workspace.live.isError ? 'alert' : 'status'}>
            {workspace.live.error?.message ??
              'Loading environments, snapshots, volumes and nodes.'}
          </p>
          <button
            className="button primary"
            onClick={() => void workspace.refresh()}
          >
            Retry
          </button>
          <button className="button secondary" onClick={() => void logout()}>
            Sign out
          </button>
        </section>
      </main>
    )
  const table = (items: Sandbox[], compact = false) => (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Sandbox</th>
            <th>Status</th>
            <th>Resources</th>
            {!compact && <th>Created</th>}
            <th>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.id}>
              <td>
                <button
                  className="sandbox-name"
                  onClick={() => setSelected(s.id)}
                >
                  <ImageIcon image={s.image} small />
                  <span>
                    <strong>{s.name}</strong>
                    <span>{compact ? s.image : s.id}</span>
                  </span>
                </button>
              </td>
              <td>
                <Status state={s.state} />
              </td>
              <td className="resources">
                {s.cpu} vCPU <span>·</span> {memoryLabel(s.memory)}
              </td>
              {!compact && (
                <td className="date-cell">{dateLabel(s.created)}</td>
              )}
              <td>
                <div className="row-actions">
                  <button
                    className="icon-button"
                    aria-label={`Open Web Shell for ${s.name}`}
                    title={
                      s.state === 'running'
                        ? 'Open Web Shell'
                        : 'Resume sandbox to open Web Shell'
                    }
                    disabled={pending || s.state !== 'running'}
                    onClick={() => setShell(s)}
                  >
                    <Terminal size={16} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`${s.state === 'running' ? 'Pause' : 'Resume'} ${s.name}`}
                    title={
                      s.state === 'running' ? 'Pause sandbox' : 'Resume sandbox'
                    }
                    disabled={pending}
                    onClick={() => toggle(s)}
                  >
                    {s.state === 'running' ? (
                      <Pause size={16} />
                    ) : (
                      <Play size={16} />
                    )}
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Details for ${s.name}`}
                    onClick={() => setSelected(s.id)}
                  >
                    <MoreHorizontal size={18} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length === 0 && (
        <Empty
          title="No sandboxes found"
          text="Try another search or create a fresh environment."
        />
      )}
    </div>
  )
  return (
    <div className="app-shell">
      {mobileNav && (
        <button
          className="nav-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside className={`sidebar ${mobileNav ? 'is-open' : ''}`}>
        <a
          href="#"
          className="brand"
          onClick={(e) => {
            e.preventDefault()
            navigate('Overview')
          }}
        >
          <span className="brand-mark">
            <Box size={23} strokeWidth={1.6} />
          </span>
          AgentENV
        </a>
        <div className="workspace-switch">
          <span className="workspace-avatar">P</span>
          <div>
            <strong>
              {demo ? 'Personal workspace' : 'AgentENV workspace'}
            </strong>
            <span>{demo ? 'Local development' : 'Connected environment'}</span>
          </div>
          <span
            className="workspace-dot"
            aria-label={demo ? 'Demo workspace' : 'Connected workspace'}
          />
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav aria-label="Main navigation">
          {pages.map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={`nav-item ${page === name ? 'active' : ''}`}
              onClick={() => navigate(name)}
              aria-current={page === name ? 'page' : undefined}
            >
              <Icon size={19} strokeWidth={1.65} />
              {name}
              {name === 'Sandboxes' && (
                <span className="nav-count">{sandboxes.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="prototype-note">
            <FlaskConical size={18} />
            <strong>A space to explore</strong>
            <p>
              {demo ? (
                <>
                  Interactive preview. Sample data.
                  <br />
                  No infrastructure connected.
                </>
              ) : (
                <>
                  Live AgentENV connection.
                  <br />
                  Actions affect real resources.
                </>
              )}
            </p>
            <button onClick={() => setModal('help')}>
              About this preview <ArrowRight size={13} />
            </button>
          </div>
          <button
            className={`nav-item ${page === 'Settings' ? 'active' : ''}`}
            onClick={() => navigate('Settings')}
          >
            <Settings2 size={19} strokeWidth={1.65} />
            Settings
          </button>
          <button className="nav-item" onClick={() => setModal('help')}>
            <CircleHelp size={19} strokeWidth={1.65} />
            Help & shortcuts
          </button>
          <div className="profile">
            <span className="profile-avatar">D</span>
            <div>
              <strong>{demo ? 'Demo workspace' : 'Live workspace'}</strong>
              <span>
                {demo ? 'Changes stay in this tab' : 'Authenticated session'}
              </span>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={21} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{page}</strong>
          </div>
          <div className="topbar-actions">
            <button
              className="global-search"
              onClick={() => {
                setGlobalQuery('')
                setModal('search')
              }}
            >
              <Search size={16} />
              <span>Search anything</span>
              <kbd>⌘ K</kbd>
            </button>
            <span className="preview-label">{demo ? 'Prototype' : 'Live'}</span>
            <button
              className="theme-toggle icon-button"
              onClick={() => setDark(!dark)}
              aria-label={`Switch to ${dark ? 'light' : 'dark'} appearance`}
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </header>
        <main id="main-content" key={page}>
          {(actionError || (!demo && workspace.live.isError)) && (
            <div className="workspace-error" role="alert">
              {actionError ||
                `Refresh failed. Showing previously loaded data. ${workspace.live.error?.message}`}
              <button
                onClick={() => {
                  setActionError('')
                  void workspace.refresh()
                }}
              >
                Retry refresh
              </button>
            </div>
          )}
          {!demo && (
            <div className="live-status">
              <span>
                Live data · refreshed{' '}
                {workspace.live.dataUpdatedAt
                  ? new Date(workspace.live.dataUpdatedAt).toLocaleTimeString()
                  : '—'}
              </span>
              <button
                disabled={workspace.live.isFetching}
                onClick={() => void workspace.refresh()}
              >
                {workspace.live.isFetching ? 'Refreshing…' : 'Refresh'}
              </button>
              <button onClick={() => void logout()}>Sign out</button>
            </div>
          )}
          {page !== 'Templates' && (
            <div className="page-heading">
              <div>
                <div className="eyebrow">YOUR WORKSPACE, IN FOCUS</div>
                <h1>
                  {page === 'Overview' ? 'A little room for big ideas.' : page}
                </h1>
                <p>
                  {
                    {
                      Overview:
                        'A clear view of your environments. And space for what’s next.',
                      Sandboxes:
                        'Isolated environments. Ready for whatever you’re building.',
                      Templates: 'Reusable environments, ready when you are.',
                      Snapshots:
                        'Save a moment. Pick up right where you left off.',
                      Volumes:
                        'A lasting home for data, across every environment.',
                      Settings: 'Make this workspace feel like yours.',
                    }[page]
                  }
                </p>
              </div>
              {page !== 'Settings' && (
                <button className="button primary" onClick={() => openCreate()}>
                  <Plus size={17} />
                  New sandbox
                </button>
              )}
            </div>
          )}
          {page === 'Templates' && (
            <Templates
              templates={templates}
              demo={demo}
              onDemoChange={setTemplates}
              onRefresh={workspace.refresh}
              onLaunch={launchTemplate}
            />
          )}
          {page === 'Overview' && (
            <>
              <div className="metrics-grid">
                {[
                  {
                    name: 'Running sandboxes',
                    value: active.length,
                    suffix: '',
                    note: `${sandboxes.length - active.length} paused · ${sandboxes.length} total`,
                    icon: Box,
                    tone: 'blue',
                  },
                  {
                    name: 'Allocated CPU',
                    value: cpu,
                    suffix: 'vCPU',
                    note: `of ${capacityCPU} vCPU ${demo ? 'demo ' : ''}capacity`,
                    icon: Cpu,
                    tone: 'violet',
                  },
                  {
                    name: 'Allocated memory',
                    value: Number((memory / 1024).toFixed(1)),
                    suffix: 'GB',
                    note: `of ${memoryLabel(capacityMemory)} ${demo ? 'demo ' : ''}capacity`,
                    icon: Database,
                    tone: 'orange',
                  },
                  {
                    name: 'Saved snapshots',
                    value: snapshots.length,
                    suffix: '',
                    note: 'Ready to launch again',
                    icon: Layers,
                    tone: 'green',
                  },
                ].map((m) => (
                  <div className="metric-card" key={m.name}>
                    <div className="metric-label">
                      <span>{m.name}</span>
                      <span className={`metric-icon ${m.tone}`}>
                        <m.icon size={17} />
                      </span>
                    </div>
                    <div className="metric-number">
                      {m.value}
                      <span>{m.suffix}</span>
                    </div>
                    <div className="metric-note">
                      {m.name === 'Running sandboxes' && (
                        <i className="green-dot" />
                      )}
                      {m.note}
                    </div>
                  </div>
                ))}
              </div>
              <div className="overview-middle">
                <section className="launch-panel">
                  <div className="launch-copy">
                    <span className="eyebrow">A FRESH START</span>
                    <h2>
                      Your next environment.
                      <br />
                      One click closer.
                    </h2>
                    <p>
                      Start with a familiar image.
                      <br />
                      Make something entirely your own.
                    </p>
                    <button
                      className="text-button"
                      onClick={() => navigate('Snapshots')}
                    >
                      Or launch from a snapshot <ArrowRight size={15} />
                    </button>
                  </div>
                  <div className="image-options">
                    {images.map((image) => (
                      <button
                        className="image-option"
                        key={image}
                        onClick={() => openCreate(image)}
                      >
                        <ImageIcon image={image} />
                        <strong>{imageNames[image]}</strong>
                        <span>{image.split(':')[1]}</span>
                        <Plus size={14} className="image-plus" />
                      </button>
                    ))}
                  </div>
                </section>
                <section className="capacity-panel panel">
                  <div className="section-heading">
                    <h2>Room to grow</h2>
                    <span className="subtle-tag">
                      {demo ? 'Demo node' : 'Node capacity'}
                    </span>
                  </div>
                  <div className="capacity-main">
                    <div
                      className="capacity-ring"
                      style={
                        {
                          '--progress': `${Math.min(memory / (capacityMemory || 1), 1) * 100}%`,
                        } as React.CSSProperties
                      }
                    >
                      <div>
                        <strong>
                          {Math.round((memory / (capacityMemory || 1)) * 100)}
                          <small>%</small>
                        </strong>
                        <span>memory allocated</span>
                      </div>
                    </div>
                    <div className="capacity-legend">
                      <span>
                        <i className="legend-dot blue" />
                        Allocated<strong>{memoryLabel(memory)}</strong>
                      </span>
                      <span>
                        <i className="legend-dot gray" />
                        Available
                        <strong>
                          {memoryLabel(Math.max(capacityMemory - memory, 0))}
                        </strong>
                      </span>
                    </div>
                  </div>
                  <div className="node-caption">
                    <Server size={15} />
                    <span>{nodeLabel}</span>
                    <span className="node-caption-end">
                      {capacityCPU} cores · {memoryLabel(capacityMemory)}
                    </span>
                  </div>
                </section>
              </div>
              <section className="panel">
                <div className="section-heading table-heading">
                  <div>
                    <h2>
                      Your sandboxes{' '}
                      <span className="heading-count">{sandboxes.length}</span>
                    </h2>
                    <p>A place for every task.</p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => navigate('Sandboxes')}
                  >
                    View all <ArrowRight size={15} />
                  </button>
                </div>
                {table(sandboxes.slice(0, 4), true)}
              </section>
              <div className="overview-footer">
                <ShieldCheck size={15} />
                <span>Isolated by design. Powered by Firecracker.</span>
                <span className="footer-right">
                  {demo
                    ? 'Sample workspace · interactive preview'
                    : 'AgentENV · live workspace'}
                </span>
              </div>
            </>
          )}
          {page === 'Sandboxes' && (
            <section className="panel">
              <div className="table-toolbar">
                <div className="segmented" aria-label="Filter sandboxes">
                  {['all', 'running', 'paused'].map((f) => (
                    <button
                      key={f}
                      aria-pressed={filter === f}
                      className={filter === f ? 'selected' : ''}
                      onClick={() => setFilter(f)}
                    >
                      {f === 'all'
                        ? 'All sandboxes'
                        : f[0].toUpperCase() + f.slice(1)}
                      <span>
                        {f === 'all'
                          ? sandboxes.length
                          : sandboxes.filter((s) => s.state === f).length}
                      </span>
                    </button>
                  ))}
                </div>
                <label className="search-field">
                  <Search size={16} />
                  <input
                    aria-label="Search sandboxes"
                    placeholder="Find a sandbox…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
              </div>
              {table(filtered)}
              <div className="table-footer">
                {filtered.length} environment{filtered.length !== 1 ? 's' : ''}
                <span>
                  {demo
                    ? 'Demo changes are local to this tab'
                    : 'Updates every 10 seconds'}
                </span>
              </div>
            </section>
          )}
          {page === 'Snapshots' && (
            <>
              <div className="collection-toolbar">
                <span>{snapshots.length} saved checkpoints</span>
                <label className="search-field">
                  <Search size={16} />
                  <input
                    aria-label="Search snapshots"
                    placeholder="Find a snapshot…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
              </div>
              <div className="snapshot-grid">
                {snapshots
                  .filter((s) =>
                    `${s.name} ${s.image}`
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  )
                  .map((s) => (
                    <article className="snapshot-card panel" key={s.id}>
                      <div className="snapshot-art">
                        <span className="snapshot-layer layer-back" />
                        <span className="snapshot-layer layer-middle" />
                        <span className="snapshot-layer layer-front">
                          <Layers size={30} strokeWidth={1.2} />
                        </span>
                        <span className="snapshot-size">{s.size}</span>
                      </div>
                      <div className="snapshot-content">
                        <span className="eyebrow">{s.image}</span>
                        <h2>{s.name}</h2>
                        <p>{dateLabel(s.created)}</p>
                        <div className="snapshot-specs">
                          <span>
                            <Cpu size={14} />
                            {s.cpu} vCPU
                          </span>
                          <span>
                            <Database size={14} />
                            {memoryLabel(s.memory)}
                          </span>
                        </div>
                        <button
                          className="button secondary full-width"
                          onClick={() => openCreate(s.image, s)}
                        >
                          <Play size={15} />
                          Launch sandbox
                        </button>
                      </div>
                    </article>
                  ))}
              </div>
              {!snapshots.some((s) =>
                `${s.name} ${s.image}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              ) && (
                <Empty
                  title="No matching snapshots"
                  text="Try another search. You can also save a snapshot from sandbox details."
                />
              )}
              <div className="info-note">
                <Layers size={17} />
                <p>
                  Snapshots preserve a sandbox’s state. Open a sandbox to save a
                  new checkpoint.
                </p>
              </div>
            </>
          )}
          {page === 'Volumes' && (
            <>
              <div className="volume-summary panel">
                <span className="summary-icon">
                  <HardDrive size={27} />
                </span>
                <div>
                  <h2>Data that stays with you.</h2>
                  <p>Volumes live independently of your sandboxes.</p>
                </div>
                <div className="volume-total">
                  <strong>
                    {volumes.reduce((n, v) => n + v.size, 0)}
                    <span> GB</span>
                  </strong>
                  <span>Total provisioned</span>
                </div>
              </div>
              <section className="panel volume-list">
                {volumes.map((v) => (
                  <button
                    className="volume-row"
                    key={v.id}
                    onClick={() => setSelectedVolume(v)}
                  >
                    <span className="volume-icon">
                      <HardDrive size={23} strokeWidth={1.5} />
                    </span>
                    <span className="volume-title">
                      <strong>{v.name}</strong>
                      <span>
                        {v.status && v.status !== 'ready'
                          ? `Status: ${v.status}`
                          : v.mounted
                            ? `Mounted in ${v.mounted}`
                            : 'Not mounted'}
                      </span>
                    </span>
                    <span className="volume-usage">
                      <span>
                        {v.used === undefined
                          ? 'Usage unavailable'
                          : `${v.used} GB`}{' '}
                        <span>of {v.size} GB</span>
                      </span>
                      <span className="usage-track">
                        <span
                          style={{
                            width: `${((v.used ?? 0) / v.size) * 100}%`,
                          }}
                        />
                      </span>
                    </span>
                    <span className="mode-badge">
                      {v.mode === 'ro' ? 'Read only' : 'Exclusive'}
                    </span>
                    <ChevronRight size={17} />
                  </button>
                ))}
              </section>
              <div className="info-note">
                <ShieldCheck size={17} />
                <p>
                  Read-only volumes can be shared. Exclusive volumes have one
                  writable mount.
                </p>
              </div>
            </>
          )}
          {page === 'Settings' && (
            <div className="settings-stack">
              <section className="panel settings-section">
                <h2>Appearance</h2>
                <p>A familiar space, in the light you prefer.</p>
                <div className="appearance-options">
                  {[
                    { label: 'Light', value: false, icon: Sun },
                    { label: 'Dark', value: true, icon: Moon },
                  ].map(({ label, value, icon: Icon }) => (
                    <button
                      key={label}
                      className={`appearance-choice ${dark === value ? 'chosen' : ''}`}
                      aria-pressed={dark === value}
                      onClick={() => setDark(value)}
                    >
                      <div className={`appearance-mini ${label.toLowerCase()}`}>
                        <span />
                        <div>
                          <i />
                          <i />
                          <i />
                        </div>
                      </div>
                      <span>
                        <Icon size={16} />
                        {label}
                        {dark === value && <Check size={16} />}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
              <section className="panel settings-section">
                <div className="settings-row">
                  <div>
                    <h2>{demo ? 'Demo workspace' : 'Connected workspace'}</h2>
                    <p>
                      {demo
                        ? 'This prototype uses sample data. No API keys or server connections.'
                        : 'Authenticated through the Go gateway. Credentials are kept server-side.'}
                    </p>
                  </div>
                  <span className="subtle-tag">
                    {demo ? 'Local only' : 'Live API'}
                  </span>
                </div>
                <div className="settings-row divider">
                  <div>
                    <strong>
                      {demo ? 'Reset sample data' : 'End your session'}
                    </strong>
                    <p>
                      {demo
                        ? 'Restore the original sandboxes and snapshots in this tab.'
                        : 'Sign out and close active Web Shell sessions.'}
                    </p>
                  </div>
                  <button
                    className="button secondary"
                    onClick={() => (demo ? setModal('reset') : void logout())}
                  >
                    {demo ? 'Reset demo' : 'Sign out'}
                  </button>
                </div>
              </section>
              <section className="panel settings-section">
                <div className="settings-row">
                  <div>
                    <h2>AgentENV</h2>
                    <p>Snapshot-capable environments for your agents.</p>
                  </div>
                  <Box size={30} strokeWidth={1.3} />
                </div>
                <div className="settings-meta">
                  <span>Web dashboard</span>
                  <span>
                    {demo ? 'Interactive prototype' : 'Connected dashboard'}
                  </span>
                </div>
              </section>
            </div>
          )}
        </main>
      </div>
      {modal === 'create' && (
        <Dialog
          title={
            createSource ? `Launch from ${createSource.kind}` : 'New sandbox'
          }
          onClose={() => setModal(null)}
        >
          <p className="dialog-description">
            {createSource
              ? `Create an environment from ${createSource.name}.`
              : 'A clean environment for your next task.'}
          </p>
          <div className="demo-callout">
            <FlaskConical size={15} />
            {demo
              ? 'Preview only. No real resources will be created.'
              : 'Creates a real sandbox. It auto-pauses after 5 minutes.'}
          </div>
          {actionError && (
            <p className="form-error" role="alert">
              {actionError}
            </p>
          )}
          <form onSubmit={create}>
            {!createSource || createSource.kind === 'template' ? (
              <label className="form-field">
                Starting point
                <span className="select-wrap">
                  <select
                    aria-label="Starting point"
                    value={createSource?.id ?? ''}
                    onChange={(e) => {
                      const template = templates.find(
                        (t) => t.templateID === e.target.value,
                      )
                      if (template) {
                        const source = templateSource(template)
                        setCreateSource(source)
                        setCreateImage(source.image)
                      } else {
                        setCreateSource(null)
                        setCreateImage('python:3.12')
                      }
                    }}
                  >
                    <option value="">OCI image (cold start)</option>
                    {templates
                      .filter((t) => t.buildStatus === 'ready')
                      .map((t) => (
                        <option key={t.templateID} value={t.templateID}>
                          {t.names[0] || t.templateID}
                        </option>
                      ))}
                  </select>
                  <ChevronDown size={16} />
                </span>
              </label>
            ) : null}
            <label className="form-field">
              Sandbox name
              <input
                name="name"
                placeholder="e.g. my-research-agent"
                required
                maxLength={64}
                pattern="[a-zA-Z0-9][a-zA-Z0-9_-]*"
                title="Use letters, numbers, hyphens or underscores; start with a letter or number."
                data-initial-focus
              />
            </label>
            <label className="form-field">
              Base image
              <span className="select-wrap">
                <select
                  value={createImage}
                  disabled={Boolean(createSource)}
                  onChange={(e) => setCreateImage(e.target.value)}
                >
                  {!images.includes(createImage) && (
                    <option value={createImage}>{createImage}</option>
                  )}
                  {images.map((i) => (
                    <option key={i}>{i}</option>
                  ))}
                </select>
                <ChevronDown size={16} />
              </span>
            </label>
            <div className="form-columns" key={createSource?.id ?? 'cold'}>
              <label className="form-field">
                CPU
                <span className="select-wrap">
                  <select
                    disabled={!demo && Boolean(createSource)}
                    name="cpu"
                    aria-label="CPU"
                    defaultValue={createSource?.cpu ?? 2}
                  >
                    {createSource && ![1, 2, 4].includes(createSource.cpu) && (
                      <option value={createSource.cpu}>
                        {createSource.cpu} vCPU
                      </option>
                    )}
                    <option value="1">1 vCPU</option>
                    <option value="2">2 vCPU</option>
                    <option value="4">4 vCPU</option>
                  </select>
                  <ChevronDown size={16} />
                </span>
              </label>
              <label className="form-field">
                Memory
                <span className="select-wrap">
                  <select
                    disabled={!demo && Boolean(createSource)}
                    name="memory"
                    aria-label="Memory"
                    defaultValue={createSource?.memory ?? 1024}
                  >
                    {createSource &&
                      ![512, 1024, 2048, 4096].includes(
                        createSource.memory,
                      ) && (
                        <option value={createSource.memory}>
                          {memoryLabel(createSource.memory)}
                        </option>
                      )}
                    <option value="512">512 MB</option>
                    <option value="1024">1 GB</option>
                    <option value="2048">2 GB</option>
                    <option value="4096">4 GB</option>
                  </select>
                  <ChevronDown size={16} />
                </span>
              </label>
            </div>
            <div className="dialog-footer">
              <button
                type="button"
                className="button secondary"
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="button primary"
                disabled={pending}
              >
                <Plus size={16} />
                {pending ? 'Creating…' : 'Create sandbox'}
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {detail && (
        <Dialog
          title="Sandbox details"
          drawer
          onClose={() => setSelected(null)}
        >
          <div className="detail-hero">
            <ImageIcon image={detail.image} />
            <h3>{detail.name}</h3>
            <Status state={detail.state} />
          </div>
          <dl className="detail-list">
            <div>
              <dt>Sandbox ID</dt>
              <dd>
                <code>{detail.id}</code>
                <button
                  className="icon-button"
                  aria-label="Copy sandbox ID"
                  onClick={() => {
                    navigator.clipboard
                      .writeText(detail.id)
                      .then(() => notify('Sandbox ID copied.'))
                      .catch(() =>
                        notify(
                          'Copy unavailable. Select the ID to copy it manually.',
                        ),
                      )
                  }}
                >
                  <Copy size={14} />
                </button>
              </dd>
            </div>
            <div>
              <dt>Image</dt>
              <dd>{detail.image}</dd>
            </div>
            <div>
              <dt>Resources</dt>
              <dd>
                {detail.cpu} vCPU · {memoryLabel(detail.memory)}
              </dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{dateLabel(detail.created)}</dd>
            </div>
            <div>
              <dt>Purpose</dt>
              <dd>{detail.purpose}</dd>
            </div>
          </dl>
          <div className="detail-actions">
            {actionError && (
              <p className="form-error" role="alert">
                {actionError}
              </p>
            )}
            <button
              className="button primary"
              disabled={pending || detail.state !== 'running'}
              title={
                detail.state !== 'running'
                  ? 'Resume sandbox to open Web Shell'
                  : undefined
              }
              onClick={() => {
                setSelected(null)
                setShell(detail)
              }}
            >
              <Terminal size={16} />
              Open Web Shell
            </button>
            <button
              className="button secondary"
              disabled={pending}
              onClick={() => toggle(detail)}
            >
              {detail.state === 'running' ? (
                <Pause size={16} />
              ) : (
                <Play size={16} />
              )}
              {detail.state === 'running' ? 'Pause sandbox' : 'Resume sandbox'}
            </button>
            <button
              className="button secondary"
              disabled={pending || detail.state !== 'running'}
              title={
                detail.state !== 'running'
                  ? 'Resume the sandbox before saving a snapshot'
                  : undefined
              }
              onClick={() => capture(detail)}
            >
              <Layers size={16} />
              Save snapshot
            </button>
          </div>
          <div className="demo-callout">
            <FlaskConical size={15} />
            {demo
              ? 'Actions update sample data in this tab.'
              : 'Actions change the running AgentENV environment.'}
          </div>
          <button
            className="button danger full-width detail-delete"
            onClick={() => {
              setSelected(null)
              setDeleteTarget(detail)
            }}
          >
            <Trash2 size={16} />
            Delete sandbox
          </button>
        </Dialog>
      )}
      {shell && (
        <Dialog title="Web Shell" wide onClose={() => setShell(null)}>
          <Suspense
            fallback={<p className="dialog-description">Loading terminal…</p>}
          >
            {demo ? (
              <WebShell sandbox={shell} onExit={() => setShell(null)} />
            ) : (
              <LiveShell sandbox={shell} />
            )}
          </Suspense>
        </Dialog>
      )}
      {selectedVolume && (
        <Dialog title="Volume details" onClose={() => setSelectedVolume(null)}>
          <div className="detail-hero">
            <HardDrive size={32} strokeWidth={1.4} />
            <h3>{selectedVolume.name}</h3>
            <span className="subtle-tag">
              {demo ? 'Sample volume' : selectedVolume.status || 'Volume'}
            </span>
          </div>
          <dl className="detail-list">
            <div>
              <dt>Volume ID</dt>
              <dd>
                <code>{selectedVolume.id}</code>
              </dd>
            </div>
            <div>
              <dt>Capacity</dt>
              <dd>{selectedVolume.size} GB</dd>
            </div>
            <div>
              <dt>Used</dt>
              <dd>
                {selectedVolume.used === undefined
                  ? 'Not reported by API'
                  : `${selectedVolume.used} GB`}
              </dd>
            </div>
            <div>
              <dt>Access mode</dt>
              <dd>
                {selectedVolume.mode === 'ro'
                  ? 'Shared read-only'
                  : 'Exclusive writable'}
              </dd>
            </div>
            <div>
              <dt>Mounted in</dt>
              <dd>{selectedVolume.mounted ?? 'Not mounted'}</dd>
            </div>
          </dl>
        </Dialog>
      )}
      {deleteTarget && (
        <Dialog title="Delete sandbox?" onClose={() => setDeleteTarget(null)}>
          {actionError && (
            <p className="form-error" role="alert">
              {actionError}
            </p>
          )}
          <p className="dialog-description">
            Remove <strong>{deleteTarget.name}</strong>
            {demo ? ' from this demo' : ' permanently'}? Saved snapshots and
            volumes will be kept.
          </p>
          <div className="dialog-footer">
            <button
              className="button secondary"
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </button>
            <button
              className="button danger"
              disabled={pending}
              onClick={async () => {
                if (!demo) {
                  const ok = await perform(
                    () => api.remove(deleteTarget.id),
                    `${deleteTarget.name} deleted.`,
                  )
                  if (ok) setDeleteTarget(null)
                  return
                }
                setSandboxes((all) =>
                  all.filter((s) => s.id !== deleteTarget.id),
                )
                notify(`${deleteTarget.name} deleted from the demo.`)
                setDeleteTarget(null)
              }}
            >
              Delete sandbox
            </button>
          </div>
        </Dialog>
      )}
      {modal === 'reset' && (
        <Dialog title="Reset demo workspace?" onClose={() => setModal(null)}>
          <p className="dialog-description">
            Your changes to the sample sandboxes and snapshots will be replaced
            with the original examples.
          </p>
          <div className="dialog-footer">
            <button className="button secondary" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button
              className="button primary"
              onClick={() => {
                workspace.reset()
                setModal(null)
                notify('Demo workspace reset.')
              }}
            >
              Reset sample data
            </button>
          </div>
        </Dialog>
      )}
      {modal === 'search' && (
        <Dialog title="Search workspace" onClose={() => setModal(null)}>
          <label className="command-search">
            <Search size={20} />
            <input
              data-initial-focus
              aria-label="Search workspace"
              placeholder="Sandboxes, snapshots, pages…"
              value={globalQuery}
              onChange={(e) => setGlobalQuery(e.target.value)}
            />
          </label>
          <div className="command-results">
            {pages
              .filter((p) =>
                p.name.toLowerCase().includes(globalQuery.toLowerCase()),
              )
              .map(({ name, icon: Icon }) => (
                <button
                  key={name}
                  onClick={() => {
                    navigate(name)
                    setModal(null)
                  }}
                >
                  <Icon size={18} />
                  <span>{name}</span>
                  <ArrowRight size={15} />
                </button>
              ))}
            {sandboxes
              .filter((s) =>
                `${s.name} ${s.id}`
                  .toLowerCase()
                  .includes(globalQuery.toLowerCase()),
              )
              .map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    setModal(null)
                    setSelected(s.id)
                  }}
                >
                  <Box size={18} />
                  <span>
                    {s.name}
                    <small>Sandbox</small>
                  </span>
                  <Status state={s.state} />
                </button>
              ))}
            {snapshots
              .filter((s) =>
                s.name.toLowerCase().includes(globalQuery.toLowerCase()),
              )
              .map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    navigate('Snapshots')
                    setQuery(s.name)
                    setModal(null)
                  }}
                >
                  <Layers size={18} />
                  <span>
                    {s.name}
                    <small>Snapshot</small>
                  </span>
                  <ArrowRight size={15} />
                </button>
              ))}
            {!pages.some((p) =>
              p.name.toLowerCase().includes(globalQuery.toLowerCase()),
            ) &&
              !sandboxes.some((s) =>
                `${s.name} ${s.id}`
                  .toLowerCase()
                  .includes(globalQuery.toLowerCase()),
              ) &&
              !snapshots.some((s) =>
                s.name.toLowerCase().includes(globalQuery.toLowerCase()),
              ) && (
                <Empty
                  title="Nothing here yet"
                  text="Try a different name or sandbox ID."
                />
              )}
          </div>
          <div className="command-footer">
            <span>
              <Command size={12} /> K to open
            </span>
            <span>esc to close</span>
          </div>
        </Dialog>
      )}
      {modal === 'help' && (
        <Dialog title="A space to explore" onClose={() => setModal(null)}>
          <div className="help-symbol">
            <Sparkles size={30} strokeWidth={1.3} />
          </div>
          <p className="dialog-description">
            {demo
              ? 'This is an interactive preview of AgentENV.'
              : 'This workspace is connected to AgentENV.'}{' '}
            Explore the workspace, create a sandbox, pause it, or save a
            snapshot. {demo && 'All data is simulated.'}
          </p>
          <div className="help-item">
            <Monitor size={19} />
            <span>
              {demo
                ? 'No server connection or API key is needed.'
                : 'Your API key remains on the gateway after sign-in.'}
            </span>
          </div>
          <div className="help-item">
            <FlaskConical size={19} />
            <span>
              {demo
                ? 'Changes stay in this tab and reset on reload.'
                : 'Web Shell runs a real PTY. Closing it ends that shell process.'}
            </span>
          </div>
          <div className="help-item">
            <Command size={19} />
            <span>Press ⌘ K or Ctrl K to search. Escape closes dialogs.</span>
          </div>
          <div className="dialog-footer">
            <button className="button primary" onClick={() => setModal(null)}>
              Got it <ArrowRight size={15} />
            </button>
          </div>
        </Dialog>
      )}
      {toast && (
        <div className="toast" role="status">
          <span>
            <Check size={15} />
          </span>
          {toast}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast('')}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>,
)
