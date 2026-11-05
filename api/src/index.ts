import { Hono } from 'hono'

const app = new Hono<{ Bindings: Env }>()

// Reads { "name": string } from the request. Returns null when the body is invalid.
async function readName(request: Request): Promise<string | null> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return null
  }
  if (typeof body !== 'object' || body === null || !('name' in body)) return null
  const name = body.name
  if (typeof name !== 'string') return null
  const trimmed = name.trim()
  return trimmed.length > 0 ? trimmed : null
}

app.get('/api/health', (c) => c.json({ status: 'ok' }))

app.post('/api/homes', async (c) => {
  const name = await readName(c.req.raw)
  if (name === null) {
    return c.json({ error: 'name must be a non-empty string' }, 422)
  }

  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, name).run()
  return c.json({ id, name }, 201)
})

app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (home === null) {
    return c.json({ error: 'home not found' }, 404)
  }

  const name = await readName(c.req.raw)
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

app.notFound((c) => c.json({ error: 'not found' }, 404))

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'internal server error' }, 500)
})

export default app
