"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  BookOpen,
  Search,
  RefreshCw,
  Loader2,
  FileText,
  Tag,
  X,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { FullScreenPanel } from "./full-screen-panel";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

// ─── Types ───────────────────────────────────────────────────────────
type Category = "all" | "Getting Started" | "Agents" | "Operations" | "Advanced" | "Security";

interface KbArticleSummary {
  id: string;
  title: string;
  category: string;
  tags: string[];
  summary: string;
  lastUpdated: string;
}

interface KbArticle {
  id: string;
  title: string;
  category: string;
  content: string;
  tags: string[];
  lastUpdated: string;
}

interface KbSearchResult {
  id: string;
  title: string;
  category: string;
  relevance: number;
}

interface ListResponse {
  articles: KbArticleSummary[];
  count: number;
  category: string;
  categories?: { name: string; count: number }[];
}

interface SearchResponse {
  results: KbSearchResult[];
  count: number;
  query: string;
}

interface ArticleResponse {
  article: KbArticle;
}

// ─── Style maps ──────────────────────────────────────────────────────
const CATEGORY_TONE: Record<string, string> = {
  "Getting Started": "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  Agents: "text-violet-300 border-violet-500/30 bg-violet-500/10",
  Operations: "text-cyan-300 border-cyan-500/30 bg-cyan-500/10",
  Advanced: "text-amber-300 border-amber-500/30 bg-amber-500/10",
  Security: "text-rose-300 border-rose-500/30 bg-rose-500/10",
};

const CATEGORY_TABS: { value: Category; label: string; icon: LucideIcon }[] = [
  { value: "all", label: "All", icon: BookOpen },
  { value: "Getting Started", label: "Start", icon: FileText },
  { value: "Agents", label: "Agents", icon: FileText },
  { value: "Operations", label: "Ops", icon: FileText },
  { value: "Advanced", label: "Advanced", icon: FileText },
  { value: "Security", label: "Security", icon: FileText },
];

// ─── Component ───────────────────────────────────────────────────────
export function KnowledgeBasePanel() {
  const [articles, setArticles] = useState<KbArticleSummary[]>([]);
  const [categories, setCategories] = useState<{ name: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<Category>("all");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<KbSearchResult[] | null>(null);
  const [openArticle, setOpenArticle] = useState<KbArticle | null>(null);
  const [loadingArticle, setLoadingArticle] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchList = useCallback(async (cat: Category) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (cat !== "all") params.set("category", cat);
      const url = `/api/knowledge-base${params.toString() ? `?${params.toString()}` : ""}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json().catch(() => ({}))) as ListResponse;
      setArticles(Array.isArray(data.articles) ? data.articles : []);
      if (data.categories) setCategories(data.categories);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load articles");
    } finally {
      setLoading(false);
    }
  }, []);

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setSearchResults(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const url = `/api/knowledge-base?q=${encodeURIComponent(trimmed)}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json().catch(() => ({}))) as SearchResponse;
      setSearchResults(Array.isArray(data.results) ? data.results : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load.
  useEffect(() => {
    void fetchList("all");
  }, [fetchList]);

  // Re-fetch when category changes (only if not searching).
  useEffect(() => {
    if (!query.trim()) {
      void fetchList(activeCategory);
    }
  }, [activeCategory, query, fetchList]);

  // Debounced search.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults(null);
      return;
    }
    debounceRef.current = setTimeout(() => {
      void runSearch(trimmed);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  const openArticleById = useCallback(async (id: string) => {
    setLoadingArticle(true);
    try {
      const res = await fetch(`/api/knowledge-base?id=${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json().catch(() => ({}))) as ArticleResponse;
      if (data.article) {
        setOpenArticle(data.article);
      } else {
        toast.error("Article not found");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load article";
      toast.error("Failed to load article", { description: msg });
    } finally {
      setLoadingArticle(false);
    }
  }, []);

  const countForCategory = useCallback(
    (cat: Category): number => {
      if (cat === "all") return articles.length;
      const found = categories.find((c) => c.name === cat);
      return found?.count ?? articles.filter((a) => a.category === cat).length;
    },
    [articles, categories],
  );

  // When in search mode, build a virtual list of matching article summaries
  // (we have to look them up by id from `articles` since search returns only
  // id+title+relevance).
  const visibleArticles = useMemo<KbArticleSummary[]>(() => {
    if (searchResults) {
      // Map results back to summaries (fall back to a synthesized summary if
      // the article wasn't in the current category list).
      return searchResults.map((r) => {
        const existing = articles.find((a) => a.id === r.id);
        if (existing) return { ...existing, summary: existing.summary };
        return {
          id: r.id,
          title: r.title,
          category: r.category,
          tags: [],
          summary: `Relevance: ${Math.round(r.relevance * 100)}%`,
          lastUpdated: "",
        };
      });
    }
    return articles;
  }, [searchResults, articles]);

  return (
    <FullScreenPanel
      title="Knowledge Base"
      icon={<BookOpen className="h-3.5 w-3.5 text-cyan-300" />}
      actions={
        <button
          type="button"
          onClick={() => {
            setQuery("");
            setSearchResults(null);
            void fetchList(activeCategory);
          }}
          aria-label="Refresh articles"
          title="Refresh articles"
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      }
    >
      <div className="grid grid-cols-1 gap-3 p-3 lg:grid-cols-[200px_1fr]">
        {/* Sidebar: category filter */}
        <aside className="mc-surface flex flex-col gap-1 rounded-lg border border-border/60 bg-surface-2/30 p-2 lg:max-h-[70vh] lg:overflow-y-auto">
          <div className="px-2 py-1 font-mono text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            Categories
          </div>
          {CATEGORY_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeCategory === tab.value && !searchResults;
            const count = countForCategory(tab.value);
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => {
                  setActiveCategory(tab.value);
                  setQuery("");
                  setSearchResults(null);
                }}
                className={`group flex items-center gap-2 rounded-md border px-2 py-1.5 text-left font-mono text-[10px] transition-colors ${
                  isActive
                    ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200"
                    : "border-transparent text-muted-foreground hover:border-border/40 hover:bg-surface-2/60 hover:text-foreground"
                }`}
              >
                <Icon className="h-3 w-3 shrink-0" />
                <span className="flex-1 truncate">{tab.label}</span>
                <span
                  className={`rounded px-1 text-[9px] font-bold tabular-nums ${
                    isActive ? "bg-cyan-500/20 text-cyan-200" : "bg-border/30 text-muted-foreground/60"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </aside>

        {/* Main: search + articles */}
        <div className="flex min-w-0 flex-col gap-2">
          {/* Search input */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search articles by title, tag, or content…"
              className="h-8 bg-background/40 pl-8 pr-8 font-mono text-[11px]"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setSearchResults(null);
                }}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground/60 hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="rounded border border-rose-500/30 bg-rose-500/5 px-2 py-1.5 font-mono text-[10px] text-rose-300">
              load failed: {error}
            </div>
          )}

          {/* Article list / search results */}
          {loading ? (
            <div className="flex items-center justify-center gap-1.5 py-8 font-mono text-[10px] text-muted-foreground/60">
              <Loader2 className="h-3 w-3 animate-spin" />
              {searchResults !== null ? "searching…" : "loading articles…"}
            </div>
          ) : visibleArticles.length === 0 ? (
            <EmptyState
              icon={Search}
              label={searchResults ? `No articles match "${query}"` : "No articles in this category"}
              hint={searchResults ? "Try a different keyword or clear the search." : undefined}
            />
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              <AnimatePresence mode="popLayout">
                {visibleArticles.map((article) => (
                  <ArticleCard
                    key={article.id}
                    article={article}
                    relevance={
                      searchResults?.find((r) => r.id === article.id)?.relevance ?? null
                    }
                    onOpen={() => void openArticleById(article.id)}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* Article dialog */}
      <Dialog open={!!openArticle} onOpenChange={(o) => !o && setOpenArticle(null)}>
        <DialogContent
          showCloseButton
          className="left-[50%] top-[50%] grid max-h-[85vh] w-[90vw] max-w-[800px] translate-x-[-50%] translate-y-[-50%] gap-0 overflow-hidden rounded-xl border-border/60 p-0 sm:max-w-[800px]"
        >
          <DialogHeader className="border-b border-border/60 p-4">
            <div className="flex flex-wrap items-center gap-2">
              {openArticle && (
                <Badge
                  variant="outline"
                  className={`shrink-0 px-1.5 py-0 font-mono text-[9px] font-bold uppercase ${
                    CATEGORY_TONE[openArticle.category] ?? "text-muted-foreground border-border/60 bg-surface-2/40"
                  }`}
                >
                  {openArticle.category}
                </Badge>
              )}
              <DialogTitle className="min-w-0 flex-1 truncate text-[14px] font-semibold text-foreground">
                {openArticle?.title ?? "Loading…"}
              </DialogTitle>
            </div>
            <DialogDescription className="sr-only">
              Article body for {openArticle?.title ?? ""}
            </DialogDescription>
          </DialogHeader>

          <div className="mc-scroll max-h-[calc(85vh-100px)] overflow-y-auto p-4">
            {loadingArticle ? (
              <div className="flex items-center justify-center gap-1.5 py-8 font-mono text-[10px] text-muted-foreground/60">
                <Loader2 className="h-3 w-3 animate-spin" />
                loading article…
              </div>
            ) : openArticle ? (
              <ArticleBody article={openArticle} />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </FullScreenPanel>
  );
}

// ─── Article Card ───────────────────────────────────────────────────
function ArticleCard({
  article,
  relevance,
  onOpen,
}: {
  article: KbArticleSummary;
  relevance: number | null;
  onOpen: () => void;
}) {
  const categoryTone =
    CATEGORY_TONE[article.category] ?? "text-muted-foreground border-border/60 bg-surface-2/40";
  return (
    <motion.button
      type="button"
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      onClick={onOpen}
      className="mc-surface group flex flex-col gap-2 rounded-md border border-border/60 bg-background/40 p-3 text-left transition-colors hover:border-cyan-500/40 hover:bg-surface-2/40"
    >
      <div className="flex items-center gap-2">
        <Badge
          variant="outline"
          className={`shrink-0 px-1.5 py-0 font-mono text-[9px] font-bold uppercase ${categoryTone}`}
        >
          {article.category}
        </Badge>
        {relevance !== null && (
          <span className="ml-auto font-mono text-[9px] text-emerald-300/80">
            {Math.round(relevance * 100)}%
          </span>
        )}
      </div>
      <div className="line-clamp-2 text-[12px] font-semibold text-foreground">
        {article.title}
      </div>
      <div className="line-clamp-2 text-[10px] leading-relaxed text-muted-foreground/80">
        {article.summary}
      </div>
      {article.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {article.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-0.5 rounded border border-border/40 bg-surface-2/40 px-1 font-mono text-[8px] text-muted-foreground/60"
            >
              <Tag className="h-2 w-2" />
              {tag}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1 border-t border-border/40 pt-1.5 font-mono text-[9px] text-muted-foreground/60">
        <ChevronRight className="h-2.5 w-2.5 transition-transform group-hover:translate-x-0.5" />
        Read article
        {article.lastUpdated && (
          <span className="ml-auto">updated {article.lastUpdated}</span>
        )}
      </div>
    </motion.button>
  );
}

// ─── Article Body (rendered as paragraphs split by \n\n) ────────────
function ArticleBody({ article }: { article: KbArticle }) {
  const paragraphs = article.content.split(/\n\n+/).filter(Boolean);
  return (
    <article className="space-y-3">
      {paragraphs.map((para, idx) => (
        <p
          key={idx}
          className="text-[11px] leading-relaxed text-foreground/90"
        >
          {para}
        </p>
      ))}
      {article.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-border/40 pt-3">
          {article.tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded border border-border/40 bg-surface-2/40 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground/70"
            >
              <Tag className="h-2.5 w-2.5" />
              {tag}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

// ─── Empty State ────────────────────────────────────────────────────
function EmptyState({
  icon: Icon,
  label,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-center">
      <Icon className="h-6 w-6 text-muted-foreground/40" />
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      {hint && (
        <div className="max-w-sm px-4 font-mono text-[9px] text-muted-foreground/60">
          {hint}
        </div>
      )}
    </div>
  );
}

export default KnowledgeBasePanel;
