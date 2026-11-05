import { Hono } from 'hono'

const app = new Hono<{ Bindings: Env }>()

type IdRow = { id: string }
type ShareRow = {
  id: string
  memberId: string
  amountCents: number
  paidAt: string | null
  idempotencyKey: string | null
}
type BalanceRow = { memberId: string; name: string; outstandingCents: number }

// Reads the request body as a JSON object. Returns null for anything else.
async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return null
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
  return body as Record<string, unknown>
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

app.get('/api/health', (c) => c.json({ status: 'ok' }))

app.post('/api/homes', async (c) => {
  const body = await readJsonObject(c.req.raw)
  const name = body === null ? null : readNonEmptyString(body.name)
  if (name === null) {
    return c.json({ error: 'name must be a non-empty string' }, 422)
  }

  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, name).run()
  return c.json({ id, name }, 201)
})

app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<IdRow>()
  if (home === null) {
    return c.json({ error: 'home not found' }, 404)
  }

  const body = await readJsonObject(c.req.raw)
  const name = body === null ? null : readNonEmptyString(body.name)
  if (name === null) {
    return c.json({ error: 'name must be a non-empty string' }, 422)
  }

  // The position is computed inside the INSERT, so it is one atomic statement.
  const id = crypto.randomUUID()
  await c.env.DB.prepare(
    `INSERT INTO members (id, home_id, name, position)
     SELECT ?, ?, ?, COALESCE(MAX(position), 0) + 1
     FROM members WHERE home_id = ?`,
  )
    .bind(id, homeId, name, homeId)
    .run()

  return c.json({ id, homeId, name }, 201)
})

app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<IdRow>()
  if (home === null) {
    return c.json({ error: 'home not found' }, 404)
  }

  const body = await readJsonObject(c.req.raw)
  if (body === null) {
    return c.json({ error: 'body must be a JSON object' }, 422)
  }
  const title = readNonEmptyString(body.title)
  if (title === null) {
    return c.json({ error: 'title must be a non-empty string' }, 422)
  }
  const totalCents = body.totalCents
  if (typeof totalCents !== 'number' || !Number.isSafeInteger(totalCents) || totalCents <= 0) {
    return c.json({ error: 'totalCents must be a positive whole number' }, 422)
  }

  const { results: members } = await c.env.DB.prepare(
    'SELECT id FROM members WHERE home_id = ? ORDER BY position',
  )
    .bind(homeId)
    .all<IdRow>()
  if (members.length === 0) {
    return c.json({ error: 'home has no members' }, 422)
  }

  // Even split. The first (total % count) members get one extra cent.
  const base = Math.floor(totalCents / members.length)
  const extra = totalCents % members.length
  const billId = crypto.randomUUID()
  const shares = members.map((member, index) => ({
    id: crypto.randomUUID(),
    memberId: member.id,
    amountCents: base + (index < extra ? 1 : 0),
    paidAt: null,
  }))

  // batch() runs all statements in one transaction: the bill and all its shares, or nothing.
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)',
    ).bind(billId, homeId, title, totalCents),
    ...shares.map((share) =>
      c.env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents) VALUES (?, ?, ?, ?)',
      ).bind(share.id, billId, share.memberId, share.amountCents),
    ),
  ])

  return c.json({ id: billId, homeId, title, totalCents, shares }, 201)
})

app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const key = c.req.header('Idempotency-Key')?.trim()
  if (!key) {
    return c.json({ error: 'Idempotency-Key header is required' }, 400)
  }

  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')

  // One atomic statement: only an unpaid share can be updated, so only one request can win.
  const update = await c.env.DB.prepare(
    `UPDATE shares SET paid_at = ?, idempotency_key = ?
     WHERE id = ? AND bill_id = ? AND paid_at IS NULL`,
  )
    .bind(new Date().toISOString(), key, shareId, billId)
    .run()

  const share = await c.env.DB.prepare(
    `SELECT id, member_id AS memberId, amount_cents AS amountCents,
            paid_at AS paidAt, idempotency_key AS idempotencyKey
     FROM shares WHERE id = ? AND bill_id = ?`,
  )
    .bind(shareId, billId)
    .first<ShareRow>()
  if (share === null) {
    return c.json({ error: 'bill or share not found' }, 404)
  }

  // We paid it just now, or an earlier request with the same key paid it.
  if (update.meta.changes === 1 || share.idempotencyKey === key) {
    return c.json(
      {
        id: share.id,
        memberId: share.memberId,
        amountCents: share.amountCents,
        paidAt: share.paidAt,
      },
      200,
    )
  }

  return c.json({ error: 'share already paid with a different Idempotency-Key' }, 409)
})

app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<IdRow>()
  if (home === null) {
    return c.json({ error: 'home not found' }, 404)
  }

  // The unpaid filter is in the JOIN condition, so members with nothing unpaid still show up with 0.
  const { results } = await c.env.DB.prepare(
    `SELECT m.id AS memberId, m.name AS name, COALESCE(SUM(s.amount_cents), 0) AS outstandingCents
     FROM members m
     LEFT JOIN shares s ON s.member_id = m.id AND s.paid_at IS NULL
     WHERE m.home_id = ?
     GROUP BY m.id, m.name, m.position
     ORDER BY m.position`,
  )
    .bind(homeId)
    .all<BalanceRow>()

  return c.json({ balances: results }, 200)
})

app.notFound((c) => c.json({ error: 'not found' }, 404))

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'internal server error' }, 500)
})

export default app
