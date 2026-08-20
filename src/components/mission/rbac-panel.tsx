"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Users,
  Crown,
  Shield,
  Eye,
  Loader2,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ─── Types ───────────────────────────────────────────────────────────
type Role = "owner" | "admin" | "viewer";

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  twoFactorEnabled: boolean;
  emailVerified: string | null;
  createdAt: string;
}

interface SessionUser {
  id?: string;
  email?: string;
  name?: string | null;
  role?: Role;
}

// ─── Helpers ─────────────────────────────────────────────────────────
function timeAgo(date: Date | string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function initials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/).slice(0, 2);
    if (parts.length) {
      return parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
    }
  }
  return email.slice(0, 2).toUpperCase();
}

function roleBadgeClass(role: Role): string {
  switch (role) {
    case "owner":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    case "admin":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "viewer":
    default:
      return "border-zinc-500/30 bg-zinc-500/10 text-zinc-300";
  }
}

const ROLE_ICON: Record<Role, typeof Crown> = {
  owner: Crown,
  admin: Shield,
  viewer: Eye,
};

async function jsonOrThrow(res: Response): Promise<any> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `request failed (${res.status})`);
  }
  return data;
}

// ─── RbacPanel ───────────────────────────────────────────────────────
export function RbacPanel() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<Record<string, Role>>({});

  // ─── Fetch current session + users ───
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [sessionRes, usersRes] = await Promise.all([
        fetch("/api/auth/session"),
        fetch("/api/users"),
      ]);

      if (sessionRes.ok) {
        const sessionData = (await sessionRes.json().catch(() => null)) as
          | { user?: SessionUser }
          | null;
        if (sessionData?.user?.id) {
          setCurrentUserId(sessionData.user.id);
        }
      }

      const data = await jsonOrThrow(usersRes);
      const rows: UserRow[] = Array.isArray(data?.users) ? data.users : [];
      setUsers(rows);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "failed to load users");
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ─── Change role ───
  const handleRoleChange = useCallback(
    async (userId: string, nextRole: Role) => {
      const original = users.find((u) => u.id === userId)?.role;
      if (!original || original === nextRole) return;

      // Optimistic update
      setPendingRole((p) => ({ ...p, [userId]: nextRole }));
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: nextRole } : u)),
      );

      try {
        await jsonOrThrow(
          await fetch(`/api/users/${userId}/role`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: nextRole }),
          }),
        );
        toast.success("Role updated");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "failed to update role");
        // Revert
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, role: original } : u)),
        );
      } finally {
        setPendingRole((p) => {
          const next = { ...p };
          delete next[userId];
          return next;
        });
      }
    },
    [users],
  );

  // ─── Summary bar ───
  const summary = useMemo(() => {
    const owners = users.filter((u) => u.role === "owner").length;
    const admins = users.filter((u) => u.role === "admin").length;
    const viewers = users.filter((u) => u.role === "viewer").length;
    return { total: users.length, owners, admins, viewers };
  }, [users]);

  // ─── Render ───
  return (
    <Card className="aria-feature-card">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-300">
              <Users className="size-5" />
            </div>
            <div>
              <CardTitle className="text-base">User &amp; Role Management</CardTitle>
              <CardDescription className="text-xs">
                Assign roles to control what each member can do.
              </CardDescription>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={loading}
            className="border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10"
          >
            {loading ? (
              <Loader2 className="mr-2 size-3.5 animate-spin" />
            ) : null}
            Refresh
          </Button>
        </div>

        {/* Summary bar */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="border-white/10 bg-white/[0.03]">
            <Users className="mr-1 size-3" />
            {summary.total} users
          </Badge>
          <Badge variant="outline" className="border-amber-500/30 bg-amber-500/5 text-amber-300">
            <Crown className="mr-1 size-3" />
            {summary.owners} owners
          </Badge>
          <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/5 text-emerald-300">
            <Shield className="mr-1 size-3" />
            {summary.admins} admins
          </Badge>
          <Badge variant="outline" className="border-zinc-500/30 bg-zinc-500/5 text-zinc-300">
            <Eye className="mr-1 size-3" />
            {summary.viewers} viewers
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        {loading && users.length === 0 ? (
          <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading users…
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-sm text-muted-foreground">
            <Users className="size-6 text-emerald-300/50" />
            No users yet.
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto rounded-lg border border-white/5">
            <Table>
              <TableHeader>
                <TableRow className="border-white/5 hover:bg-transparent">
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
                    User
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
                    Role
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
                    2FA
                  </TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">
                    Joined
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => {
                  const isSelf = currentUserId !== null && u.id === currentUserId;
                  const RoleIcon = ROLE_ICON[u.role] ?? Eye;
                  return (
                    <TableRow
                      key={u.id}
                      className="border-white/5"
                    >
                      {/* User */}
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="size-8 border border-white/10">
                            <AvatarFallback className="bg-emerald-500/10 text-xs font-medium text-emerald-300">
                              {initials(u.name, u.email)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-foreground">
                              {u.name || u.email}
                              {isSelf && (
                                <span className="ml-2 text-[10px] uppercase tracking-wider text-emerald-300/70">
                                  you
                                </span>
                              )}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {u.email}
                            </div>
                          </div>
                        </div>
                      </TableCell>

                      {/* Role dropdown */}
                      <TableCell>
                        <TooltipProvider delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              {/* span wrapper needed because Select trigger swallows pointer events */}
                              <span className="inline-flex">
                                <Select
                                  value={u.role}
                                  onValueChange={(v) => void handleRoleChange(u.id, v as Role)}
                                  disabled={isSelf || Boolean(pendingRole[u.id])}
                                >
                                  <SelectTrigger
                                    className="h-8 w-32 gap-1 border-white/10 bg-white/[0.03] text-xs data-[placeholder]:text-muted-foreground"
                                  >
                                    <RoleIcon className="size-3.5 opacity-70" />
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="owner" className="text-xs">
                                      <span className="flex items-center gap-2">
                                        <Crown className="size-3.5 text-amber-300" />
                                        Owner
                                      </span>
                                    </SelectItem>
                                    <SelectItem value="admin" className="text-xs">
                                      <span className="flex items-center gap-2">
                                        <Shield className="size-3.5 text-emerald-300" />
                                        Admin
                                      </span>
                                    </SelectItem>
                                    <SelectItem value="viewer" className="text-xs">
                                      <span className="flex items-center gap-2">
                                        <Eye className="size-3.5 text-zinc-300" />
                                        Viewer
                                      </span>
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                              </span>
                            </TooltipTrigger>
                            {isSelf && (
                              <TooltipContent className="border-amber-500/30 bg-amber-500/10 text-amber-200">
                                Cannot demote yourself
                              </TooltipContent>
                            )}
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>

                      {/* 2FA */}
                      <TableCell>
                        {u.twoFactorEnabled ? (
                          <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                            <Shield className="mr-1 size-3" />
                            On
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-zinc-500/30 bg-zinc-500/5 text-zinc-400">
                            Off
                          </Badge>
                        )}
                      </TableCell>

                      {/* Joined */}
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {timeAgo(u.createdAt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default RbacPanel;
