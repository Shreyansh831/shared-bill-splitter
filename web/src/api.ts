export type Member = { id: string; name: string }
export type HomeDetails = { id: string; name: string; members: Member[] }
export type BillShare = {
  id: string
  memberId: string
  memberName: string
  amountCents: number
  paidAt: string | null
}
export type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: BillShare[]
}
export type PaidShare = { id: string; memberId: string; amountCents: number; paidAt: string }

export class ApiError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const TIMEOUT_MS = 10_000

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function errorMessageFrom(body: unknown): string | null {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    return typeof body.error === 'string' ? body.error : null
  }
  return null
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let status: number
  let text: string
  try {
    const response = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json', ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    })
    status = response.status
    text = await response.text()
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('The server is taking too long to answer. Please try again.')
    }
    throw new ApiError('Could not reach the server. Check your connection and try again.')
  } finally {
    clearTimeout(timer)
  }

  const parsed = parseJson(text)
  if (status < 200 || status >= 300) {
    throw new ApiError(
      errorMessageFrom(parsed) ?? `Something went wrong (error ${status}).`,
      status,
    )
  }
  if (parsed === null) {
    throw new ApiError('The server sent an unexpected answer.', status)
  }
  return parsed as T
}

export function createHome(name: string) {
  return request<{ id: string; name: string }>('POST', '/api/homes', { body: { name } })
}

export function getHome(homeId: string) {
  return request<HomeDetails>('GET', `/api/homes/${encodeURIComponent(homeId)}`)
}

export function addMember(homeId: string, name: string) {
  return request<Member>('POST', `/api/homes/${encodeURIComponent(homeId)}/members`, {
    body: { name },
  })
}

export async function listBills(homeId: string): Promise<Bill[]> {
  const result = await request<{ bills: Bill[] }>(
    'GET',
    `/api/homes/${encodeURIComponent(homeId)}/bills`,
  )
  return result.bills
}

export function createBill(homeId: string, title: string, totalCents: number) {
  return request<Bill>('POST', `/api/homes/${encodeURIComponent(homeId)}/bills`, {
    body: { title, totalCents },
  })
}

export function payShare(billId: string, shareId: string, idempotencyKey: string) {
  return request<PaidShare>(
    'POST',
    `/api/bills/${encodeURIComponent(billId)}/shares/${encodeURIComponent(shareId)}/pay`,
    { headers: { 'Idempotency-Key': idempotencyKey } },
  )
}
