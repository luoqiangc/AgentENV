import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { Sandbox } from './data'

export default function LiveShell({ sandbox }: { sandbox: Sandbox }) {
  const host = useRef<HTMLDivElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState('Connecting…')
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"SFMono-Regular", Consolas, monospace',
      scrollback: 5000,
      theme: {
        background: '#1c2028',
        foreground: '#d4dcea',
        cursor: '#8fb7f6',
      },
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host.current!)
    fit.fit()
    let ready = false,
      initialized = false,
      disposed = false,
      ended = false,
      buffered = 0
    const size = () => ({
      cols: Math.max(2, Math.min(500, terminal.cols)),
      rows: Math.max(1, Math.min(200, terminal.rows)),
    })
    const url = new URL(
      `/dashboard/shell/${encodeURIComponent(sandbox.id)}`,
      location.href,
    )
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const dimensions = size()
    let lastSize = dimensions
    url.search = new URLSearchParams({
      cols: String(dimensions.cols),
      rows: String(dimensions.rows),
    }).toString()
    const socket = new WebSocket(url)
    socket.binaryType = 'arraybuffer'
    setStatus('Connecting…')
    setConnected(false)
    const resize = () => {
      if (disposed) return
      fit.fit()
      const next = size()
      if (
        ready &&
        socket.readyState === WebSocket.OPEN &&
        (next.cols !== lastSize.cols || next.rows !== lastSize.rows)
      ) {
        socket.send(JSON.stringify({ type: 'resize', ...next }))
        lastSize = next
      }
    }
    socket.onmessage = (event) => {
      if (disposed) return
      if (event.data instanceof ArrayBuffer) {
        const chunk = new Uint8Array(event.data)
        buffered += chunk.length
        if (buffered > 8 * 1024 * 1024) {
          ended = true
          setStatus('Output exceeded the terminal buffer. Open a new session.')
          socket.close()
          return
        }
        terminal.write(chunk, () => {
          buffered -= chunk.length
          // Finish initial terminal queries before accepting human input.
          if (ready && !initialized && !disposed) {
            initialized = true
            setConnected(true)
            setStatus('Connected')
            resize()
            terminal.focus()
          }
        })
        return
      }
      try {
        const message = JSON.parse(event.data)
        if (message.type === 'ready') {
          ready = true
        } else if (message.type === 'exit') {
          ended = true
          setStatus(`Shell exited (${message.code}).`)
          terminal.writeln(`\r\n[Shell exited: ${message.code}]`)
        } else if (message.type === 'error') {
          ended = true
          setStatus(message.message)
          terminal.writeln(`\r\n[${message.message}]`)
        }
      } catch {
        ended = true
        setStatus('Invalid terminal response.')
        socket.close()
      }
    }
    socket.onclose = () => {
      if (!disposed) {
        ready = false
        setConnected(false)
        if (!ended) {
          setStatus('Disconnected. Check your session and sandbox state.')
          terminal.writeln('\r\n[Disconnected]')
        }
      }
    }
    socket.onerror = () => {
      if (!disposed)
        setStatus('Unable to connect. Check your login and sandbox state.')
    }
    const input = terminal.onData((data) => {
      if (ready && socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: 'input', data }))
    })
    const observer = new ResizeObserver(resize)
    observer.observe(host.current!)
    return () => {
      disposed = true
      observer.disconnect()
      input.dispose()
      socket.close()
      terminal.dispose()
    }
  }, [sandbox.id, attempt])
  return (
    <div className="webshell">
      <div className="shell-toolbar">
        <span>{sandbox.name}</span>
        <span role="status">{status}</span>
      </div>
      <div
        ref={host}
        className="live-terminal"
        aria-label={`Terminal for ${sandbox.name}`}
      />
      <div className="shell-footer">
        <span>Closing this panel ends the shell process, not the sandbox.</span>
        {!connected && (
          <button
            className="text-button"
            onClick={() => setAttempt((n) => n + 1)}
          >
            New session
          </button>
        )}
      </div>
    </div>
  )
}
