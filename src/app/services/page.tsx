"use client";

/**
 * /services — public service catalog with crypto checkout.
 *
 * v32: Crypto payments. Customer clicks "Buy",
 * sees a QR code for the wallet address, sends crypto from their
 * wallet app. Owner manually approves in the dashboard.
 */
import { useState, useEffect, FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Globe, Layout, Box, Mic, Layers, Terminal, Server, BarChart3, PenTool, FileText,
  Sparkles, ArrowRight, CheckCircle2, Loader2, AlertTriangle, Download, Clock,
  Copy, Bitcoin,
} from "lucide-react";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Globe, Layout, Box, Mic, Layers, Terminal, Server, BarChart3, PenTool, FileText,
};

interface Service {
  id: string;
  name: string;
  category: string;
  tagline: string;
  description: string;
  priceCents: number;
  deliveryHours: number;
  inputs: string[];
  deliverables: string[];
  freePreview: boolean;
  icon: string;
  accent: string;
}

interface CryptoOrder {
  orderId: string;
  serviceName: string;
  priceCents: number;
  priceUsd: string;
  cryptoNetwork: string;
  walletAddress: string;
  qrCodeUrl: string;
  status: string;
}

interface Order {
  id: string;
  serviceId: string;
  serviceName: string;
  spec: string;
  priceCents: number;
  status: string;
  cryptoNetwork: string;
  walletAddress: string;
  ownerApproved: boolean;
  fileCount: number;
  files: string[];
  buildProvider: string | null;
  buildModel: string | null;
  createdAt: string;
  deliveredAt: string | null;
  downloadUrl: string | null;
}

export default function ServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [cryptoConfigured, setCryptoConfigured] = useState(false);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [spec, setSpec] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [txHash, setTxHash] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [cryptoOrder, setCryptoOrder] = useState<CryptoOrder | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/services/catalog")
      .then((r) => r.json())
      .then((data) => {
        setServices(data.services || []);
        setCategories(data.categories || []);
        setCryptoConfigured(!!data.crypto?.configured);
      })
      .catch(() => setError("failed to load catalog"));
    refreshOrders();
  }, []);

  async function refreshOrders() {
    try {
      const res = await fetch("/api/services/orders");
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders || []);
      }
    } catch {}
  }

  const filteredServices = activeCategory === "all"
    ? services
    : services.filter((s) => s.category === activeCategory);

  async function handlePreview(e: FormEvent) {
    e.preventDefault();
    if (!selectedService || !spec.trim()) return;
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const res = await fetch("/api/services/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId: selectedService.id, spec }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "preview failed");
      else setPreview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleBuy(e: FormEvent) {
    e.preventDefault();
    if (!selectedService || !spec.trim()) return;
    setLoading(true);
    setError(null);
    setCryptoOrder(null);
    try {
      const res = await fetch("/api/services/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId: selectedService.id,
          spec,
          customerEmail: email || undefined,
          customerName: name || undefined,
          cryptoTxHash: txHash || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "checkout failed");
      } else {
        setCryptoOrder(data);
        refreshOrders();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function copyWallet() {
    if (cryptoOrder) {
      navigator.clipboard.writeText(cryptoOrder.walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-zinc-800/80 bg-zinc-900/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="rounded-md bg-amber-500/20 p-1.5">
              <Bitcoin className="h-4 w-4 text-amber-300" />
            </div>
            <div>
              <h1 className="text-sm font-semibold">ARIA Services — Crypto Checkout</h1>
              <p className="text-[10px] text-muted-foreground">{services.length} services · Pay with crypto · $0 fees</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <a href="/" className="text-[10px] text-muted-foreground hover:text-zinc-200">← ARIA</a>
            <a href="/playground" className="text-[10px] text-muted-foreground hover:text-zinc-200">Playground</a>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-bold mb-2">
            Pay ARIA in <span className="text-amber-400">Crypto</span> to build your software
          </h2>
          <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
            No middleman, no KYC, no fees. Send crypto to the wallet address, owner verifies, ARIA builds. Simple.
          </p>
        </div>

        {/* Category filter */}
        <div className="flex flex-wrap gap-2 justify-center mb-8">
          <button onClick={() => setActiveCategory("all")}
            className={`px-3 py-1.5 rounded-full text-xs font-medium ${activeCategory === "all" ? "bg-amber-600 text-white" : "bg-muted text-muted-foreground hover:text-zinc-200"}`}>
            All ({services.length})
          </button>
          {categories.map((c) => (
            <button key={c.id} onClick={() => setActiveCategory(c.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium ${activeCategory === c.id ? "bg-amber-600 text-white" : "bg-muted text-muted-foreground hover:text-zinc-200"}`}>
              {c.label} ({c.count})
            </button>
          ))}
        </div>

        {/* Service grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-12">
          {filteredServices.map((s) => {
            const Icon = ICONS[s.icon] || Globe;
            return (
              <div key={s.id}
                className={`rounded-lg border border-zinc-800 bg-zinc-900/60 p-5 hover:border-amber-500/40 transition-colors cursor-pointer ${selectedService?.id === s.id ? "border-amber-500/60 ring-1 ring-amber-500/30" : ""}`}
                onClick={() => { setSelectedService(s); setPreview(null); setError(null); setCryptoOrder(null); }}>
                <div className="flex items-start justify-between mb-3">
                  <div className={`rounded-md bg-${s.accent}-500/20 p-2`}>
                    <Icon className={`h-5 w-5 text-${s.accent}-300`} />
                  </div>
                  {s.freePreview && (
                    <span className="text-[9px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">FREE PREVIEW</span>
                  )}
                </div>
                <h3 className="text-sm font-semibold mb-1">{s.name}</h3>
                <p className="text-[11px] text-muted-foreground mb-3 line-clamp-2">{s.tagline}</p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Clock className="h-3 w-3" />{s.deliveryHours}h
                  </div>
                  <div className="text-lg font-bold">${(s.priceCents / 100).toFixed(0)}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Selected service detail + crypto checkout */}
        {selectedService && !cryptoOrder && (
          <div className="rounded-lg border border-amber-500/30 bg-zinc-900/80 p-6 mb-8">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold">{selectedService.name}</h3>
                <p className="text-sm text-muted-foreground mt-1">{selectedService.description}</p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-amber-400">${(selectedService.priceCents / 100).toFixed(0)}</div>
                <div className="text-[10px] text-muted-foreground">{selectedService.deliveryHours}h delivery</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4 text-xs">
              <div>
                <div className="text-muted-foreground mb-1">What you provide:</div>
                <ul className="space-y-1">
                  {selectedService.inputs.map((inp, i) => (
                    <li key={i} className="text-foreground">• {inp}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-muted-foreground mb-1">What ARIA delivers:</div>
                <ul className="space-y-1">
                  {selectedService.deliverables.map((d, i) => (
                    <li key={i} className="text-foreground flex items-start gap-1">
                      <CheckCircle2 className="h-3 w-3 text-emerald-400 mt-0.5 flex-shrink-0" /> {d}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <form className="space-y-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Your spec — describe what you want built:</label>
                <textarea value={spec} onChange={(e) => setSpec(e.target.value)}
                  placeholder="e.g., A landing page for my coffee shop..."
                  rows={4} maxLength={5000}
                  className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber-500" />
                <div className="text-[9px] text-muted-foreground mt-0.5">{spec.length} / 5000</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com (for delivery link)"
                  className="bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber-500" />
                <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="Your name (optional)"
                  className="bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber-500" />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Crypto TX hash (optional — speeds up verification):</label>
                <input type="text" value={txHash} onChange={(e) => setTxHash(e.target.value)}
                  placeholder="0x... (optional)"
                  className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber-500" />
              </div>

              {error && (
                <div className="text-xs text-rose-400 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> {error}
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                {selectedService.freePreview && (
                  <button onClick={handlePreview} disabled={loading || !spec.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-zinc-200 bg-muted hover:bg-zinc-700 disabled:opacity-50 rounded-md">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    Try Free Preview
                  </button>
                )}
                <button onClick={handleBuy} disabled={loading || !spec.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-amber-600 hover:bg-amber-500 disabled:opacity-50 rounded-md">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bitcoin className="h-4 w-4" />}
                  Pay with Crypto
                </button>
              </div>
            </form>

            {preview && (
              <div className="mt-4 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <span className="text-sm font-medium text-emerald-300">Preview generated</span>
                </div>
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {Object.entries(preview.files).map(([name, content]) => (
                    <div key={name}>
                      <div className="text-xs font-mono text-amber-300 mb-1">--- {name} ---</div>
                      <pre className="text-[10px] bg-zinc-900 rounded p-2 overflow-x-auto text-foreground whitespace-pre-wrap">{content as string}</pre>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Crypto payment screen */}
        {cryptoOrder && (
          <div className="rounded-lg border border-amber-500/40 bg-zinc-900/90 p-6 mb-8 max-w-2xl mx-auto">
            <div className="text-center mb-4">
              <h3 className="text-xl font-bold text-amber-400">Send {cryptoOrder.cryptoNetwork} to Complete Your Order</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Order ID: <span className="font-mono text-foreground">{cryptoOrder.orderId}</span>
              </p>
            </div>

            <div className="flex flex-col md:flex-row gap-6 items-center">
              {/* QR Code */}
              <div className="bg-white p-4 rounded-lg">
                <QRCodeSVG
                  value={cryptoOrder.cryptoNetwork === "BTC"
                    ? `bitcoin:${cryptoOrder.walletAddress}?amount=${(cryptoOrder.priceCents / 100).toFixed(8)}`
                    : cryptoOrder.walletAddress}
                  size={200}
                  level="M"
                />
              </div>

              {/* Payment details */}
              <div className="flex-1 space-y-3 w-full">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Amount Due:</div>
                  <div className="text-2xl font-bold text-amber-400">{cryptoOrder.priceUsd} USD</div>
                  <div className="text-xs text-muted-foreground">in {cryptoOrder.cryptoNetwork} equivalent</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Wallet Address:</div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-muted rounded px-2 py-1.5 break-all">
                      {cryptoOrder.walletAddress}
                    </code>
                    <button onClick={copyWallet}
                      className="px-2 py-1.5 bg-muted rounded text-muted-foreground hover:text-zinc-200">
                      {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Network:</div>
                  <div className="text-sm font-medium">{cryptoOrder.cryptoNetwork}</div>
                </div>
              </div>
            </div>

            <div className="mt-6 p-4 rounded-md bg-amber-500/10 border border-amber-500/30">
              <p className="text-xs text-amber-300">
                <strong>How it works:</strong> Send the exact amount from your crypto wallet to the address above.
                The owner will verify your payment and click "Approve & Build". Once approved, ARIA generates your
                deliverable automatically. You'll receive a download link via email + can track status below.
              </p>
            </div>

            <div className="mt-4 text-center">
              <button onClick={() => setCryptoOrder(null)}
                className="text-xs text-muted-foreground hover:text-foreground">
                ← Back to services
              </button>
            </div>
          </div>
        )}

        {/* Orders */}
        {orders.length > 0 && (
          <div className="mt-8">
            <h3 className="text-lg font-semibold mb-4">Your Orders</h3>
            <div className="space-y-3">
              {orders.map((o) => (
                <div key={o.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">{o.serviceName}</div>
                    <div className="text-[10px] text-muted-foreground">
                      ${(o.priceCents / 100).toFixed(2)} · {new Date(o.createdAt).toLocaleString()}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1 max-w-md truncate">{o.spec}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-[10px] px-2 py-1 rounded-full ${
                      o.status === "delivered" ? "bg-emerald-500/10 text-emerald-400" :
                      o.status === "failed" ? "bg-rose-500/10 text-rose-400" :
                      o.status === "building" ? "bg-amber-500/10 text-amber-400 animate-pulse" :
                      "bg-muted text-muted-foreground"
                    }`}>
                      {o.status === "pending_payment" ? "Awaiting Payment" :
                       o.status === "building" ? "Building..." :
                       o.status === "delivered" ? "Ready" :
                       o.status}
                    </span>
                    {o.downloadUrl && (
                      <a href={o.downloadUrl}
                        className="flex items-center gap-1 text-xs text-amber-300 hover:text-amber-200">
                        <Download className="h-3 w-3" /> Download
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
