"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";
const FAQS = [
  { q:"Is the generated code actually good?", a:"Every deliverable passes an automated Quality Gate: HTML tag balance, TypeScript brace matching, YAML syntax, JSON parse, + sandbox execution via node --check. If the LLM generates broken code, the system retries once with error feedback. If it still fails, the order is marked for manual review — you don't pay for broken output." },
  { q:"What if I don't like what I get?", a:"Every order is eligible for a manual refund within 7 days. The owner reviews refund requests and can reverse the delivery — download link revoked, crypto returned. For UPI payments, the owner approves every claim before the build starts." },
  { q:"How do payments work?", a:"Three options. Crypto: send BTC/ETH/SOL/USDT/USDC to the wallet address — verified on-chain. UPI: scan QR with PhonePe/GPay/Paytm, pay exact INR, enter UTR. Stripe: pay by card via Stripe Checkout. No middleman, no card fees for crypto/UPI." },
  { q:"How fast is delivery?", a:"Most services deliver within 1-2 hours of payment confirmation. The $9 blog post and $19 landing page typically complete in under 30 minutes. The $99 SaaS scaffold takes 2-4 hours." },
  { q:"Is this actually autonomous?", a:"Yes. Lead discovery, email drafting, payment verification, code generation, and quality validation are all autonomous. The owner intervenes at: approving leads, approving UPI payments, and handling refunds. Crypto payments with sufficient confirmations are auto-approved." },
];
export function FAQAccordion() {
  const [open,setOpen]=useState<number|null>(0);
  return (<div className="space-y-3">{FAQS.map((f,i)=>{const isOpen=open===i;return(<motion.div key={i} initial={{opacity:0,y:10}} whileInView={{opacity:1,y:0}} viewport={{once:true,margin:"-50px"}} transition={{delay:i*0.08,duration:0.4}} className="rounded-xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-xl overflow-hidden"><button onClick={()=>setOpen(isOpen?null:i)} className="w-full flex items-center justify-between gap-4 p-4 text-left hover:bg-white/[0.02] transition-colors"><span className="text-sm font-medium text-zinc-200">{f.q}</span><motion.div animate={{rotate:isOpen?180:0}} transition={{duration:0.2}}><ChevronDown className="w-4 h-4 text-zinc-500"/></motion.div></button><AnimatePresence initial={false}>{isOpen&&<motion.div initial={{height:0,opacity:0}} animate={{height:"auto",opacity:1}} exit={{height:0,opacity:0}} transition={{duration:0.25}} className="overflow-hidden"><p className="px-4 pb-4 text-sm text-zinc-400 leading-relaxed">{f.a}</p></motion.div>}</AnimatePresence></motion.div>);})}</div>);
}
