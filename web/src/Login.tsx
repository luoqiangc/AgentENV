import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { ArrowRight, Box, LockKeyhole } from 'lucide-react'
import { api } from './api/client'

export function Login({ checking = false }: { checking?: boolean }) {
  const [key, setKey] = useState('')
  const client = useQueryClient()
  const navigate = useNavigate()
  const login = useMutation({
    mutationFn: api.login,
    gcTime: 0,
    onSuccess: async () => {
      setKey('')
      client.removeQueries({ queryKey: ['workspace'] })
      await client.invalidateQueries({ queryKey: ['session'] })
    },
  })
  return (
    <main className="login-page">
      <section className="login-panel panel">
        <span className="brand-mark">
          <Box size={28} />
        </span>
        <div className="eyebrow">AGENTENV WORKSPACE</div>
        <h1>A space for your agents.</h1>
        <p>
          Sign in with your AgentENV API key to manage environments and open a
          terminal.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            login.mutate(key.trim())
          }}
        >
          <label className="form-field">
            API key
            <input
              type="password"
              name="apiKey"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              required
              autoComplete="off"
              spellCheck={false}
              placeholder="Enter your API key"
              disabled={checking || login.isPending}
            />
          </label>
          {login.error && (
            <p className="form-error" role="alert">
              {login.error.message}
            </p>
          )}
          <button
            className="button primary full-width"
            disabled={checking || login.isPending}
          >
            {checking
              ? 'Checking session…'
              : login.isPending
                ? 'Signing in…'
                : 'Open workspace'}
            <ArrowRight size={16} />
          </button>
        </form>
        <div className="login-note">
          <LockKeyhole size={15} />
          Your key is not saved in browser storage.
        </div>
        <button className="text-button" onClick={() => navigate('/?demo=1')}>
          Explore the interactive demo <ArrowRight size={14} />
        </button>
      </section>
    </main>
  )
}
