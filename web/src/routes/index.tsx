import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { createHome, messageOf } from '../api'

export const Route = createFileRoute('/')({
  component: Landing,
})

function Landing() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [existingId, setExistingId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed.length === 0) {
      setError('Please enter a name for the home.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const home = await createHome(trimmed)
      await navigate({ to: '/homes/$homeId', params: { homeId: home.id } })
    } catch (caught) {
      setError(messageOf(caught))
      setBusy(false)
    }
  }

  async function onOpen(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = existingId.trim()
    if (trimmed.length === 0) return
    await navigate({ to: '/homes/$homeId', params: { homeId: trimmed } })
  }

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 560 }}>
      <h1>Bill Splitter</h1>

      <form onSubmit={onCreate}>
        <h2>Create a home</h2>
        <label>
          Home name{' '}
          <input value={name} onChange={(event) => setName(event.target.value)} disabled={busy} />
        </label>{' '}
        <button type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create home'}
        </button>
        {error !== null && (
          <p role="alert" style={{ color: '#b00020' }}>
            {error}
          </p>
        )}
      </form>

      <form onSubmit={onOpen}>
        <h2>Open an existing home</h2>
        <label>
          Home id{' '}
          <input value={existingId} onChange={(event) => setExistingId(event.target.value)} />
        </label>{' '}
        <button type="submit">Open</button>
      </form>
    </main>
  )
}
