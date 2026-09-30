import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { Terminal } from 'lucide-react'
import type { Sandbox } from './data'

// Deliberately simulated: never execute commands or contact a sandbox.
export function WebShell({
  sandbox,
  onExit,
}: {
  sandbox: Sandbox
  onExit: () => void
}) {
  const [lines, setLines] = useState([
    'AgentENV · Demo shell',
    'No connection to a real sandbox. Type help to explore.',
    '',
  ])
  const [command, setCommand] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [cursor, setCursor] = useState(0)
  const draft = useRef('')
  const output = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (output.current) output.current.scrollTop = output.current.scrollHeight
  }, [lines])

  function submit(event: FormEvent) {
    event.preventDefault()
    const input = command.trim()
    if (!input) return
    setCommand('')
    setHistory((previous) => [...previous, input])
    setCursor(history.length + 1)
    draft.current = ''
    if (input === 'exit') {
      onExit()
      return
    }
    if (input === 'clear') {
      setLines([])
      return
    }
    let result: string
    switch (input) {
      case 'help':
        result =
          'Demo commands:\n  help       Show available commands\n  pwd        Show working directory\n  ls         List sample files\n  whoami     Show demo user\n  uname -a   Show simulated system info\n  cat README.md\n  echo TEXT  Print text (no shell expansion)\n  clear      Clear terminal\n  exit       Close shell\n\n↑ / ↓ command history · Ctrl L clear · Ctrl C cancel input'
        break
      case 'pwd':
        result = '/workspace'
        break
      case 'ls':
      case 'ls -la':
        result = 'README.md  main.py  data/'
        break
      case 'whoami':
        result = 'root'
        break
      case 'uname -a':
        result = `Linux ${sandbox.name} 6.1.0-demo x86_64 (simulated)`
        break
      case 'cat README.md':
        result =
          '# Demo workspace\nThis terminal is a visual prototype. Commands do not run inside a VM.'
        break
      default:
        result =
          input === 'echo'
            ? ''
            : input.startsWith('echo ')
              ? input.slice(5)
              : `Demo shell: unsupported command: ${input}\nType help for the available simulated commands.`
    }
    setLines((previous) => [
      ...previous,
      `root@${sandbox.name}:/workspace $ ${input}`,
      result,
      '',
    ])
  }
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.ctrlKey && ['c', 'l'].includes(event.key.toLowerCase())) {
      event.preventDefault()
      if (event.key.toLowerCase() === 'l') setLines([])
      else {
        setLines((previous) => [...previous, `$ ${command}^C`])
        setCommand('')
        setCursor(history.length)
        draft.current = ''
      }
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      if (cursor === history.length) draft.current = command
      const next = Math.max(
        0,
        Math.min(history.length, cursor + (event.key === 'ArrowUp' ? -1 : 1)),
      )
      setCursor(next)
      setCommand(next === history.length ? draft.current : history[next])
    }
  }
  return (
    <div className="webshell">
      <div className="shell-toolbar">
        <span>
          <Terminal size={15} />
          {sandbox.name}
        </span>
        <span>{sandbox.image} · Simulated session</span>
      </div>
      <div
        ref={output}
        className="shell-output"
        role="log"
        aria-label="Terminal output"
        aria-live="polite"
        tabIndex={0}
      >
        <pre>{lines.join('\n')}</pre>
      </div>
      <form className="shell-prompt" onSubmit={submit}>
        <label htmlFor="shell-command">
          /workspace <span>$</span>
        </label>
        <input
          id="shell-command"
          aria-label="Terminal command"
          data-initial-focus
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={keyDown}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <button type="submit">Run ↵</button>
      </form>
      <div className="shell-footer">
        <span>Demo only · no commands are executed</span>
        <span>↑ ↓ History · esc Close</span>
      </div>
    </div>
  )
}
