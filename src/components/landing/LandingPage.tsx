"use client";
import { motion } from "framer-motion";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowRight, Code2, Box, Layers, FileText, Sparkles } from "lucide-react";
import { GlassCard, AnimatedCounter, StatusBadge } from "@/components/ui";
import { FAQAccordion } from "./FAQAccordion";
import { animations } from "@/styles/theme";
const AutonomousEngine = dynamic(() => import("@/components/svg/AutonomousEngine").then(m=>m.AutonomousEngine), { ssr: true });
const SearchRadar = dynamic(() => import("@/components/svg/SearchRadar").then(m=>m.SearchRadar), { ssr: false });
const EmailRocket = dynamic(() => import("@/components/svg/EmailRocket").then(m=>m.EmailRocket), { ssr: false });
const PaymentBlocks = dynamic(() => import("@/components/svg/PaymentBlocks").then(m=>m.PaymentBlocks), { ssr: false });
const DeliveryBox = dynamic(() => import("@/components/svg/DeliveryBox").then(m=>m.DeliveryBox), { ssr: false });
const BrainNetwork = dynamic(() => import("@/components/svg/BrainNetwork").then(m=>m.BrainNetwork), { ssr: false });
const SERVICES = [
  { id:"blog-post", name:"SEO Blog Post", price:9, icon:FileText, desc:"2000-word SEO-optimized article", accent:"amber" },
  { id:"landing-page", name:"Landing Page", price:19, icon:Code2, desc:"High-converting single-page site", accent:"violet" },
  { id:"3d-website", name:"3D Interactive Site", price:49, icon:Box, desc:"Three.js-powered immersive experience", accent:"emerald" },
  { id:"saas-scaffold", name:"SaaS Scaffold", price:99, icon:Layers, desc:"Full Next.js + Prisma + Auth starter", accent:"rose" },
];
const STEPS = [
  { title:"Discover", desc:"AI scans the web daily for qualified leads matching your services.", svg:SearchRadar, size:100 },
  { title:"Outreach", desc:"Personalized emails are drafted, sent, and replies classified automatically.", svg:EmailRocket, size:100 },
  { title:"Transact", desc:"Crypto payments verified on-chain. UPI claims owner-approved. Stripe via Checkout.", svg:PaymentBlocks, size:140 },
  { title:"Deliver", desc:"Code generated, syntax-validated, sandbox-tested, zipped, and emailed.", svg:DeliveryBox, size:100 },
];
const ACCENT: Record<string,{text:string;border:string;bg:string}> = { amber:{text:"text-amber-300",border:"border-amber-500/30",bg:"bg-amber-500/10"}, violet:{text:"text-violet-300",border:"border-violet-500/30",bg:"bg-violet-500/10"}, emerald:{text:"text-emerald-300",border:"border-emerald-500/30",bg:"bg-emerald-500/10"}, rose:{text:"text-rose-300",border:"border-rose-500/30",bg:"bg-rose-500/10"} };
export function LandingPage() {
  const addr = process.env.NEXT_PUBLIC_SENDER_ADDRESS || "ARIA Mission Control";
  return (
    <div className="min-h-screen bg-[#0a0e0f] text-zinc-200 overflow-x-hidden">
      <section className="relative min-h-screen flex items-center justify-center px-4 py-20">
        <div className="absolute inset-0 pointer-events-none" style={{background:"radial-gradient(ellipse at top, rgba(16,185,129,0.08) 0%, transparent 60%)"}}/>
        <div className="relative z-10 max-w-5xl mx-auto text-center">
          <motion.div initial={{opacity:0,scale:0.8}} animate={{opacity:1,scale:1}} transition={{duration:1}} className="flex justify-center mb-8"><AutonomousEngine size={160}/></motion.div>
          <motion.h1 initial="initial" animate="animate" variants={animations.staggerContainer} className="text-4xl md:text-6xl font-bold leading-tight mb-4">
            {"The Autonomous AI Company".split(" ").map((w,i)=>(<motion.span key={i} variants={animations.staggerItem} className="inline-block mr-3" style={{background:i<3?"linear-gradient(135deg,#34d399 0%,#2dd4bf 100%)":"none",WebkitBackgroundClip:i<3?"text":undefined,WebkitTextFillColor:i<3?"transparent":undefined}}>{w}</motion.span>))}
            <br/><motion.span variants={animations.staggerItem} className="inline-block text-zinc-400 text-3xl md:text-4xl">That Works While You Sleep.</motion.span>
          </motion.h1>
          <motion.p initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{delay:0.4}} className="text-base md:text-lg text-zinc-400 max-w-2xl mx-auto mb-8">Discover leads, execute outreach, verify crypto/UPI payments, and deliver AI-generated software 24/7. Zero marginal cost.</motion.p>
          <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{delay:0.6}} className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/services"><motion.button whileHover={{scale:1.03,y:-2}} whileTap={{scale:0.97}} className="px-6 py-3 rounded-xl font-medium text-[#0a0e0f] shadow-lg flex items-center gap-2 justify-center" style={{background:"linear-gradient(135deg,#10b981 0%,#14b8a6 100%)",boxShadow:"0 0 32px rgba(16,185,129,0.4)"}}>Browse Services<ArrowRight className="w-4 h-4"/></motion.button></Link>
            <Link href="/dev/gallery"><motion.button whileHover={{scale:1.03,y:-2}} whileTap={{scale:0.97}} className="px-6 py-3 rounded-xl font-medium text-zinc-200 border border-white/10 backdrop-blur-xl bg-white/[0.03] hover:bg-white/[0.06] flex items-center gap-2 justify-center"><Sparkles className="w-4 h-4 text-emerald-400"/>View Gallery</motion.button></Link>
          </motion.div>
        </div>
      </section>
      <section className="py-12 px-4 border-y border-white/[0.06]"><div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6">{[{value:24,suffix:"/7",label:"Autonomous Uptime"},{value:10000,suffix:"+",label:"Lines Generated"},{value:99,suffix:"%",label:"Quality Pass Rate"},{value:0,prefix:"$",suffix:"/mo",label:"Monthly Overhead"}].map((s,i)=>(<motion.div key={i} initial={{opacity:0,y:20}} whileInView={{opacity:1,y:0}} viewport={{once:true}} transition={{delay:i*0.1}} className="text-center"><div className="text-2xl md:text-3xl font-bold text-emerald-400 mb-1"><AnimatedCounter value={s.value} prefix={s.prefix||""} suffix={s.suffix||""}/></div><div className="text-xs text-zinc-500">{s.label}</div></motion.div>))}</div></section>
      <section className="py-20 px-4"><div className="max-w-5xl mx-auto"><motion.div initial={{opacity:0,y:20}} whileInView={{opacity:1,y:0}} viewport={{once:true}} className="text-center mb-12"><h2 className="text-2xl md:text-3xl font-bold text-zinc-100 mb-2">The Autonomous Loop</h2><p className="text-sm text-zinc-500">Four steps. Zero human intervention between them.</p></motion.div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {STEPS.map((s, i) => {
            const StepSvg = s.svg;
            return (
              <motion.div key={i} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.15 }}>
                <GlassCard className="p-6 h-full flex flex-col items-center text-center" hover glow="emerald">
                  <div className="flex items-center justify-center h-24 mb-4"><StepSvg size={s.size} /></div>
                  <div className="flex items-center gap-2 mb-2"><span className="text-xs font-mono text-zinc-600">0{i + 1}</span><h3 className="text-base font-semibold text-zinc-200">{s.title}</h3></div>
                  <p className="text-xs text-zinc-500">{s.desc}</p>
                </GlassCard>
              </motion.div>
            );
          })}
        </div></div></section>
      <section className="py-20 px-4 border-t border-white/[0.06]"><div className="max-w-5xl mx-auto"><motion.div initial={{opacity:0,y:20}} whileInView={{opacity:1,y:0}} viewport={{once:true}} className="text-center mb-12"><h2 className="text-2xl md:text-3xl font-bold text-zinc-100 mb-2">What ARIA Builds</h2><p className="text-sm text-zinc-500">10 services. $9 to $99. Delivered in hours.</p></motion.div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {SERVICES.map((s, i) => {
            const Icon = s.icon; const a = ACCENT[s.accent];
            return (
              <motion.div key={s.id} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}>
                <GlassCard className="p-5 h-full flex flex-col" hover>
                  <div className={`flex items-center justify-center w-12 h-12 rounded-xl ${a.bg} ${a.border} border mb-4`}><Icon className={`w-6 h-6 ${a.text}`} /></div>
                  <h3 className="text-sm font-semibold text-zinc-200 mb-1">{s.name}</h3>
                  <p className="text-xs text-zinc-500 mb-3 flex-1">{s.desc}</p>
                  <div className="flex items-baseline gap-1 mb-3"><span className="text-2xl font-bold text-emerald-400">${s.price}</span><span className="text-xs text-zinc-600">one-time</span></div>
                  <Link href="/services"><button className="w-full py-1.5 text-xs font-medium rounded-lg border border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.06] transition-colors">Order Now</button></Link>
                </GlassCard>
              </motion.div>
            );
          })}
        </div></div></section>
      <section className="py-20 px-4 border-t border-white/[0.06]"><div className="max-w-4xl mx-auto"><div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center"><motion.div initial={{opacity:0,x:-30}} whileInView={{opacity:1,x:0}} viewport={{once:true}}><h2 className="text-2xl md:text-3xl font-bold text-zinc-100 mb-4">The Engine Under the Hood</h2><p className="text-sm text-zinc-400 leading-relaxed mb-4">Powered by a self-healing, multi-provider LLM router with automatic failover across Z-AI, Groq, NVIDIA, and local Ollama. 66 specialized agents across 15 departments work in a continuous tick loop — discovering leads, drafting emails, verifying payments, and building software.</p><div className="flex flex-wrap gap-2"><StatusBadge status="active">5-Provider Failover</StatusBadge><StatusBadge status="active">Circuit Breaker</StatusBadge><StatusBadge status="success">CAN-SPAM Compliant</StatusBadge><StatusBadge status="success">Self-Healing</StatusBadge></div></motion.div><motion.div initial={{opacity:0,x:30}} whileInView={{opacity:1,x:0}} viewport={{once:true}} className="flex justify-center"><BrainNetwork size={180}/></motion.div></div></div></section>
      <section className="py-20 px-4 border-t border-white/[0.06]"><div className="max-w-2xl mx-auto"><motion.div initial={{opacity:0,y:20}} whileInView={{opacity:1,y:0}} viewport={{once:true}} className="text-center mb-10"><h2 className="text-2xl md:text-3xl font-bold text-zinc-100 mb-2">Frequently Asked</h2><p className="text-sm text-zinc-500">The honest answers.</p></motion.div><FAQAccordion/></div></section>
      <footer className="border-t border-white/[0.06] py-8 px-4"><div className="max-w-4xl mx-auto"><div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-6"><div className="flex items-center gap-2"><AutonomousEngine size={28}/><span className="text-sm font-semibold text-zinc-300">ARIA Mission Control</span></div><div className="flex flex-wrap gap-4 text-xs text-zinc-500"><Link href="/services" className="hover:text-zinc-300">Services</Link><Link href="/playground" className="hover:text-zinc-300">Playground</Link><Link href="/login" className="hover:text-zinc-300">Dashboard</Link><Link href="/legal/terms" className="hover:text-zinc-300">Terms</Link><Link href="/legal/privacy" className="hover:text-zinc-300">Privacy</Link><Link href="/legal/refund" className="hover:text-zinc-300">Refunds</Link></div></div><div className="border-t border-white/[0.04] pt-4 flex flex-col md:flex-row items-center justify-between gap-2"><p className="text-xs text-zinc-600">© {new Date().getFullYear()} ARIA Mission Control.</p><p className="text-xs text-zinc-600">{addr} · CAN-SPAM Compliant · Crypto + UPI + Card</p></div></div></footer>
    </div>
  );
}
