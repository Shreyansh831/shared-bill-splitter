import { createFileRoute, Link } from '@tanstack/react-router'
import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  ApiError,
  addMember,
  type Bill,
  type BillShare,
  createBill,
  getHome,
  type HomeDetails,
  listBills,
  messageOf,
  payShare,
} from '../api'
import { formatCents, parseAmountToCents } from '../money'

export const Route = createFileRoute('/homes/$homeId')({
  component: HomeRoute,
})

type HomeData = { home: HomeDetails; bills: Bill[] }
type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: HomeData }

const cardStyle: CSSProperties = {
  border: '1px solid #ccc',
  borderRadius: 8,
  padding: 12,
  marginBottom: 12,
}

function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p role="alert" style={{ color: '#b00020', margin: '4px 0' }}>
      {children}
    </p>
  )
}

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 640 }}>
      <p>
        <Link to="/">← Back</Link>
      </p>
      <h1>{title}</h1>
      {children}
    </main>
  )
}

function HomeRoute() {
  const { homeId } = Route.useParams()
  // The key resets all state when the user opens a different home.
  return <HomeView key={homeId} homeId={homeId} />
}

function HomeView({ homeId }: { homeId: string }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const latestRequest = useRef(0)

  const load = useCallback(
    async (silent: boolean) => {
      // Only the newest request may update the screen, so a slow old answer cannot overwrite it.
      latestRequest.current += 1
      const requestId = latestRequest.current
      try {
        const [home, bills] = await Promise.all([getHome(homeId), listBills(homeId)])
        if (requestId !== latestRequest.current) return
        setState({ status: 'ready', data: { home, bills } })
        setRefreshError(null)
      } catch (error) {
        if (requestId !== latestRequest.current) return
        if (silent) {
          setRefreshError(`Could not refresh the page. ${messageOf(error)}`)
        } else {
          setState({ status: 'error', message: messageOf(error) })
        }
      }
    },
    [homeId],
  )

  useEffect(() => {
    void load(false)
    return () => {
      latestRequest.current += 1
    }
  }, [load])

  function retry() {
    setState({ status: 'loading' })
    void load(false)
  }

  if (state.status === 'loading') {
    return (
      <Page title="Loading…">
        <p role="status">Loading home…</p>
      </Page>
    )
  }

  if (state.status === 'error') {
    return (
      <Page title="Something went wrong">
        <ErrorText>{state.message}</ErrorText>
        <button type="button" onClick={retry}>
          Try again
        </button>
      </Page>
    )
  }

  const { home, bills } = state.data
  const refresh = () => load(true)

  return (
    <Page title={home.name}>
      {refreshError !== null && <ErrorText>{refreshError}</ErrorText>}

      <section>
        <h2>Members</h2>
        {home.members.length === 0 ? (
          <p>No members yet. Add one to start splitting bills.</p>
        ) : (
          <ol>
            {home.members.map((member) => (
              <li key={member.id}>{member.name}</li>
            ))}
          </ol>
        )}
        <AddMemberForm homeId={homeId} onAdded={refresh} />
      </section>

      <section>
        <h2>Bills</h2>
        <AddBillForm homeId={homeId} hasMembers={home.members.length > 0} onAdded={refresh} />
        {bills.length === 0 ? (
          <p>No bills yet.</p>
        ) : (
          bills.map((bill) => <BillCard key={bill.id} bill={bill} onPaid={refresh} />)
        )}
      </section>
    </Page>
  )
}

function AddMemberForm({ homeId, onAdded }: { homeId: string; onAdded: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed.length === 0) {
      setError('Please enter a name.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await addMember(homeId, trimmed)
      setName('')
      await onAdded()
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <label>
        New member{' '}
        <input value={name} onChange={(event) => setName(event.target.value)} disabled={busy} />
      </label>{' '}
      <button type="submit" disabled={busy}>
        {busy ? 'Adding…' : 'Add member'}
      </button>
      {error !== null && <ErrorText>{error}</ErrorText>}
    </form>
  )
}

function AddBillForm({
  homeId,
  hasMembers,
  onAdded,
}: {
  homeId: string
  hasMembers: boolean
  onAdded: () => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedTitle = title.trim()
    const totalCents = parseAmountToCents(amount)
    if (trimmedTitle.length === 0) {
      setError('Please enter a title.')
      return
    }
    if (totalCents === null) {
      setError('Enter an amount above 0 with at most 2 decimals, for example 12.50.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await createBill(homeId, trimmedTitle, totalCents)
      setTitle('')
      setAmount('')
      await onAdded()
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setBusy(false)
    }
  }

  if (!hasMembers) {
    return <p>Add at least one member before creating a bill.</p>
  }

  return (
    <form onSubmit={onSubmit} style={{ marginBottom: 16 }}>
      <label>
        Title{' '}
        <input value={title} onChange={(event) => setTitle(event.target.value)} disabled={busy} />
      </label>{' '}
      <label>
        Amount ($){' '}
        <input
          value={amount}
          inputMode="decimal"
          onChange={(event) => setAmount(event.target.value)}
          disabled={busy}
        />
      </label>{' '}
      <button type="submit" disabled={busy}>
        {busy ? 'Adding…' : 'Add bill'}
      </button>
      {error !== null && <ErrorText>{error}</ErrorText>}
    </form>
  )
}

function BillCard({ bill, onPaid }: { bill: Bill; onPaid: () => Promise<void> }) {
  return (
    <article style={cardStyle}>
      <h3 style={{ marginTop: 0 }}>
        {bill.title} — ${formatCents(bill.totalCents)}
      </h3>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {bill.shares.map((share) => (
          <ShareRow key={share.id} billId={bill.id} share={share} onPaid={onPaid} />
        ))}
      </ul>
    </article>
  )
}

function ShareRow({
  billId,
  share,
  onPaid,
}: {
  billId: string
  share: BillShare
  onPaid: () => Promise<void>
}) {
  // The same key is reused when the user retries after a network error or a 500,
  // so a payment that actually went through is never charged twice.
  const keyRef = useRef<string | null>(null)
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justPaidAt, setJustPaidAt] = useState<string | null>(null)
  const paidAt = justPaidAt ?? share.paidAt

  async function pay() {
    if (paying) return
    setPaying(true)
    setError(null)
    keyRef.current ??= crypto.randomUUID()
    try {
      const result = await payShare(billId, share.id, keyRef.current)
      keyRef.current = null
      setJustPaidAt(result.paidAt)
      await onPaid()
    } catch (caught) {
      if (caught instanceof ApiError && caught.status !== null && caught.status < 500) {
        // The server clearly refused, so the next attempt may use a new key.
        keyRef.current = null
      }
      if (caught instanceof ApiError && caught.status === 409) {
        await onPaid()
      }
      setError(messageOf(caught))
    } finally {
      setPaying(false)
    }
  }

  return (
    <li style={{ padding: '4px 0' }}>
      {share.memberName}: ${formatCents(share.amountCents)}{' '}
      {paidAt !== null ? (
        <span>✅ Paid {new Date(paidAt).toLocaleString()}</span>
      ) : (
        <button type="button" onClick={pay} disabled={paying}>
          {paying ? 'Paying…' : 'Pay'}
        </button>
      )}
      {error !== null && <ErrorText>{error}</ErrorText>}
    </li>
  )
}
