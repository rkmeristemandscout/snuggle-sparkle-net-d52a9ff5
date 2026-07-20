import { Bell, CheckCheck, MailOpen, MailPlus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useNotifications } from "@/hooks/use-notifications";
import { useSession } from "@/hooks/use-session";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

export function NotificationsMenu() {
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useSession();
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const invalidate = () => qc.invalidateQueries({ queryKey: ["notifications", user?.id] });

  const markUnread = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("notifications").update({ read_at: null }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = filter === "unread" ? notifications.filter((n) => !n.read_at) : notifications;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <p className="font-semibold">Notifications</p>
            <p className="text-xs text-muted-foreground">
              {unreadCount ? `${unreadCount} unread` : "You're all caught up"}
            </p>
          </div>
          {unreadCount > 0 && (
            <Button size="sm" variant="ghost" onClick={() => markAllRead()}>
              <CheckCheck className="mr-1 h-4 w-4" /> Mark all read
            </Button>
          )}
        </div>
        <div className="flex gap-1 border-b px-2 py-2 text-xs">
          <Button
            size="sm"
            variant={filter === "all" ? "secondary" : "ghost"}
            onClick={() => setFilter("all")}
          >
            All
          </Button>
          <Button
            size="sm"
            variant={filter === "unread" ? "secondary" : "ghost"}
            onClick={() => setFilter("unread")}
          >
            Unread {unreadCount > 0 && <Badge variant="outline" className="ml-1">{unreadCount}</Badge>}
          </Button>
        </div>
        <ScrollArea className="max-h-96">
          {filtered.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {filter === "unread" ? "No unread notifications." : "No notifications yet."}
            </p>
          ) : (
            <ul className="divide-y">
              {filtered.map((n) => (
                <li key={n.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => {
                      if (!n.read_at) markRead(n.id);
                      if (n.link) navigate({ to: n.link });
                    }}
                    className="flex w-full items-start gap-3 px-4 py-3 pr-14 text-left hover:bg-muted/60"
                  >
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        n.read_at ? "bg-muted-foreground/40" : "bg-primary"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-sm font-medium">{n.title}</p>
                        <Badge variant="outline" className="shrink-0 text-[10px]">
                          {n.type.split(".")[0]}
                        </Badge>
                      </div>
                      {n.message && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {n.message}
                        </p>
                      )}
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                      </p>
                    </div>
                  </button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="absolute right-2 top-2 h-7 w-7 opacity-0 transition group-hover:opacity-100"
                    title={n.read_at ? "Mark unread" : "Mark read"}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (n.read_at) markUnread.mutate(n.id);
                      else markRead(n.id);
                    }}
                  >
                    {n.read_at ? <MailPlus className="h-4 w-4" /> : <MailOpen className="h-4 w-4" />}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
