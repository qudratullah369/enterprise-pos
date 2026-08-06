import { useState, useEffect, useCallback, useRef } from 'react'
import './index.css'
import {
  enqueueSale,
  flushQueue,
  listPending,
  isOnline,
} from './utils/offlineQueue'
import {
  cacheProducts,
  getCachedProducts,
  getCachedByBarcode,
} from './utils/offlineProducts'
import { printEscPosBase64, isWebUsbAvailable } from './utils/webUsbPrinter'

// ─── Types ────────────────────────────────────────────────────────────────────

interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  branchId?: string
}

interface Product {
  id: string
  sku: string
  barcode?: string | null
  name: string
  sellingPrice: number | string
  taxRate: number | string
  trackInventory: boolean
}

interface CartItem {
  productId: string
  name: string
  unitPrice: number
  qty: number
  taxRate: number
  discount: number
}

interface CashRegister {
  id: string
  openingFloat: number | string
  openedAt: string
  branch: { id: string; code: string; name: string }
}

interface Branch {
  id: string
  code: string
  name: string
  address?: string
  isActive: boolean
}


type View = 'pos' | 'dashboard' | 'reports' | 'products'

// ─── API helper ───────────────────────────────────────────────────────────────

const api = {
  async request(path: string, options: RequestInit = {}) {
    const token = localStorage.getItem('token')
    const res = await fetch(`/api${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    })
    // CSV / binary responses
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('text/csv') || ct.includes('octet-stream')) {
      if (!res.ok) throw new Error('Export failed')
      return res
    }
    const data = await res.json()
    if (!res.ok) throw new Error(data.message || data.error || 'Request failed')
    return data
  },
  login: (email: string, password: string) =>
    api.request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: () => api.request('/auth/me'),
  products: (search = '') =>
    api.request(`/products?search=${encodeURIComponent(search)}&limit=40`),
  productByBarcode: (code: string) => api.request(`/products/barcode/${encodeURIComponent(code)}`),
  createSale: (body: unknown) =>
    api.request('/sales', { method: 'POST', body: JSON.stringify(body) }),
  openRegister: (body: unknown) =>
    api.request('/cash-registers/open', { method: 'POST', body: JSON.stringify(body) }),
  myOpenRegister: () => api.request('/cash-registers/me/open'),
  closeRegister: (id: string, body: unknown) =>
    api.request(`/cash-registers/${id}/close`, { method: 'POST', body: JSON.stringify(body) }),
  dailySales: (date?: string) =>
    api.request(`/reports/daily-sales${date ? `?date=${date}` : ''}`),
  dashboard: (branchId?: string) =>
    api.request(`/reports/dashboard${branchId ? `?branchId=${branchId}` : ''}`),
  receipt: (saleId: string) => api.request(`/receipts/${saleId}`),
  exportDailyCsv: () => api.request('/reports/export/daily-sales.csv'),
  exportInventoryCsv: () => api.request('/reports/export/inventory.csv'),
  branches: () => api.request('/branches'),
  printReceipt: (saleId: string, driver = 'log') =>
    api.request(`/printers/receipts/${saleId}`, {
      method: 'POST',
      body: JSON.stringify({ driver }),
    }),
}




// ─── Main App ─────────────────────────────────────────────────────────────────

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [view, setView] = useState<View>('pos')
  const [email, setEmail] = useState('cashier@pos.local')
  const [password, setPassword] = useState('cashier123')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // POS state
  const [products, setProducts] = useState<Product[]>([])
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CARD' | 'MOBILE'>('CASH')
  const [paidAmount, setPaidAmount] = useState('')
  const [register, setRegister] = useState<CashRegister | null>(null)
  const [saleMsg, setSaleMsg] = useState('')
  const [processing, setProcessing] = useState(false)

  // Cash open/close
  const [showOpenReg, setShowOpenReg] = useState(false)
  const [openingFloat, setOpeningFloat] = useState('100')
  const [showCloseReg, setShowCloseReg] = useState(false)
  const [closingCash, setClosingCash] = useState('')

  // Reports / Dashboard / Receipt
  const [report, setReport] = useState<any>(null)
  const [dashboard, setDashboard] = useState<any>(null)
  const [lastSaleId, setLastSaleId] = useState<string | null>(null)
  const [receiptHtml, setReceiptHtml] = useState<string | null>(null)
  const [receiptEscpos, setReceiptEscpos] = useState<string | null>(null)
  const [showReceipt, setShowReceipt] = useState(false)
  const [branches, setBranches] = useState<Branch[]>([])
  const [selectedBranchId, setSelectedBranchId] = useState<string>('')
  const [online, setOnline] = useState(true)
  const [pendingCount, setPendingCount] = useState(0)

  const barcodeRef = useRef<HTMLInputElement>(null)



  // ── Auth ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (token) {
      api.me()
        .then((res) => {
          setUser(res.data)
          if (res.data.branchId) setSelectedBranchId(res.data.branchId)
          loadRegister()
          loadBranches()
          refreshPending()
        })
        .catch(() => localStorage.removeItem('token'))
    }
  }, [])

  // Online / offline listeners + auto-sync
  useEffect(() => {
    const goOnline = async () => {
      setOnline(true)
      try {
        const result = await flushQueue((payload) => api.createSale(payload))
        if (result.synced > 0) {
          setSaleMsg(`Synced ${result.synced} offline sale(s)`)
        }
        await refreshPending()
      } catch {
        /* ignore */
      }
    }
    const goOffline = () => setOnline(false)
    setOnline(isOnline())
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  const loadBranches = async () => {
    try {
      const res = await api.branches()
      setBranches(res.data.items ?? res.data ?? [])
    } catch {
      setBranches([])
    }
  }

  const refreshPending = async () => {
    try {
      const list = await listPending()
      setPendingCount(list.length)
    } catch {
      setPendingCount(0)
    }
  }

  const login = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await api.login(email, password)
      localStorage.setItem('token', res.data.token)
      setUser(res.data.user)
      await loadRegister()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const logout = () => {
    localStorage.removeItem('token')
    setUser(null)
    setCart([])
    setRegister(null)
  }

  // ── Cash Register ─────────────────────────────────────────────────────────

  const loadRegister = async () => {
    try {
      const res = await api.myOpenRegister()
      setRegister(res.data)
    } catch {
      setRegister(null)
    }
  }

  const handleOpenRegister = async () => {
    const branchId = selectedBranchId || user?.branchId
    if (!branchId) {
      setError('No branch selected')
      return
    }
    try {
      const res = await api.openRegister({
        branchId,
        openingFloat: Number(openingFloat),
      })
      setRegister(res.data)
      setShowOpenReg(false)
      setSaleMsg('Cash register opened')
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handleCloseRegister = async () => {
    if (!register) return
    try {
      await api.closeRegister(register.id, { closingCash: Number(closingCash) })
      setRegister(null)
      setShowCloseReg(false)
      setSaleMsg('Cash register closed')
    } catch (err: any) {
      setError(err.message)
    }
  }

  // ── Products ──────────────────────────────────────────────────────────────

  const loadProducts = useCallback(async (q = '') => {
    try {
      if (!isOnline()) {
        const cached = await getCachedProducts(q)
        setProducts(cached as Product[])
        return
      }
      const res = await api.products(q)
      const items = res.data.items ?? res.data ?? []
      setProducts(items)
      // Full catalog cache when no search filter
      if (!q) {
        await cacheProducts(items)
      }
    } catch {
      // Network error → fall back to cache
      try {
        const cached = await getCachedProducts(q)
        setProducts(cached as Product[])
      } catch {
        setProducts([])
      }
    }
  }, [])

  useEffect(() => {
    if (user) loadProducts(search)
  }, [user, search, loadProducts])

  const addToCart = (p: Product) => {
    const price = Number(p.sellingPrice)
    const tax = Number(p.taxRate)
    setCart((prev) => {
      const existing = prev.find((c) => c.productId === p.id)
      if (existing) {
        return prev.map((c) =>
          c.productId === p.id ? { ...c, qty: c.qty + 1 } : c
        )
      }
      return [
        ...prev,
        {
          productId: p.id,
          name: p.name,
          unitPrice: price,
          qty: 1,
          taxRate: tax,
          discount: 0,
        },
      ]
    })
  }

  const updateQty = (productId: string, qty: number) => {
    if (qty <= 0) {
      setCart((prev) => prev.filter((c) => c.productId !== productId))
    } else {
      setCart((prev) =>
        prev.map((c) => (c.productId === productId ? { ...c, qty } : c))
      )
    }
  }

  const handleBarcode = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    const code = (e.target as HTMLInputElement).value.trim()
    if (!code) return
    try {
      if (!isOnline()) {
        const cached = await getCachedByBarcode(code)
        if (cached) {
          addToCart(cached as Product)
          ;(e.target as HTMLInputElement).value = ''
          return
        }
        throw new Error('Not in offline cache')
      }
      const res = await api.productByBarcode(code)
      if (res.data) addToCart(res.data)
      ;(e.target as HTMLInputElement).value = ''
    } catch {
      // Try cache even if online request failed
      try {
        const cached = await getCachedByBarcode(code)
        if (cached) {
          addToCart(cached as Product)
          ;(e.target as HTMLInputElement).value = ''
          return
        }
      } catch { /* ignore */ }
      setError(`Product not found: ${code}`)
      setTimeout(() => setError(''), 2500)
    }
  }

  // ── Cart totals ───────────────────────────────────────────────────────────

  const subtotal = cart.reduce((s, i) => s + i.unitPrice * i.qty - i.discount, 0)
  const taxTotal = cart.reduce(
    (s, i) => s + ((i.unitPrice * i.qty - i.discount) * i.taxRate) / 100,
    0
  )
  const total = subtotal + taxTotal

  // ── Complete sale ─────────────────────────────────────────────────────────

  const completeSale = async () => {
    const branchId = selectedBranchId || user?.branchId
    if (!branchId) {
      setError('No branch selected')
      return
    }
    if (cart.length === 0) return

    const paid = paymentMethod === 'CASH' ? Number(paidAmount || total) : total
    if (paid < total) {
      setError('Paid amount is less than total')
      return
    }

    const payload = {
      branchId,
      items: cart.map((c) => ({
        productId: c.productId,
        quantity: c.qty,
        unitPrice: c.unitPrice,
        discount: c.discount,
      })),
      paymentMethod,
      paidAmount: paid,
    }

    setProcessing(true)
    setError('')
    setSaleMsg('')

    // Offline path: queue for later sync
    if (!isOnline()) {
      try {
        await enqueueSale(payload)
        setCart([])
        setPaidAmount('')
        setSaleMsg('Offline — sale queued for sync')
        await refreshPending()
      } catch (err: any) {
        setError(err.message || 'Failed to queue offline sale')
      } finally {
        setProcessing(false)
      }
      return
    }

    try {
      const res = await api.createSale(payload)
      setCart([])
      setPaidAmount('')
      setLastSaleId(res.data.id)
      setSaleMsg(`Sale completed · Invoice ${res.data.invoiceNumber}`)
      barcodeRef.current?.focus()
    } catch (err: any) {
      // Network failure mid-request → queue offline
      if (!navigator.onLine) {
        await enqueueSale(payload)
        setCart([])
        setPaidAmount('')
        setSaleMsg('Connection lost — sale queued for sync')
        await refreshPending()
      } else {
        setError(err.message)
      }
    } finally {
      setProcessing(false)
    }
  }

  const openReceipt = async (saleId?: string) => {
    const id = saleId || lastSaleId
    if (!id) return
    try {
      const res = await api.receipt(id)
      setReceiptHtml(res.data.html)
      setReceiptEscpos(res.data.escposBase64 || null)
      setLastSaleId(id)
      setShowReceipt(true)
    } catch (err: any) {
      setError(err.message)
    }
  }

  const downloadCsv = async (type: 'daily' | 'inventory') => {
    try {
      const res = type === 'daily' ? await api.exportDailyCsv() : await api.exportInventoryCsv()
      const blob = await (res as Response).blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = type === 'daily' ? `daily-sales-${new Date().toISOString().slice(0, 10)}.csv` : `inventory-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      setError(err.message || 'Export failed')
    }
  }

  // ── Reports / Dashboard ───────────────────────────────────────────────────

  const loadReport = async () => {
    try {
      const res = await api.dailySales()
      setReport(res.data)
    } catch (err: any) {
      setError(err.message)
    }
  }

  const loadDashboard = async () => {
    try {
      const res = await api.dashboard(selectedBranchId || undefined)
      setDashboard(res.data)
    } catch (err: any) {
      setError(err.message)
    }
  }

  useEffect(() => {
    if (view === 'reports') loadReport()
    if (view === 'dashboard') loadDashboard()
  }, [view, selectedBranchId])

  // ── Login screen ──────────────────────────────────────────────────────────

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md">
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Enterprise POS</h1>
          <p className="text-slate-500 mb-6 text-sm">FIFO inventory · Multi-branch · RBAC</p>
          <form onSubmit={login} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
          <p className="mt-4 text-xs text-slate-400 text-center">
            Demo · cashier@pos.local / cashier123
          </p>
        </div>
      </div>
    )
  }

  // ── Main layout ───────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <span className="text-xl font-bold text-blue-600">POS</span>
          <nav className="flex gap-1">
            {([
              { id: 'pos' as View, label: 'Terminal', roles: ['ADMIN', 'MANAGER', 'CASHIER'] },
              { id: 'dashboard' as View, label: 'Dashboard', roles: ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'CASHIER'] },
              { id: 'reports' as View, label: 'Reports', roles: ['ADMIN', 'MANAGER', 'ACCOUNTANT'] },
              { id: 'products' as View, label: 'Products', roles: ['ADMIN', 'MANAGER', 'INVENTORY', 'CASHIER'] },
            ])
              .filter((v) => v.roles.includes(user.role))
              .map((v) => (
              <button
                key={v.id}
                onClick={() => setView(v.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  view === v.id
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {v.label}
              </button>
            ))}
          </nav>

        </div>
        <div className="flex items-center gap-3 text-sm">
          {/* Online / offline + pending queue */}
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              online
                ? 'bg-green-50 text-green-700'
                : 'bg-red-50 text-red-700'
            }`}
          >
            {online ? 'Online' : 'Offline'}
            {pendingCount > 0 && ` · ${pendingCount} queued`}
          </span>

          {/* Branch switcher */}
          {branches.length > 0 && (
            <select
              value={selectedBranchId}
              onChange={(e) => {
                setSelectedBranchId(e.target.value)
                if (view === 'dashboard') {
                  setTimeout(() => loadDashboard(), 0)
                }
              }}
              className="border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white max-w-[160px]"
              title="Active branch"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} — {b.name}
                </option>
              ))}
            </select>
          )}

          {register ? (
            <span className="bg-green-50 text-green-700 px-2.5 py-1 rounded-full text-xs font-medium">
              Register open · {register.branch.code}
            </span>
          ) : (
            <button
              onClick={() => setShowOpenReg(true)}
              className="bg-amber-50 text-amber-700 px-2.5 py-1 rounded-full text-xs font-medium hover:bg-amber-100"
            >
              Open Register
            </button>
          )}
          <span className="text-slate-600">
            {user.firstName} {user.lastName}
            <span className="text-slate-400 ml-1">· {user.role}</span>
          </span>
          {register && (
            <button
              onClick={() => setShowCloseReg(true)}
              className="text-slate-500 hover:text-red-600 text-xs"
            >
              Close
            </button>
          )}
          <button onClick={logout} className="text-slate-500 hover:text-red-600 text-xs">
            Logout
          </button>
        </div>
      </header>

      {error && (
        <div className="bg-red-50 text-red-700 text-sm px-4 py-2 border-b border-red-100">
          {error}
          <button className="ml-3 underline" onClick={() => setError('')}>
            dismiss
          </button>
        </div>
      )}
      {saleMsg && (
        <div className="bg-green-50 text-green-700 text-sm px-4 py-2 border-b border-green-100 flex items-center gap-3">
          <span>{saleMsg}</span>
          {lastSaleId && (
            <button
              className="underline font-medium"
              onClick={() => openReceipt(lastSaleId)}
            >
              Print Receipt
            </button>
          )}
          <button className="underline" onClick={() => setSaleMsg('')}>
            dismiss
          </button>
        </div>
      )}

      {/* POS Terminal */}
      {view === 'pos' && (
        <div className="flex flex-1 overflow-hidden">
          {/* Left: products */}
          <main className="flex-1 p-4 overflow-auto">
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                placeholder="Search products…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                ref={barcodeRef}
                type="text"
                placeholder="Scan barcode ↵"
                onKeyDown={handleBarcode}
                className="w-44 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
              {products.map((p) => (
                <button
                  key={p.id}
                  onClick={() => addToCart(p)}
                  className="bg-white border border-slate-200 rounded-xl p-3 text-left hover:border-blue-400 hover:shadow transition"
                >
                  <div className="font-medium text-slate-800 text-sm leading-tight line-clamp-2">
                    {p.name}
                  </div>
                  <div className="text-xs text-slate-400 mt-1">{p.sku}</div>
                  <div className="text-blue-600 font-semibold mt-1.5">
                    ${Number(p.sellingPrice).toFixed(2)}
                  </div>
                </button>
              ))}
              {products.length === 0 && (
                <p className="col-span-full text-slate-400 text-sm text-center py-12">
                  No products found
                </p>
              )}
            </div>
          </main>

          {/* Right: cart */}
          <aside className="w-96 bg-white border-l border-slate-200 flex flex-col shrink-0">
            <div className="p-3 border-b border-slate-200 font-semibold text-slate-800">
              Current Sale
            </div>
            <div className="flex-1 overflow-auto p-3 space-y-2">
              {cart.length === 0 && (
                <p className="text-slate-400 text-sm text-center mt-10">Cart is empty</p>
              )}
              {cart.map((item) => (
                <div
                  key={item.productId}
                  className="flex items-center gap-2 bg-slate-50 rounded-lg p-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{item.name}</div>
                    <div className="text-xs text-slate-500">
                      ${item.unitPrice.toFixed(2)}
                      {item.taxRate > 0 && ` + ${item.taxRate}% tax`}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => updateQty(item.productId, item.qty - 1)}
                      className="w-7 h-7 rounded bg-slate-200 text-slate-700 text-sm font-bold hover:bg-slate-300"
                    >
                      −
                    </button>
                    <span className="w-8 text-center text-sm font-medium">{item.qty}</span>
                    <button
                      onClick={() => updateQty(item.productId, item.qty + 1)}
                      className="w-7 h-7 rounded bg-slate-200 text-slate-700 text-sm font-bold hover:bg-slate-300"
                    >
                      +
                    </button>
                  </div>
                  <div className="w-16 text-right text-sm font-semibold">
                    ${(item.unitPrice * item.qty - item.discount).toFixed(2)}
                  </div>
                </div>
              ))}
            </div>

            <div className="p-3 border-t border-slate-200 space-y-2">
              <div className="flex justify-between text-sm text-slate-600">
                <span>Subtotal</span>
                <span>${subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm text-slate-600">
                <span>Tax</span>
                <span>${taxTotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-lg font-bold">
                <span>Total</span>
                <span>${total.toFixed(2)}</span>
              </div>

              <div className="flex gap-1 pt-1">
                {(['CASH', 'CARD', 'MOBILE'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setPaymentMethod(m)}
                    className={`flex-1 py-1.5 rounded text-xs font-medium ${
                      paymentMethod === m
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>

              {paymentMethod === 'CASH' && (
                <input
                  type="number"
                  step="0.01"
                  min={total}
                  placeholder={`Paid (min ${total.toFixed(2)})`}
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}

              {paymentMethod === 'CASH' && paidAmount && Number(paidAmount) >= total && (
                <div className="text-sm text-green-700 font-medium text-right">
                  Change: ${(Number(paidAmount) - total).toFixed(2)}
                </div>
              )}

              <button
                disabled={cart.length === 0 || processing}
                onClick={completeSale}
                className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 disabled:opacity-40"
              >
                {processing ? 'Processing…' : 'Complete Sale'}
              </button>
              <button
                onClick={() => setCart([])}
                className="w-full border border-slate-300 text-slate-600 py-2 rounded-lg text-sm hover:bg-slate-50"
              >
                Clear Cart
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Dashboard */}
      {view === 'dashboard' && (
        <div className="p-6 max-w-5xl mx-auto w-full space-y-6">
          <h2 className="text-xl font-bold text-slate-800">Today&apos;s Dashboard</h2>
          {dashboard ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: 'Net Sales', value: `$${Number(dashboard.kpis?.netSales ?? 0).toFixed(2)}`, color: 'text-slate-800' },
                  { label: 'COGS (FIFO)', value: `$${Number(dashboard.kpis?.totalCogs ?? 0).toFixed(2)}`, color: 'text-slate-800' },
                  { label: 'Gross Profit', value: `$${Number(dashboard.kpis?.grossProfit ?? 0).toFixed(2)}`, color: 'text-green-600' },
                  { label: 'Transactions', value: dashboard.kpis?.transactionCount ?? 0, color: 'text-slate-800' },
                  { label: 'Low Stock', value: dashboard.kpis?.lowStockCount ?? 0, color: 'text-amber-600' },
                  { label: 'Open Registers', value: dashboard.kpis?.openRegisters ?? 0, color: 'text-blue-600' },
                ].map((kpi) => (
                  <div key={kpi.label} className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="text-xs text-slate-500 uppercase tracking-wide">{kpi.label}</div>
                    <div className={`text-2xl font-bold mt-1 ${kpi.color}`}>{kpi.value}</div>
                  </div>
                ))}
              </div>

              {/* 7-day sales trend */}
              {(dashboard.salesTrend ?? []).length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <h3 className="font-semibold text-slate-800 mb-3">Sales Trend (7 days)</h3>
                  {(() => {
                    const trend = dashboard.salesTrend as Array<{ date: string; total: number; count: number }>
                    const max = Math.max(...trend.map((d) => d.total), 1)
                    const barH = 100
                    const barW = Math.floor(560 / trend.length) - 6
                    return (
                      <svg viewBox={`0 0 560 ${barH + 28}`} className="w-full" role="img">
                        {trend.map((d, i) => {
                          const h = (d.total / max) * barH
                          const x = i * (barW + 6) + 2
                          const y = barH - h
                          return (
                            <g key={d.date}>
                              <rect x={x} y={y} width={barW} height={Math.max(h, 1)} rx={3} fill="#10b981" opacity={0.85} />
                              <text x={x + barW / 2} y={barH + 14} textAnchor="middle" fontSize="9" fill="#64748b">
                                {d.date.slice(5)}
                              </text>
                              <title>{`${d.date}: $${d.total.toFixed(2)} (${d.count} txns)`}</title>
                            </g>
                          )
                        })}
                      </svg>
                    )
                  })()}
                </div>
              )}

              <div className="grid md:grid-cols-2 gap-6">
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <h3 className="font-semibold text-slate-800 mb-3">Top Products Today</h3>
                  {(dashboard.topProducts ?? []).length === 0 && (
                    <p className="text-sm text-slate-400">No sales yet today</p>
                  )}
                  {/* Simple SVG bar chart */}
                  {(dashboard.topProducts ?? []).length > 0 && (() => {
                    const items = dashboard.topProducts as any[]
                    const max = Math.max(...items.map((p) => Number(p.revenue ?? 0)), 1)
                    const barH = 120
                    const gap = 8
                    const barW = Math.floor(280 / items.length) - gap
                    return (
                      <svg viewBox={`0 0 280 ${barH + 30}`} className="w-full mb-3" role="img">
                        {items.map((p, i) => {
                          const h = (Number(p.revenue ?? 0) / max) * barH
                          const x = i * (barW + gap) + 4
                          const y = barH - h
                          return (
                            <g key={p.productId}>
                              <rect
                                x={x}
                                y={y}
                                width={barW}
                                height={h}
                                rx={3}
                                fill="#3b82f6"
                                opacity={0.85}
                              />
                              <text
                                x={x + barW / 2}
                                y={barH + 14}
                                textAnchor="middle"
                                fontSize="9"
                                fill="#64748b"
                              >
                                {(p.name || '').slice(0, 8)}
                              </text>
                            </g>
                          )
                        })}
                      </svg>
                    )
                  })()}
                  <ul className="space-y-2">
                    {(dashboard.topProducts ?? []).map((p: any) => (
                      <li key={p.productId} className="flex justify-between text-sm">
                        <span className="truncate">{p.name}</span>
                        <span className="font-medium text-slate-700">
                          ${Number(p.revenue ?? 0).toFixed(2)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <h3 className="font-semibold text-slate-800 mb-3">Recent Sales</h3>
                  {(dashboard.recentSales ?? []).length === 0 && (
                    <p className="text-sm text-slate-400">No sales yet today</p>
                  )}
                  <ul className="space-y-2">
                    {(dashboard.recentSales ?? []).map((s: any) => (
                      <li key={s.id} className="flex justify-between text-sm items-center">
                        <button
                          className="text-blue-600 hover:underline font-mono text-xs"
                          onClick={() => openReceipt(s.id)}
                        >
                          {s.invoiceNumber}
                        </button>
                        <span className="text-slate-500 text-xs">
                          {s.cashier?.firstName} · {s.paymentMethod}
                        </span>
                        <span className="font-medium">${Number(s.totalAmount).toFixed(2)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </>
          ) : (
            <p className="text-slate-400">Loading dashboard…</p>
          )}
        </div>
      )}

      {/* Reports */}
      {view === 'reports' && (
        <div className="p-6 max-w-3xl mx-auto w-full">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-slate-800">Daily Sales Report</h2>
            <div className="flex gap-2">
              <button
                onClick={() => downloadCsv('daily')}
                className="text-sm bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg"
              >
                Export Sales CSV
              </button>
              <button
                onClick={() => downloadCsv('inventory')}
                className="text-sm bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg"
              >
                Export Inventory CSV
              </button>
            </div>
          </div>
          {report ? (
            <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <div className="text-xs text-slate-500 uppercase">Gross Sales</div>
                  <div className="text-xl font-bold text-slate-800">
                    ${Number(report.totalSales ?? report.grossSales ?? 0).toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 uppercase">COGS (FIFO)</div>
                  <div className="text-xl font-bold text-slate-800">
                    ${Number(report.totalCogs ?? report.cogs ?? 0).toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 uppercase">Gross Profit</div>
                  <div className="text-xl font-bold text-green-600">
                    ${Number(report.grossProfit ?? 0).toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 uppercase">Transactions</div>
                  <div className="text-xl font-bold text-slate-800">
                    {report.transactionCount ?? report.saleCount ?? report.count ?? '—'}
                  </div>
                </div>
              </div>
              <pre className="text-xs bg-slate-50 p-3 rounded overflow-auto max-h-64">
                {JSON.stringify(report, null, 2)}
              </pre>
            </div>
          ) : (
            <p className="text-slate-400">Loading report…</p>
          )}
        </div>
      )}

      {/* Products list (read-only) */}
      {view === 'products' && (
        <div className="p-6 max-w-4xl mx-auto w-full">
          <h2 className="text-xl font-bold text-slate-800 mb-4">Products</h2>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">SKU</th>
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium text-right">Price</th>
                  <th className="px-4 py-2.5 font-medium text-right">Tax %</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-mono text-xs">{p.sku}</td>
                    <td className="px-4 py-2">{p.name}</td>
                    <td className="px-4 py-2 text-right">
                      ${Number(p.sellingPrice).toFixed(2)}
                    </td>
                    <td className="px-4 py-2 text-right">{Number(p.taxRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Open Register Modal */}
      {showOpenReg && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-lg font-bold mb-4">Open Cash Register</h3>
            <label className="block text-sm text-slate-600 mb-1">Opening Float</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={openingFloat}
              onChange={(e) => setOpeningFloat(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setShowOpenReg(false)}
                className="flex-1 border border-slate-300 py-2 rounded-lg text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleOpenRegister}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium"
              >
                Open
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Close Register Modal */}
      {showCloseReg && register && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-lg font-bold mb-1">Close Cash Register</h3>
            <p className="text-xs text-slate-500 mb-4">
              Opened {new Date(register.openedAt).toLocaleString()}
            </p>
            <label className="block text-sm text-slate-600 mb-1">Closing Cash Count</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={closingCash}
              onChange={(e) => setClosingCash(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setShowCloseReg(false)}
                className="flex-1 border border-slate-300 py-2 rounded-lg text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleCloseRegister}
                className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm font-medium"
              >
                Close Session
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receipt Preview Modal */}
      {showReceipt && receiptHtml && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="font-bold text-slate-800">Receipt</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const w = window.open('', '_blank', 'width=400,height=600')
                    if (w) {
                      w.document.write(receiptHtml)
                      w.document.close()
                      w.focus()
                      setTimeout(() => w.print(), 300)
                    }
                  }}
                  className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg"
                >
                  Print / PDF
                </button>
                {lastSaleId && (
                  <button
                    onClick={async () => {
                      try {
                        const res = await api.printReceipt(lastSaleId, 'log')
                        setSaleMsg(res.data?.message || 'Sent to printer')
                      } catch (err: any) {
                        setError(err.message)
                      }
                    }}
                    className="text-sm bg-slate-800 text-white px-3 py-1.5 rounded-lg"
                    title="Send ESC/POS to printer bridge (log driver in dev)"
                  >
                    Thermal
                  </button>
                )}
                {receiptEscpos && isWebUsbAvailable() && (
                  <button
                    onClick={async () => {
                      try {
                        const result = await printEscPosBase64(receiptEscpos)
                        if (result.success) setSaleMsg(result.message)
                        else setError(result.message)
                      } catch (err: any) {
                        setError(err.message)
                      }
                    }}
                    className="text-sm bg-purple-700 text-white px-3 py-1.5 rounded-lg"
                    title="Print via WebUSB (Chrome/Edge)"
                  >
                    WebUSB
                  </button>
                )}
                <button
                  onClick={() => setShowReceipt(false)}
                  className="text-sm border border-slate-300 px-3 py-1.5 rounded-lg"
                >
                  Close
                </button>
              </div>
            </div>
            <div
              className="overflow-auto p-4"
              dangerouslySetInnerHTML={{ __html: receiptHtml }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default App
