"use client";

/**
 * NotificationCenter — bell icon with unread count + dropdown list.
 *
 * Fetches from /api/notifications (NotificationLog model).
 * Shows failed notifications (unread) with a red badge count.
 * Dropdown lists recent notifications with channel + status icons.
 */

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell,
  CheckCircle2,
  AlertCircle,
  Mail,
  Send,
  Clock,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Notification {
  id: string;
  channel: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  provider: string | null;
  error: string | null;
  createdAt: string;
}

export function NotificationCenter() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications?limit=20");
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on mount + every 60s
  useEffect(() => {
    void fetchNotifications();
    const interval = setInterval(fetchNotifications, 60_000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Fetch when popover opens
  useEffect(() => {
    if (open) void fetchNotifications();
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </motion.span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 p-0"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
      >
        <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Bell className="h-4 w-4 text-emerald-400" />
            Notifications
          </span>
          {unreadCount > 0 && (
            <Badge variant="outline" className="border-rose-500/30 bg-rose-500/10 text-[10px] text-rose-300">
              {unreadCount} unread
            </Badge>
          )}
        </div>
        <ScrollArea className="h-[300px]">
          {loading && notifications.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
              <Bell className="h-8 w-8 opacity-30" />
              <p className="text-xs">No notifications yet</p>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              <AnimatePresence>
                {notifications.map((n) => {
                  const isFailed = n.status === "failed";
                  const Icon = isFailed ? AlertCircle : CheckCircle2;
                  const iconColor = isFailed ? "text-rose-400" : "text-emerald-400";
                  const ChannelIcon = n.channel === "email" ? Mail : Send;

                  return (
                    <motion.div
                      key={n.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      className="flex gap-3 p-3 transition-colors hover:bg-muted/20"
                    >
                      <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${iconColor}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <ChannelIcon className="h-3 w-3 text-muted-foreground" />
                          <p className="text-xs font-medium truncate">{n.subject}</p>
                        </div>
                        <p className="text-[10px] text-muted-foreground line-clamp-2">
                          {n.error || n.body.slice(0, 100)}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground">
                            <Clock className="h-2.5 w-2.5" />
                            {timeAgo(n.createdAt)}
                          </span>
                          <span className="text-[9px] text-muted-foreground">·</span>
                          <span className="text-[9px] text-muted-foreground">{n.provider || n.channel}</span>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </ScrollArea>
        {notifications.length > 0 && (
          <div className="border-t border-border/40 p-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs"
              onClick={() => void fetchNotifications()}
            >
              <Bell className="h-3 w-3 mr-1" /> Refresh
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
