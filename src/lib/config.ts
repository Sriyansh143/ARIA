// JARVIS Mission Control — central config, roster, skill catalog, cron roster.

export const JARVIS = {
  version: '9.0.0',
  codename: 'JARVIS',
  fullName: 'Just A Rather Very Intelligent System',
  tagline: 'Autonomous Agent Orchestration',
  // Core JARVIS cyberpunk palette
  colors: {
    bg: '#08090A',
    bgSoft: '#0C0F14',
    panel: '#0E1218',
    panelSoft: '#121821',
    border: '#1B2330',
    borderSoft: '#141B26',
    cyan: '#7DD3FC',
    cyanDim: '#38BDF8',
    green: '#34D399',
    amber: '#FBBF24',
    red: '#F87171',
    violet: '#C4B5FD',
    text: '#E2E8F0',
    textDim: '#94A3B8',
    textMute: '#64748B',
  },
} as const;

export type AgentStatus = 'idle' | 'thinking' | 'working' | 'error' | 'offline';

export interface AgentSeed {
  name: string;
  codename: string;
  role: string;
  status: AgentStatus;
  skills: string[];
  model: string;
  load: number;
  successRate: number;
  department: string;
  seniority: 'intern' | 'junior' | 'mid' | 'senior' | 'lead' | 'director' | 'vp' | 'c-suite';
  title: string;
}

// 16 departments across the JARVIS MNC-style org.
export const DEPARTMENTS = [
  { key: 'engineering', name: 'Engineering', color: '#7DD3FC', icon: 'Code2' },
  { key: 'research', name: 'Research', color: '#C4B5FD', icon: 'Microscope' },
  { key: 'data', name: 'Data', color: '#34D399', icon: 'BarChart3' },
  { key: 'design', name: 'Design', color: '#FBBF24', icon: 'Palette' },
  { key: 'product', name: 'Product', color: '#F87171', icon: 'Package' },
  { key: 'marketing', name: 'Marketing', color: '#38BDF8', icon: 'Megaphone' },
  { key: 'sales', name: 'Sales', color: '#A78BFA', icon: 'TrendingUp' },
  { key: 'finance', name: 'Finance', color: '#34D399', icon: 'Wallet' },
  { key: 'legal', name: 'Legal', color: '#FBBF24', icon: 'Gavel' },
  { key: 'hr', name: 'Human Resources', color: '#F472B6', icon: 'Users' },
  { key: 'operations', name: 'Operations', color: '#7DD3FC', icon: 'Settings' },
  { key: 'security', name: 'Security', color: '#F87171', icon: 'ShieldCheck' },
  { key: 'support', name: 'Support', color: '#34D399', icon: 'Headphones' },
  { key: 'content', name: 'Content', color: '#C4B5FD', icon: 'PenLine' },
  { key: 'qa', name: 'Quality Assurance', color: '#FBBF24', icon: 'Bug' },
  { key: 'infrastructure', name: 'Infrastructure', color: '#38BDF8', icon: 'Server' },
] as const;

// 64-agent roster — each department staffed with 4 specialists.
// Codenames are mythological / star / celestial names. Names are friendly handles.
export const AGENT_ROSTER: AgentSeed[] = [
  // ── 1. Engineering (4) ──
  { name: 'Orion', codename: 'ORION', role: 'Lead Orchestrator', status: 'working', skills: ['planning', 'decompose', 'dispatch'], model: 'glm-4.6', load: 62, successRate: 99.2, department: 'engineering', seniority: 'c-suite', title: 'Chief Technology Officer' },
  { name: 'Atlas', codename: 'ATLAS', role: 'Code Engineer', status: 'working', skills: ['code-gen', 'code-review', 'refactor'], model: 'glm-4.6', load: 78, successRate: 96.4, department: 'engineering', seniority: 'senior', title: 'Senior Software Engineer' },
  { name: 'Forge', codename: 'FORGE', role: 'Build & Deploy', status: 'working', skills: ['ci-cd', 'docker', 'rollback'], model: 'glm-4.6', load: 55, successRate: 94.7, department: 'engineering', seniority: 'mid', title: 'DevOps Engineer' },
  { name: 'Volt', codename: 'VOLT', role: 'Mobile Builder', status: 'idle', skills: ['react-native', 'expo', 'flutter'], model: 'glm-4.6', load: 22, successRate: 95.3, department: 'engineering', seniority: 'mid', title: 'Mobile Engineer' },

  // ── 2. Research (4) ──
  { name: 'Vega', codename: 'VEGA', role: 'Research Analyst', status: 'thinking', skills: ['web-search', 'web-reader', 'summarize'], model: 'glm-4.6', load: 41, successRate: 97.8, department: 'research', seniority: 'senior', title: 'Senior Research Analyst' },
  { name: 'Lyra', codename: 'LYRA', role: 'Synthesist', status: 'thinking', skills: ['synthesize', 'cross-check', 'summarize'], model: 'glm-4.6', load: 38, successRate: 98.1, department: 'research', seniority: 'mid', title: 'Research Synthesist' },
  { name: 'Sirius', codename: 'SIRIUS', role: 'Tech Writer', status: 'idle', skills: ['docs', 'diagrams', 'tutorials'], model: 'glm-4.6', load: 14, successRate: 96.7, department: 'research', seniority: 'mid', title: 'Technical Writer' },
  { name: 'Quasar', codename: 'QUASAR', role: 'Fact Checker', status: 'idle', skills: ['verify', 'cite', 'audit'], model: 'glm-4.6', load: 9, successRate: 99.4, department: 'research', seniority: 'junior', title: 'Fact-Checking Analyst' },

  // ── 3. Data (4) ──
  { name: 'Nova', codename: 'NOVA', role: 'Data Scientist', status: 'idle', skills: ['data-analysis', 'charts', 'forecast'], model: 'glm-4.6', load: 12, successRate: 98.6, department: 'data', seniority: 'senior', title: 'Senior Data Scientist' },
  { name: 'Draco', codename: 'DRACO', role: 'ML Engineer', status: 'working', skills: ['ml-pipelines', 'training', 'inference'], model: 'glm-4.6', load: 67, successRate: 95.8, department: 'data', seniority: 'senior', title: 'ML Engineer' },
  { name: 'Hydra', codename: 'HYDRA', role: 'Data Analyst', status: 'thinking', skills: ['sql', 'dashboards', 'reports'], model: 'glm-4.6', load: 44, successRate: 97.2, department: 'data', seniority: 'mid', title: 'Data Analyst' },
  { name: 'Phoenix', codename: 'PHOENIX', role: 'BI Specialist', status: 'idle', skills: ['bi', 'etl', 'warehouse'], model: 'glm-4.6', load: 18, successRate: 96.5, department: 'data', seniority: 'mid', title: 'BI Specialist' },

  // ── 4. Design (4) ──
  { name: 'Echo', codename: 'ECHO', role: 'Brand & Comms', status: 'idle', skills: ['email', 'outreach', 'crm'], model: 'glm-4.6', load: 8, successRate: 95.1, department: 'design', seniority: 'mid', title: 'Brand Designer' },
  { name: 'Prism', codename: 'PRISM', role: 'UI/UX Designer', status: 'thinking', skills: ['wireframes', 'design-system', 'prototyping'], model: 'glm-4.6', load: 35, successRate: 96.9, department: 'design', seniority: 'senior', title: 'Senior UX Designer' },
  { name: 'Aurora', codename: 'AURORA', role: 'Visual Designer', status: 'working', skills: ['graphics', 'illustration', 'motion'], model: 'glm-4.6', load: 49, successRate: 94.2, department: 'design', seniority: 'mid', title: 'Visual Designer' },
  { name: 'Iris', codename: 'IRIS', role: 'Design Researcher', status: 'idle', skills: ['user-research', 'journey-maps', 'usability'], model: 'glm-4.6', load: 11, successRate: 97.5, department: 'design', seniority: 'junior', title: 'UX Researcher' },

  // ── 5. Product (4) ──
  { name: 'Sage', codename: 'SAGE', role: 'Knowledge Keeper / PM', status: 'thinking', skills: ['memory', 'index', 'retrieve', 'roadmap'], model: 'glm-4.6', load: 33, successRate: 99.9, department: 'product', seniority: 'lead', title: 'Lead Product Manager' },
  { name: 'Polaris', codename: 'POLARIS', role: 'Product Strategist', status: 'idle', skills: ['market-analysis', 'positioning', 'pricing'], model: 'glm-4.6', load: 19, successRate: 96.4, department: 'product', seniority: 'senior', title: 'Product Strategist' },
  { name: 'Centaurus', codename: 'CENTAURUS', role: 'Product Manager', status: 'working', skills: ['prds', 'backlog', 'prioritization'], model: 'glm-4.6', load: 52, successRate: 95.6, department: 'product', seniority: 'mid', title: 'Product Manager' },
  { name: 'Rigel', codename: 'RIGEL', role: 'User Researcher', status: 'idle', skills: ['interviews', 'surveys', 'insights'], model: 'glm-4.6', load: 7, successRate: 98.0, department: 'product', seniority: 'junior', title: 'Associate User Researcher' },

  // ── 6. Marketing (4) ──
  { name: 'Helios', codename: 'HELIOS', role: 'Content Marketer', status: 'thinking', skills: ['blog', 'seo-content', 'lead-magnets'], model: 'glm-4.6', load: 36, successRate: 96.0, department: 'marketing', seniority: 'mid', title: 'Content Marketing Manager' },
  { name: 'Zephyr', codename: 'ZEPHYR', role: 'Social Media Manager', status: 'working', skills: ['twitter', 'linkedin', 'instagram'], model: 'glm-4.6', load: 41, successRate: 94.8, department: 'marketing', seniority: 'mid', title: 'Social Media Manager' },
  { name: 'Catalyst', codename: 'CATALYST', role: 'Growth Hacker', status: 'working', skills: ['experiments', 'ab-tests', 'viral-loops'], model: 'glm-4.6', load: 58, successRate: 93.7, department: 'marketing', seniority: 'senior', title: 'Senior Growth Marketer' },
  { name: 'Spectrum', codename: 'SPECTRUM', role: 'SEO Specialist', status: 'idle', skills: ['keyword-research', 'on-page-seo', 'backlinks'], model: 'glm-4.6', load: 16, successRate: 96.3, department: 'marketing', seniority: 'mid', title: 'SEO Specialist' },

  // ── 7. Sales (4) ──
  { name: 'Antares', codename: 'ANTARES', role: 'Sales Development Rep', status: 'working', skills: ['prospecting', 'cold-email', 'booking'], model: 'glm-4.6', load: 71, successRate: 92.4, department: 'sales', seniority: 'junior', title: 'SDR' },
  { name: 'Andromeda', codename: 'ANDROMEDA', role: 'Account Executive', status: 'working', skills: ['demos', 'negotiation', 'closing'], model: 'glm-4.6', load: 64, successRate: 93.9, department: 'sales', seniority: 'senior', title: 'Senior Account Executive' },
  { name: 'Aquila', codename: 'AQUILA', role: 'Sales Engineer', status: 'thinking', skills: ['pre-sales', 'pocs', 'solutions'], model: 'glm-4.6', load: 39, successRate: 95.6, department: 'sales', seniority: 'mid', title: 'Sales Engineer' },
  { name: 'Cygnus', codename: 'CYGNUS', role: 'Channel Manager', status: 'idle', skills: ['partners', 'resellers', 'co-sell'], model: 'glm-4.6', load: 12, successRate: 94.1, department: 'sales', seniority: 'mid', title: 'Channel Manager' },

  // ── 8. Finance (4) ──
  { name: 'Perseus', codename: 'PERSEUS', role: 'CFO', status: 'thinking', skills: ['pnl', 'capital', 'board-reporting'], model: 'glm-4.6', load: 47, successRate: 98.7, department: 'finance', seniority: 'c-suite', title: 'Chief Financial Officer' },
  { name: 'Meridian', codename: 'MERIDIAN', role: 'Revenue Manager', status: 'working', skills: ['asc-606', 'mrr', 'pricing'], model: 'glm-4.6', load: 53, successRate: 96.8, department: 'finance', seniority: 'senior', title: 'Senior Revenue Manager' },
  { name: 'Apex', codename: 'APEX', role: 'Billing Specialist', status: 'working', skills: ['invoices', 'subscriptions', 'dunning'], model: 'glm-4.6', load: 38, successRate: 97.0, department: 'finance', seniority: 'mid', title: 'Billing Specialist' },
  { name: 'Zenith', codename: 'ZENITH', role: 'Bookkeeper', status: 'idle', skills: ['general-ledger', 'reconciliation', 'month-end'], model: 'glm-4.6', load: 14, successRate: 98.2, department: 'finance', seniority: 'mid', title: 'Bookkeeper' },

  // ── 9. Legal (4) ──
  { name: 'Themis', codename: 'THEMIS', role: 'General Counsel', status: 'idle', skills: ['legal-strategy', 'risk', 'regulatory'], model: 'glm-4.6', load: 18, successRate: 99.0, department: 'legal', seniority: 'c-suite', title: 'General Counsel' },
  { name: 'Halcyon', codename: 'HALCYON', role: 'Contract Attorney', status: 'idle', skills: ['msa', 'sow', 'nda', 'saas'], model: 'glm-4.6', load: 22, successRate: 97.6, department: 'legal', seniority: 'senior', title: 'Senior Contract Attorney' },
  { name: 'Aegis', codename: 'AEGIS', role: 'IP Counsel', status: 'idle', skills: ['patents', 'trademarks', 'oss'], model: 'glm-4.6', load: 9, successRate: 96.4, department: 'legal', seniority: 'mid', title: 'IP Counsel' },
  { name: 'Veritas', codename: 'VERITAS', role: 'Privacy Officer', status: 'thinking', skills: ['gdpr', 'dsar', 'dpa'], model: 'glm-4.6', load: 27, successRate: 97.8, department: 'legal', seniority: 'mid', title: 'Privacy Officer' },

  // ── 10. HR (4) ──
  { name: 'Maia', codename: 'MAIA', role: 'HR Director', status: 'thinking', skills: ['org-design', 'comp', 'culture'], model: 'glm-4.6', load: 31, successRate: 98.3, department: 'hr', seniority: 'director', title: 'HR Director' },
  { name: 'Clio', codename: 'CLIO', role: 'Recruiter', status: 'working', skills: ['sourcing', 'screening', 'ats'], model: 'glm-4.6', load: 56, successRate: 94.7, department: 'hr', seniority: 'mid', title: 'Recruiter' },
  { name: 'Calliope', codename: 'CALLIOPE', role: 'Onboarding Specialist', status: 'idle', skills: ['onboarding', 'equipment', '90-day-plans'], model: 'glm-4.6', load: 19, successRate: 96.1, department: 'hr', seniority: 'mid', title: 'Onboarding Specialist' },
  { name: 'Erato', codename: 'ERATO', role: 'People Operations', status: 'idle', skills: ['payroll', 'benefits', 'hris'], model: 'glm-4.6', load: 23, successRate: 97.4, department: 'hr', seniority: 'mid', title: 'People Ops Generalist' },

  // ── 11. Operations (4) ──
  { name: 'Hyperion', codename: 'HYPERION', role: 'Operations Manager', status: 'working', skills: ['process', 'resources', 'sops'], model: 'glm-4.6', load: 49, successRate: 96.0, department: 'operations', seniority: 'director', title: 'Operations Manager' },
  { name: 'Vulcan', codename: 'VULCAN', role: 'Process Automator', status: 'working', skills: ['rpa', 'workflows', 'automation'], model: 'glm-4.6', load: 42, successRate: 95.2, department: 'operations', seniority: 'mid', title: 'Process Automation Engineer' },
  { name: 'Hermes', codename: 'HERMES', role: 'Project Coordinator', status: 'thinking', skills: ['gantt', 'sprints', 'dependencies'], model: 'glm-4.6', load: 36, successRate: 96.7, department: 'operations', seniority: 'mid', title: 'Project Coordinator' },
  { name: 'Vesta', codename: 'VESTA', role: 'Procurement Specialist', status: 'idle', skills: ['rfps', 'vendors', 'negotiation'], model: 'glm-4.6', load: 14, successRate: 95.0, department: 'operations', seniority: 'mid', title: 'Procurement Specialist' },

  // ── 12. Security (4) ──
  { name: 'Sentinel', codename: 'SENTINEL', role: 'Security Engineer', status: 'working', skills: ['threat-modeling', 'audits', 'pentest'], model: 'glm-4.6', load: 51, successRate: 97.9, department: 'security', seniority: 'senior', title: 'Senior Security Engineer' },
  { name: 'Phalanx', codename: 'PHALANX', role: 'Compliance Officer', status: 'idle', skills: ['gdpr', 'soc2', 'hipaa'], model: 'glm-4.6', load: 17, successRate: 98.4, department: 'security', seniority: 'mid', title: 'Compliance Officer' },
  { name: 'Bastion', codename: 'BASTION', role: 'Incident Responder', status: 'idle', skills: ['triage', 'forensics', 'breach'], model: 'glm-4.6', load: 8, successRate: 96.6, department: 'security', seniority: 'mid', title: 'Incident Responder' },
  { name: 'Argus', codename: 'ARGUS', role: 'Data Protection Officer', status: 'idle', skills: ['ropa', 'dpia', 'breach-notify'], model: 'glm-4.6', load: 11, successRate: 97.7, department: 'security', seniority: 'mid', title: 'Data Protection Officer' },

  // ── 13. Support (4) ──
  { name: 'Nereid', codename: 'NEREID', role: 'Support Lead', status: 'working', skills: ['csat', 'sla', 'playbooks'], model: 'glm-4.6', load: 44, successRate: 96.8, department: 'support', seniority: 'lead', title: 'Support Team Lead' },
  { name: 'Triton', codename: 'TRITON', role: 'Tier-1 Support', status: 'working', skills: ['triage', 'faq', 'routing'], model: 'glm-4.6', load: 67, successRate: 94.2, department: 'support', seniority: 'junior', title: 'T1 Support Agent' },
  { name: 'Calypso', codename: 'CALYPSO', role: 'Tier-2 Support', status: 'thinking', skills: ['troubleshoot', 'bug-repro', 'workarounds'], model: 'glm-4.6', load: 38, successRate: 95.5, department: 'support', seniority: 'mid', title: 'T2 Support Engineer' },
  { name: 'Galene', codename: 'GALENE', role: 'Customer Success Manager', status: 'idle', skills: ['qbrs', 'renewals', 'expansion'], model: 'glm-4.6', load: 21, successRate: 96.9, department: 'support', seniority: 'senior', title: 'Senior CSM' },

  // ── 14. Content (4) ──
  { name: 'Polyhymnia', codename: 'POLYHYMNIA', role: 'Technical Documentarian', status: 'idle', skills: ['api-docs', 'adrs', 'dev-guides'], model: 'glm-4.6', load: 13, successRate: 97.5, department: 'content', seniority: 'mid', title: 'Technical Writer' },
  { name: 'Melpomene', codename: 'MELPOMENE', role: 'Copywriter', status: 'thinking', skills: ['landing-pages', 'ad-copy', 'email-sequences'], model: 'glm-4.6', load: 34, successRate: 95.8, department: 'content', seniority: 'mid', title: 'Copywriter' },
  { name: 'Euterpe', codename: 'EUTERPE', role: 'Editor', status: 'idle', skills: ['edit', 'proofread', 'style-guide'], model: 'glm-4.6', load: 16, successRate: 98.1, department: 'content', seniority: 'senior', title: 'Senior Editor' },
  { name: 'Terpsichore', codename: 'TERPSICHORE', role: 'Blogger', status: 'idle', skills: ['long-form', 'thought-leadership', 'guest-posts'], model: 'glm-4.6', load: 9, successRate: 95.0, department: 'content', seniority: 'junior', title: 'Associate Blogger' },

  // ── 15. Quality Assurance (4) ──
  { name: 'Labyrinth', codename: 'LABYRINTH', role: 'QA Tester', status: 'working', skills: ['test-plans', 'regression', 'bug-reports'], model: 'glm-4.6', load: 48, successRate: 96.2, department: 'qa', seniority: 'mid', title: 'QA Engineer' },
  { name: 'Sphinx', codename: 'SPHINX', role: 'Quality Reviewer', status: 'thinking', skills: ['review', 'gaps', 'improvements'], model: 'glm-4.6', load: 31, successRate: 97.3, department: 'qa', seniority: 'senior', title: 'Senior Quality Reviewer' },
  { name: 'Minotaur', codename: 'MINOTAUR', role: 'Performance Benchmarker', status: 'idle', skills: ['benchmarks', 'profiling', 'latency'], model: 'glm-4.6', load: 12, successRate: 96.5, department: 'qa', seniority: 'mid', title: 'Performance Engineer' },
  { name: 'Daedalus', codename: 'DAEDALUS', role: 'Test Engineer', status: 'idle', skills: ['e2e', 'integration', 'load-testing'], model: 'glm-4.6', load: 18, successRate: 95.9, department: 'qa', seniority: 'mid', title: 'Test Engineer' },

  // ── 16. Infrastructure (4) ──
  { name: 'Pulse', codename: 'PULSE', role: 'Monitoring', status: 'working', skills: ['telemetry', 'alerts', 'self-heal'], model: 'glm-4.6', load: 47, successRate: 99.5, department: 'infrastructure', seniority: 'mid', title: 'Monitoring Engineer' },
  { name: 'Gaia', codename: 'GAIA', role: 'Site Reliability Engineer', status: 'working', skills: ['sli', 'slo', 'incident-response'], model: 'glm-4.6', load: 43, successRate: 96.4, department: 'infrastructure', seniority: 'senior', title: 'Senior SRE' },
  { name: 'Cronos', codename: 'CRONOS', role: 'Release Engineer', status: 'idle', skills: ['canary', 'blue-green', 'rollout'], model: 'glm-4.6', load: 19, successRate: 95.7, department: 'infrastructure', seniority: 'mid', title: 'Release Engineer' },
  { name: 'Titan', codename: 'TITAN', role: 'Cloud Architect', status: 'thinking', skills: ['aws', 'gcp', 'multi-region'], model: 'glm-4.6', load: 28, successRate: 97.0, department: 'infrastructure', seniority: 'senior', title: 'Senior Cloud Architect' },
];

export interface SkillSeed {
  key: string;
  name: string;
  description: string;
  category: 'general' | 'research' | 'code' | 'comms' | 'data' | 'security' | 'media';
  icon: string;
  enabled: boolean;
}

export const SKILL_CATALOG: SkillSeed[] = [
  { key: 'web-search', name: 'Web Search', description: 'Search the live web for up-to-date information and citations.', category: 'research', icon: 'Globe', enabled: true },
  { key: 'web-reader', name: 'Web Reader', description: 'Extract clean article content from any URL.', category: 'research', icon: 'BookOpen', enabled: true },
  { key: 'summarize', name: 'Summarize', description: 'Condense long documents into crisp bullet points.', category: 'general', icon: 'ScrollText', enabled: true },
  { key: 'code-gen', name: 'Code Generation', description: 'Generate production-ready code from natural language.', category: 'code', icon: 'Code2', enabled: true },
  { key: 'code-review', name: 'Code Review', description: 'Analyze code for bugs, security, and style.', category: 'code', icon: 'ShieldCheck', enabled: true },
  { key: 'refactor', name: 'Refactor', description: 'Restructure code without changing behavior.', category: 'code', icon: 'Wrench', enabled: true },
  { key: 'data-analysis', name: 'Data Analysis', description: 'Explore datasets and surface insights.', category: 'data', icon: 'ChartLine', enabled: true },
  { key: 'charts', name: 'Chart Rendering', description: 'Render charts and visualizations from data.', category: 'data', icon: 'BarChart3', enabled: true },
  { key: 'forecast', name: 'Forecasting', description: 'Predict trends from historical series.', category: 'data', icon: 'TrendingUp', enabled: true },
  { key: 'email', name: 'Email Compose', description: 'Draft professional emails and replies.', category: 'comms', icon: 'Mail', enabled: true },
  { key: 'outreach', name: 'Client Outreach', description: 'Generate personalized outreach sequences.', category: 'comms', icon: 'Send', enabled: false },
  { key: 'crm', name: 'CRM Sync', description: 'Sync contacts and deals to the CRM.', category: 'comms', icon: 'Users', enabled: false },
  { key: 'planning', name: 'Task Planning', description: 'Decompose goals into executable task graphs.', category: 'general', icon: 'Workflow', enabled: true },
  { key: 'decompose', name: 'Decompose', description: 'Break epics into atomic sub-tasks.', category: 'general', icon: 'GitBranch', enabled: true },
  { key: 'dispatch', name: 'Dispatch', description: 'Route tasks to the best-suited agent.', category: 'general', icon: 'Share2', enabled: true },
  { key: 'memory', name: 'Memory Store', description: 'Persist and retrieve long-term memory.', category: 'general', icon: 'Database', enabled: true },
  { key: 'telemetry', name: 'Telemetry', description: 'Collect and visualize live system metrics.', category: 'general', icon: 'Activity', enabled: true },
  { key: 'self-heal', name: 'Self-Heal', description: 'Detect anomalies and auto-remediate.', category: 'security', icon: 'HeartPulse', enabled: true },
  { key: 'image-gen', name: 'Image Generation', description: 'Create images from text prompts.', category: 'media', icon: 'Image', enabled: true },
  { key: 'tts', name: 'Text to Speech', description: 'Synthesize natural speech from text.', category: 'media', icon: 'Volume2', enabled: false },
];

export interface CronSeed {
  key: string;
  name: string;
  schedule: string;
  description: string;
  enabled: boolean;
}

export const CRON_ROSTER: CronSeed[] = [
  // ── Core Operations ──
  { key: 'webdev-review', name: 'Web Dev Review', schedule: '*/15 * * * *', description: 'Autonomous QA + feature improvement loop (agent-browser driven).', enabled: true },
  { key: 'health-check', name: 'Fleet Health Check', schedule: '*/5 * * * *', description: 'Heartbeat all agents and rotate stale status to offline.', enabled: true },
  { key: 'telemetry-prune', name: 'Telemetry Prune', schedule: '0 2 * * *', description: 'Trim telemetry older than 7 days.', enabled: true },
  { key: 'backup', name: 'Nightly Backup', schedule: '0 3 * * *', description: 'Snapshot the database and artifacts to /backups/.', enabled: true },

  // ── Memory & Intelligence ──
  { key: 'memory-consolidation', name: 'Memory Consolidation', schedule: '0 */3 * * *', description: 'Compress and deduplicate episodic memory every 3h.', enabled: true },
  { key: 'memory-graph-rebuild', name: 'Memory Graph Rebuild', schedule: '0 */6 * * *', description: 'Rebuild the semantic memory graph from MemoryItem rows.', enabled: true },
  { key: 'blackbox-flush', name: 'Blackbox Flush', schedule: '*/10 * * * *', description: 'Flush in-memory blackbox audit buffer to AgentLog table.', enabled: true },
  { key: 'dag-checkpoint-cleanup', name: 'DAG Checkpoint Cleanup', schedule: '0 4 * * *', description: 'Remove completed DAG saga checkpoints older than 24h.', enabled: true },

  // ── Agent Lifecycle ──
  { key: 'spawned-cleanup', name: 'Spawned Agent Cleanup', schedule: '0 3 * * *', description: 'Auto-delete spawned agents inactive for 30 days (logs preserved for respawn).', enabled: true },
  { key: 'agent-load-balance', name: 'Agent Load Balancer', schedule: '*/10 * * * *', description: 'Check agent loads; auto-spawn sub-agent if load > 80%.', enabled: false },
  { key: 'agent-roster-sync', name: 'Agent Roster Sync', schedule: '0 5 * * *', description: 'Sync DB agents with AGENT_ROSTER config (upsert new, update stale).', enabled: true },

  // ── Learning & Skills ──
  { key: 'skill-proficiency-decay', name: 'Skill Proficiency Decay', schedule: '0 0 * * *', description: 'Decay unused skill proficiency by 1% per day (lastUsed > 7 days).', enabled: true },
  { key: 'learning-review', name: 'Learning Review', schedule: '0 8 * * *', description: 'Review learning records and surface mastered skills for promotion.', enabled: false },

  // ── Earning & Revenue ──
  { key: 'earning-methods-research', name: 'Earning Methods Research', schedule: '0 9 * * *', description: 'Research and discover new earning methods daily.', enabled: true },
  { key: 'revenue-tracking', name: 'Revenue Tracking', schedule: '0 */4 * * *', description: 'Aggregate revenue from earning methods + update totals.', enabled: true },
  { key: 'credential-health-check', name: 'Credential Health Check', schedule: '0 6 * * *', description: 'Check platform credentials for expiring/suspended status.', enabled: false },

  // ── Research & Outreach ──
  { key: 'daily-research', name: 'Daily Research', schedule: '0 7 * * *', description: 'Run the daily research engine on trending topics.', enabled: true },
  { key: 'outreach-followup', name: 'Outreach Follow-up', schedule: '0 10 * * 1-5', description: 'Send follow-up emails for pending outreach (weekdays only).', enabled: false },
  { key: 'social-media-post', name: 'Social Media Auto-Post', schedule: '0 9,13,17 * * *', description: 'Auto-post to social media 3x/day via marketing agents.', enabled: false },

  // ── System Health ──
  { key: 'self-improve', name: 'Self-Improve', schedule: '0 */6 * * *', description: 'Analyze logs and propose optimization patches.', enabled: false },
  { key: 'rollback-snapshot-cleanup', name: 'Rollback Snapshot Cleanup', schedule: '0 4 * * 0', description: 'Remove rollback snapshots older than 7 days (weekly).', enabled: true },
  { key: 'upload-cleanup', name: 'Upload Cleanup', schedule: '0 4 * * *', description: 'Remove orphaned uploaded files not referenced by Artifact rows.', enabled: false },
  { key: 'notification-cleanup', name: 'Notification Cleanup', schedule: '0 */12 * * *', description: 'Mark old read notifications as archived (older than 7 days).', enabled: true },
  { key: 'log-rotation', name: 'Log Rotation', schedule: '0 5 * * *', description: 'Archive AgentLog entries older than 30 days to /backups/logs/.', enabled: true },

  // ── Analytics & Reporting ──
  { key: 'daily-report', name: 'Daily Report', schedule: '0 8 * * *', description: 'Generate the daily fleet report and store to memory.', enabled: true },
  { key: 'weekly-summary', name: 'Weekly Summary', schedule: '0 9 * * 1', description: 'Generate weekly summary report every Monday 9 AM.', enabled: true },
  { key: 'proactive-insights', name: 'Proactive Insights', schedule: '0 */4 * * *', description: 'Generate proactive LLM-driven insights from fleet data.', enabled: true },

  // ── Model Provider Sync (Task ID 12 / PARALLEL-D) ──
  { key: 'model-sync', name: 'Model Provider Sync', schedule: '0 */6 * * *', description: 'Sync models from providers + detect local + purge broken.', enabled: true },
];

export const STATUS_COLORS: Record<AgentStatus, string> = {
  idle: JARVIS.colors.cyan,
  thinking: JARVIS.colors.violet,
  working: JARVIS.colors.green,
  error: JARVIS.colors.red,
  offline: JARVIS.colors.textMute,
};

export const PRIORITY_COLORS: Record<string, string> = {
  low: JARVIS.colors.cyan,
  medium: JARVIS.colors.violet,
  high: JARVIS.colors.amber,
  critical: JARVIS.colors.red,
};

export const LEVEL_COLORS: Record<string, string> = {
  info: JARVIS.colors.cyan,
  success: JARVIS.colors.green,
  warn: JARVIS.colors.amber,
  error: JARVIS.colors.red,
  debug: JARVIS.colors.textMute,
};

export function timeAgo(date: Date | string | number): string {
  const d = typeof date === 'object' ? date : new Date(date);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const dd = Math.floor(h / 24);
  return `${dd}d ago`;
}

export function fmtTime(date: Date | string | number): string {
  const d = typeof date === 'object' ? date : new Date(date);
  return d.toLocaleTimeString('en-US', { hour12: false });
}
