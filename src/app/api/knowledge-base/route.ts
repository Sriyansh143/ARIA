import { NextRequest, NextResponse } from "next/server";
import {
  listArticles,
  getArticle,
  searchArticles,
  listCategories,
  type KbCategory,
} from "@/lib/knowledge-base";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const VALID_CATEGORIES: KbCategory[] = [
  "Getting Started",
  "Agents",
  "Operations",
  "Advanced",
  "Security",
];

/**
 * GET /api/knowledge-base
 *
 * Query params (all optional, mutually combinable):
 *   - id=<articleId>     — return a single full article (with content)
 *   - category=<KbCategory>  — filter the list by category
 *   - q=<query>          — text search across title/tags/content
 *
 * Without query params, returns the summarized list of all articles.
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const category = url.searchParams.get("category");
    const q = url.searchParams.get("q");

    // 1. Single-article lookup by id (wins over other params).
    if (id) {
      const article = getArticle(id.trim());
      if (!article) {
        return NextResponse.json(
          { error: `article "${id}" not found` },
          { status: 404 },
        );
      }
      return NextResponse.json({ article });
    }

    // 2. Free-text search.
    if (q && q.trim()) {
      const results = searchArticles(q);
      return NextResponse.json({
        results,
        count: results.length,
        query: q,
      });
    }

    // 3. Category filter (or full list).
    let normalizedCat: KbCategory | undefined;
    if (category) {
      const found = VALID_CATEGORIES.find((c) => c.toLowerCase() === category.toLowerCase());
      if (!found) {
        return NextResponse.json(
          {
            error: `invalid category "${category}"`,
            validCategories: VALID_CATEGORIES,
          },
          { status: 400 },
        );
      }
      normalizedCat = found;
    }

    const articles = listArticles(normalizedCat);
    return NextResponse.json({
      articles,
      count: articles.length,
      category: normalizedCat ?? "all",
      categories: listCategories(),
    });
  } catch (err) {
    logger.error("api.knowledge-base.get.error", { error: String(err) });
    return NextResponse.json(
      { error: "failed to load knowledge base", detail: String(err) },
      { status: 500 },
    );
  }
}
