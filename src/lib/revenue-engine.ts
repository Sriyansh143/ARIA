// =====================================================================
// revenue-engine.ts — Income tracking, payment follow-ups, service expiry.
// =====================================================================
// Handles:
//   1. Payment tracking — every invoice has dueDate + status
//   2. Auto-follow-up — sends reminders at 7/14/30 days overdue
//   3. Service suspension — if payment overdue + autoSuspend=true,
//      service status → 'suspended' until payment confirmed
//   4. Owner confirmation — payments require owner approval before
//      service is reactivated (prevents fake "I paid" claims)
//   5. Revenue dashboard — total income, pending, overdue, MRR
//
// Persisted as MemoryItem rows under scope='revenue-*'. Never throws.
// =====================================================================

import { db } from '@/lib/db'
import { logger } from '@/lib/logger'
import { randomUUID } from 'crypto'

const FOLLOW_UP_SCHEDULE = [7, 14, 30]  // days overdue → send reminder

// ─── Types ───────────────────────────────────────────────────────────
export interface Client {
  id: string
  name: string
  email?: string
  phone?: string
  company?: string
  source: string
  notes?: string
  status: 'active' | 'inactive'
  createdAt: string
}

export interface Service {
  id: string
  clientId: string
  name: string
  description?: string
  price: number
  currency: string
  billingCycle: 'one-time' | 'monthly' | 'quarterly' | 'yearly'
  status: 'pending' | 'active' | 'suspended' | 'cancelled'
  autoSuspend: boolean
  startDate: string
  nextPaymentDue: string | null
  lastPaymentDate?: string
  createdAt: string
}

export interface Invoice {
  id: string
  clientId: string
  serviceId?: string
  amount: number
  currency: string
  status: 'pending' | 'overdue' | 'received' | 'cancelled'
  confirmed: boolean
  dueDate: string
  paymentDate?: string
  paymentMethod?: string
  invoiceNumber: string
  followUpCount: number
  lastFollowUp?: string
  notes?: string
  createdAt: string
}

export interface Outreach {
  id: string
  clientId: string
  type: string
  subject: string
  content: string
  status: string
  sentAt: string
  createdAt: string
}

// ─── Helpers ─────────────────────────────────────────────────────────
function parseRow<T>(row: { value: string } | null): T | null {
  if (!row) return null
  try { return JSON.parse(row.value) as T } catch { return null }
}

async function fetchByScope<T>(scope: string): Promise<T[]> {
  try {
    const rows = await db.memoryItem.findMany({ where: { scope } })
    return rows.map(r => parseRow<T>(r)).filter((v): v is T => v !== null)
  } catch (err) {
    logger.warn({ err: (err as Error).message, scope }, 'revenue: fetchByScope failed')
    return []
  }
}

async function upsertScopedItem(scope: string, key: string, value: unknown): Promise<void> {
  try {
    await db.memoryItem.upsert({
      where: { key_scope: { key, scope } },
      create: { scope, key, value: JSON.stringify(value), tags: '[]' },
      update: { value: JSON.stringify(value) },
    })
  } catch (err) {
    logger.warn({ err: (err as Error).message, scope, key }, 'revenue: upsert failed')
  }
}

async function notifyOwner(message: string): Promise<void> {
  // Stub: log instead of Telegram (no telegram integration in this build).
  logger.info({ message }, 'revenue: owner notify')
  // Also store as a notification record for UI retrieval
  try {
    await db.memoryItem.create({
      data: {
        scope: 'revenue-notification',
        key: `notif_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`,
        value: JSON.stringify({ message, createdAt: new Date().toISOString() }),
        tags: '[]',
      },
    }).catch(() => {})
  } catch { /* ignore */ }
}

// ─── Create a new client ─────────────────────────────────────────────
export async function createClient(opts: {
  name: string
  email?: string
  phone?: string
  company?: string
  source?: string
  notes?: string
}): Promise<string> {
  const id = `cli_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`
  const client: Client = {
    id,
    name: opts.name,
    email: opts.email,
    phone: opts.phone,
    company: opts.company,
    source: opts.source || 'outreach',
    notes: opts.notes,
    status: 'active',
    createdAt: new Date().toISOString(),
  }
  await upsertScopedItem('revenue-client', `client:${id}`, client)
  logger.info({ clientId: id, name: opts.name }, 'revenue: new client created')
  return id
}

// ─── Create a service for a client ───────────────────────────────────
export async function createService(opts: {
  clientId: string
  name: string
  description?: string
  price: number
  currency?: string
  billingCycle?: 'one-time' | 'monthly' | 'quarterly' | 'yearly'
  autoSuspend?: boolean
}): Promise<string> {
  const now = new Date()
  const cycle = opts.billingCycle || 'one-time'
  const nextDue = cycle === 'monthly' ? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    : cycle === 'quarterly' ? new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)
    : cycle === 'yearly' ? new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
    : null

  const id = `svc_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`
  const service: Service = {
    id,
    clientId: opts.clientId,
    name: opts.name,
    description: opts.description,
    price: opts.price,
    currency: opts.currency || 'USD',
    billingCycle: cycle,
    status: 'pending',
    autoSuspend: opts.autoSuspend ?? true,
    startDate: now.toISOString(),
    nextPaymentDue: nextDue ? nextDue.toISOString() : null,
    createdAt: now.toISOString(),
  }
  await upsertScopedItem('revenue-service', `service:${id}`, service)
  logger.info({ serviceId: id, clientId: opts.clientId, price: opts.price }, 'revenue: service created')
  return id
}

// ─── Create an invoice (revenue record) ──────────────────────────────
export async function createInvoice(opts: {
  clientId: string
  serviceId?: string
  amount: number
  currency?: string
  dueDate: Date
  paymentMethod?: string
  notes?: string
}): Promise<string> {
  const id = `inv_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`
  const invoice: Invoice = {
    id,
    clientId: opts.clientId,
    serviceId: opts.serviceId,
    amount: opts.amount,
    currency: opts.currency || 'USD',
    status: 'pending',
    confirmed: false,
    dueDate: opts.dueDate.toISOString(),
    paymentMethod: opts.paymentMethod,
    invoiceNumber: `INV-${Date.now().toString(36).toUpperCase()}`,
    followUpCount: 0,
    notes: opts.notes,
    createdAt: new Date().toISOString(),
  }
  await upsertScopedItem('revenue-invoice', `invoice:${id}`, invoice)
  logger.info({ invoiceId: id, amount: opts.amount, dueDate: opts.dueDate }, 'revenue: invoice created')
  return id
}

// ─── Check for overdue payments + auto-suspend ───────────────────────
export async function checkOverduePayments(): Promise<{
  overdue: number
  suspended: number
  followUpsSent: number
}> {
  const now = new Date()
  let suspended = 0
  let followUpsSent = 0

  const invoices = await fetchByScope<Invoice>('revenue-invoice')
  const services = await fetchByScope<Service>('revenue-service')
  const clients = await fetchByScope<Client>('revenue-client')
  const clientById = new Map(clients.map(c => [c.id, c]))
  const serviceById = new Map(services.map(s => [s.id, s]))

  const pendingPayments = invoices.filter(i => i.status === 'pending' || i.status === 'overdue')

  for (const payment of pendingPayments) {
    const due = new Date(payment.dueDate)
    const daysOverdue = Math.floor((now.getTime() - due.getTime()) / (24 * 60 * 60 * 1000))
    if (daysOverdue <= 0) continue

    if (payment.status === 'pending') {
      payment.status = 'overdue'
    }

    if (FOLLOW_UP_SCHEDULE.includes(daysOverdue) && payment.followUpCount < FOLLOW_UP_SCHEDULE.length) {
      await sendPaymentFollowUp(payment, daysOverdue, clientById.get(payment.clientId))
      payment.followUpCount += 1
      payment.lastFollowUp = now.toISOString()
      followUpsSent++
    }

    if (daysOverdue > 7 && payment.serviceId) {
      const service = serviceById.get(payment.serviceId)
      if (service && service.autoSuspend && service.status === 'active') {
        service.status = 'suspended'
        await upsertScopedItem('revenue-service', `service:${service.id}`, service)
        suspended++
        logger.warn({ serviceId: service.id, clientId: payment.clientId, daysOverdue }, 'revenue: service auto-suspended (payment overdue)')
        const client = clientById.get(payment.clientId)
        await notifyOwner(
          `⚠️ SERVICE SUSPENDED\n\nClient: ${client?.name ?? payment.clientId}\nService: ${service.name}\nAmount: ${payment.amount} ${payment.currency}\nOverdue: ${daysOverdue} days\n\nService has been auto-suspended. Reactivate after payment confirmation.`
        )
      }
    }

    await upsertScopedItem('revenue-invoice', `invoice:${payment.id}`, payment)
  }

  const overdueCount = pendingPayments.filter(p => {
    const days = Math.floor((now.getTime() - new Date(p.dueDate).getTime()) / (24 * 60 * 60 * 1000))
    return days > 0
  }).length

  logger.info({ overdue: overdueCount, suspended, followUpsSent }, 'revenue: overdue check complete')
  return { overdue: overdueCount, suspended, followUpsSent }
}

// ─── Send a payment follow-up ────────────────────────────────────────
async function sendPaymentFollowUp(payment: Invoice, daysOverdue: number, client?: Client): Promise<void> {
  const message = `Payment Follow-Up #${payment.followUpCount + 1}

Client: ${client?.name ?? payment.clientId}
Invoice: ${payment.invoiceNumber}
Amount: ${payment.amount} ${payment.currency}
Due Date: ${payment.dueDate.split('T')[0]}
Days Overdue: ${daysOverdue}

This is a reminder that payment is overdue. Please process payment at your earliest convenience.

If you've already paid, please send payment confirmation details so we can verify and reactivate your service.`

  const outreach: Outreach = {
    id: `out_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`,
    clientId: payment.clientId,
    type: 'follow_up',
    subject: `Payment Reminder: ${payment.invoiceNumber}`,
    content: message,
    status: 'sent',
    sentAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  }
  await upsertScopedItem('revenue-outreach', `outreach:${outreach.id}`, outreach)

  await notifyOwner(`📧 Payment follow-up #${payment.followUpCount + 1} sent to ${client?.name ?? payment.clientId} (${daysOverdue} days overdue, ${payment.amount} ${payment.currency})`)
  logger.info({ invoiceId: payment.id, followUpNumber: payment.followUpCount + 1, daysOverdue }, 'revenue: follow-up sent')
}

// ─── Confirm payment received (requires owner approval) ──────────────
export async function confirmPayment(opts: {
  revenueId: string
  paymentDetails: string
  approvedBy: string
}): Promise<{ ok: boolean; message: string }> {
  const invoices = await fetchByScope<Invoice>('revenue-invoice')
  const payment = invoices.find(i => i.id === opts.revenueId)
  if (!payment) return { ok: false, message: 'Revenue record not found' }
  if (payment.confirmed) return { ok: false, message: 'Payment already confirmed' }

  payment.status = 'received'
  payment.paymentDate = new Date().toISOString()
  payment.confirmed = true
  payment.notes = `${payment.notes || ''}\n\nPayment confirmed by ${opts.approvedBy}. Details: ${opts.paymentDetails}`
  await upsertScopedItem('revenue-invoice', `invoice:${payment.id}`, payment)

  // Reactivate suspended service
  if (payment.serviceId) {
    const services = await fetchByScope<Service>('revenue-service')
    const service = services.find(s => s.id === payment.serviceId)
    if (service && service.status === 'suspended') {
      service.status = 'active'
      service.lastPaymentDate = new Date().toISOString()
      const now = Date.now()
      service.nextPaymentDue = service.billingCycle === 'monthly'
        ? new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString()
        : service.billingCycle === 'quarterly'
        ? new Date(now + 90 * 24 * 60 * 60 * 1000).toISOString()
        : service.billingCycle === 'yearly'
        ? new Date(now + 365 * 24 * 60 * 60 * 1000).toISOString()
        : null
      await upsertScopedItem('revenue-service', `service:${service.id}`, service)
      logger.info({ serviceId: payment.serviceId }, 'revenue: service reactivated after payment')
    }
  }

  logger.info({ revenueId: opts.revenueId, approvedBy: opts.approvedBy }, 'revenue: payment confirmed')
  return { ok: true, message: `Payment confirmed. ${payment.serviceId ? 'Service reactivated.' : ''}` }
}

// ─── Get revenue dashboard stats ─────────────────────────────────────
export async function getRevenueStats(): Promise<{
  totalRevenue: number
  pendingRevenue: number
  overdueRevenue: number
  activeClients: number
  activeServices: number
  suspendedServices: number
  mrr: number
  recentPayments: Invoice[]
  upcomingDues: Invoice[]
}> {
  const [invoices, clients, services] = await Promise.all([
    fetchByScope<Invoice>('revenue-invoice'),
    fetchByScope<Client>('revenue-client'),
    fetchByScope<Service>('revenue-service'),
  ])

  const received = invoices.filter(i => i.status === 'received')
  const pending = invoices.filter(i => i.status === 'pending')
  const overdue = invoices.filter(i => i.status === 'overdue')
  const now = Date.now()

  const activeServices = services.filter(s => s.status === 'active')
  const suspendedServices = services.filter(s => s.status === 'suspended')

  const mrr = activeServices.reduce((sum, s) => {
    if (s.billingCycle === 'monthly') return sum + s.price
    if (s.billingCycle === 'quarterly') return sum + s.price / 3
    if (s.billingCycle === 'yearly') return sum + s.price / 12
    return sum
  }, 0)

  return {
    totalRevenue: received.reduce((sum, i) => sum + i.amount, 0),
    pendingRevenue: pending.reduce((sum, i) => sum + i.amount, 0),
    overdueRevenue: overdue.reduce((sum, i) => sum + i.amount, 0),
    activeClients: clients.filter(c => c.status === 'active').length,
    activeServices: activeServices.length,
    suspendedServices: suspendedServices.length,
    mrr: Math.round(mrr * 100) / 100,
    recentPayments: received
      .sort((a, b) => (b.paymentDate ?? '').localeCompare(a.paymentDate ?? ''))
      .slice(0, 5),
    upcomingDues: pending
      .filter(i => new Date(i.dueDate).getTime() >= now)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 5),
  }
}

// ─── Sell automation/software based on conversation ──────────────────
export async function createProductListing(opts: {
  name: string
  description: string
  price: number
  basedOnConversation: string
}): Promise<{ productId: string; message: string }> {
  const productId = `PROD-${Date.now().toString(36).toUpperCase()}`
  const entry = {
    id: productId,
    category: 'pricing_research',
    topic: `Product Listing: ${opts.name}`,
    findings: `Based on user conversation: ${opts.basedOnConversation.slice(0, 500)}\n\nProduct: ${opts.name}\nDescription: ${opts.description}\nPrice: ${opts.price} USD`,
    actionItems: [
      `Create landing page for ${opts.name}`,
      `Set up payment flow (${opts.price} USD)`,
      `Add to product catalog`,
      `Pitch to relevant prospects`,
    ],
    sources: [],
    repoUrl: null,
    relevanceScore: 0.8,
    implemented: false,
    createdAt: new Date().toISOString(),
  }
  await upsertScopedItem('research-log', `pricing_research:${productId}`, entry)
  return {
    productId,
    message: `Product "${opts.name}" listed at ${opts.price} USD. Action items created for follow-up.`,
  }
}
