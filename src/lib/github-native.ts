// =====================================================================
// github-native.ts — GitHub API client (repos, issues, PRs) via fetch.
// =====================================================================
// No npm dependency. Uses the public GitHub REST API.
//
// Env vars:
//   GITHUB_TOKEN   (required for write operations; recommended for reads)
//
// Public API:
//   createIssue(repo, title, body)
//   listIssues(repo, opts?)
//   getIssue(repo, number)
//   createPullRequest(repo, opts)
//   listPullRequests(repo, opts?)
//   listRepos(username?)
// =====================================================================

const GITHUB_API = 'https://api.github.com';
const UA = 'JARVIS-Code-Project';

function ghHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': UA,
    'Content-Type': 'application/json',
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  html_url: string;
  user: { login: string } | null;
  created_at: string;
  updated_at: string;
  labels: { name: string }[];
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  html_url: string;
  user: { login: string } | null;
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  created_at: string;
  updated_at: string;
  merged_at: string | null;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  private: boolean;
  default_branch: string;
  stargazers_count: number;
  forks_count: number;
  updated_at: string;
}

// ─── Create an issue ─────────────────────────────────────────────────
export async function createIssue(
  repo: string,
  title: string,
  body: string,
): Promise<{ success: boolean; url?: string; number?: number; error?: string }> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { success: false, error: 'GITHUB_TOKEN not set' };
  try {
    const res = await fetch(`${GITHUB_API}/repos/${repo}/issues`, {
      method: 'POST',
      headers: ghHeaders(),
      body: JSON.stringify({ title, body }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { success: false, error: `GitHub API ${res.status}: ${txt.slice(0, 200)}` };
    }
    const d = (await res.json()) as { html_url: string; number: number };
    return { success: true, url: d.html_url, number: d.number };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ─── List issues on a repo ───────────────────────────────────────────
export async function listIssues(
  repo: string,
  opts?: { state?: 'open' | 'closed' | 'all'; perPage?: number },
): Promise<{ success: boolean; issues?: GitHubIssue[]; error?: string }> {
  try {
    const state = opts?.state ?? 'open';
    const perPage = Math.min(opts?.perPage ?? 30, 100);
    const url = `${GITHUB_API}/repos/${repo}/issues?state=${state}&per_page=${perPage}`;
    const res = await fetch(url, { headers: ghHeaders(), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { success: false, error: `GitHub API ${res.status}` };
    const data = (await res.json()) as any[];
    // Filter out PRs (GitHub returns them in the issues endpoint)
    const issues = data
      .filter((i) => !i.pull_request)
      .map((i) => ({
        number: i.number,
        title: i.title,
        body: i.body,
        state: i.state,
        html_url: i.html_url,
        user: i.user ? { login: i.user.login } : null,
        created_at: i.created_at,
        updated_at: i.updated_at,
        labels: (i.labels || []).map((l: any) => ({ name: l.name })),
      }));
    return { success: true, issues };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ─── Get a single issue ──────────────────────────────────────────────
export async function getIssue(
  repo: string,
  number: number,
): Promise<{ success: boolean; issue?: GitHubIssue; error?: string }> {
  try {
    const res = await fetch(`${GITHUB_API}/repos/${repo}/issues/${number}`, {
      headers: ghHeaders(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { success: false, error: `GitHub API ${res.status}` };
    const i = (await res.json()) as any;
    return {
      success: true,
      issue: {
        number: i.number,
        title: i.title,
        body: i.body,
        state: i.state,
        html_url: i.html_url,
        user: i.user ? { login: i.user.login } : null,
        created_at: i.created_at,
        updated_at: i.updated_at,
        labels: (i.labels || []).map((l: any) => ({ name: l.name })),
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ─── Create a pull request ───────────────────────────────────────────
export async function createPullRequest(
  repo: string,
  opts: { title: string; head: string; base: string; body?: string },
): Promise<{ success: boolean; url?: string; number?: number; error?: string }> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { success: false, error: 'GITHUB_TOKEN not set' };
  try {
    const res = await fetch(`${GITHUB_API}/repos/${repo}/pulls`, {
      method: 'POST',
      headers: ghHeaders(),
      body: JSON.stringify({
        title: opts.title,
        head: opts.head,
        base: opts.base,
        body: opts.body ?? '',
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { success: false, error: `GitHub API ${res.status}: ${txt.slice(0, 200)}` };
    }
    const d = (await res.json()) as { html_url: string; number: number };
    return { success: true, url: d.html_url, number: d.number };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ─── List pull requests on a repo ────────────────────────────────────
export async function listPullRequests(
  repo: string,
  opts?: { state?: 'open' | 'closed' | 'all'; perPage?: number },
): Promise<{ success: boolean; prs?: GitHubPullRequest[]; error?: string }> {
  try {
    const state = opts?.state ?? 'open';
    const perPage = Math.min(opts?.perPage ?? 30, 100);
    const url = `${GITHUB_API}/repos/${repo}/pulls?state=${state}&per_page=${perPage}`;
    const res = await fetch(url, { headers: ghHeaders(), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { success: false, error: `GitHub API ${res.status}` };
    const data = (await res.json()) as any[];
    const prs = data.map((p) => ({
      number: p.number,
      title: p.title,
      body: p.body,
      state: p.state,
      html_url: p.html_url,
      user: p.user ? { login: p.user.login } : null,
      head: { ref: p.head.ref, sha: p.head.sha },
      base: { ref: p.base.ref, sha: p.base.sha },
      created_at: p.created_at,
      updated_at: p.updated_at,
      merged_at: p.merged_at,
    }));
    return { success: true, prs };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ─── List repositories for the authenticated user (or a target user) ──
export async function listRepos(
  username?: string,
  opts?: { perPage?: number },
): Promise<{ success: boolean; repos?: GitHubRepo[]; error?: string }> {
  try {
    const perPage = Math.min(opts?.perPage ?? 30, 100);
    const url = username
      ? `${GITHUB_API}/users/${username}/repos?per_page=${perPage}`
      : `${GITHUB_API}/user/repos?per_page=${perPage}`;
    const res = await fetch(url, { headers: ghHeaders(), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { success: false, error: `GitHub API ${res.status}` };
    const data = (await res.json()) as any[];
    const repos = data.map((r) => ({
      id: r.id,
      name: r.name,
      full_name: r.full_name,
      html_url: r.html_url,
      description: r.description,
      private: r.private,
      default_branch: r.default_branch,
      stargazers_count: r.stargazers_count,
      forks_count: r.forks_count,
      updated_at: r.updated_at,
    }));
    return { success: true, repos };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
