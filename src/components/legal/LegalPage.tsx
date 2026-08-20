"use client";
import { motion } from "framer-motion";
import Link from "next/link";
import type { ReactElement } from "react";
interface LegalPageProps { title: string; content: string; lastUpdated: string; }
export function LegalPage({ title, content, lastUpdated }: LegalPageProps) {
  const lines = content.trim().split("\n");
  const rendered: ReactElement[] = [];
  let listItems: string[] = [];
  const flushList = () => { if (listItems.length > 0) { rendered.push(<ul key={`ul-${rendered.length}`} className="space-y-1.5 mb-4 ml-4">{listItems.map((item, i) => <li key={i} className="text-sm text-zinc-400 flex gap-2"><span className="text-emerald-500 flex-shrink-0">•</span><span>{item}</span></li>)}</ul>); listItems = []; } };
  lines.forEach((line, i) => { const trimmed = line.trim(); if (trimmed.startsWith("## ")) { flushList(); rendered.push(<h2 key={i} className="text-base font-semibold text-zinc-200 mt-6 mb-2 first:mt-0">{trimmed.slice(3)}</h2>); } else if (trimmed.startsWith("- ")) { listItems.push(trimmed.slice(2)); } else if (trimmed === "") { flushList(); } else { flushList(); rendered.push(<p key={i} className="text-sm text-zinc-400 leading-relaxed mb-3">{trimmed}</p>); } });
  flushList();
  return (<div className="min-h-screen bg-[#0a0e0f] text-zinc-200"><div className="max-w-3xl mx-auto px-4 py-12"><motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8"><h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent mb-2">{title}</h1><p className="text-xs text-zinc-600">Last updated: {lastUpdated}</p></motion.div><motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="rounded-xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-xl p-6 md:p-8">{rendered}</motion.div><div className="mt-8 flex flex-wrap gap-4 text-xs text-zinc-600"><Link href="/legal/terms" className="hover:text-zinc-400 transition-colors">Terms of Service</Link><Link href="/legal/privacy" className="hover:text-zinc-400 transition-colors">Privacy Policy</Link><Link href="/legal/refund" className="hover:text-zinc-400 transition-colors">Refund Policy</Link><Link href="/services" className="hover:text-zinc-400 transition-colors">← Back to Services</Link></div></div></div>);
}
