import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle } from "lucide-react";
import { format, formatDistanceToNow, isPast } from "date-fns";

interface PublicTask {
  id: string;
  title: string;
  description: string | null;
  stage: string;
  status: string;
  priority: string;
  due_date: string | null;
  assigned_to: string | null;
  client_id: string | null;
  created_at: string;
  updated_at: string;
}

interface AssigneeRow {
  task_id: string;
  member: { name: string | null } | null;
  pod: { name: string | null } | null;
}

export default function PublicTaskUrl() {
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<PublicTask[]>([]);
  const [assignees, setAssignees] = useState<Record<string, string[]>>({});
  const [clientNames, setClientNames] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const cutoff = new Date().toISOString();
      // Stuck tasks OR overdue tasks (todo/in_progress past due, not completed)
      const { data: stuckTasks } = await supabase
        .from("tasks")
        .select("*")
        .eq("stage", "stuck")
        .neq("status", "completed")
        .order("due_date", { ascending: true, nullsFirst: false });

      const { data: overdueTasks } = await supabase
        .from("tasks")
        .select("*")
        .in("stage", ["todo", "in_progress"])
        .neq("status", "completed")
        .not("due_date", "is", null)
        .lt("due_date", cutoff)
        .order("due_date", { ascending: true });

      const merged: PublicTask[] = [
        ...(stuckTasks || []),
        ...(overdueTasks || []),
      ];
      const dedup = Array.from(new Map(merged.map((t) => [t.id, t])).values());
      setTasks(dedup);

      const ids = dedup.map((t) => t.id);
      if (ids.length) {
        const { data: a } = await supabase
          .from("task_assignees")
          .select("task_id, member:agency_members(name), pod:agency_pods(name)")
          .in("task_id", ids);
        const map: Record<string, string[]> = {};
        (a as AssigneeRow[] | null)?.forEach((row) => {
          const name = row.member?.name || row.pod?.name;
          if (!name) return;
          (map[row.task_id] ||= []).push(name);
        });
        setAssignees(map);

        const clientIds = Array.from(new Set(dedup.map((t) => t.client_id).filter(Boolean))) as string[];
        if (clientIds.length) {
          const { data: cs } = await supabase
            .from("clients").select("id, name").in("id", clientIds);
          const cmap: Record<string, string> = {};
          cs?.forEach((c: any) => (cmap[c.id] = c.name));
          setClientNames(cmap);
        }
      }
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const stuck = tasks.filter((t) => t.stage === "stuck");
  const overdue = tasks.filter((t) => t.stage !== "stuck");

  return (
    <div className="min-h-screen bg-background p-6 md:p-10">
      <div className="max-w-7xl mx-auto space-y-8">
        <header className="space-y-2">
          <h1 className="text-3xl md:text-4xl font-semibold flex items-center gap-3">
            <AlertTriangle className="h-8 w-8 text-destructive" />
            Stuck & Overdue Tasks
          </h1>
          <p className="text-muted-foreground">
            Public live view — {tasks.length} task{tasks.length === 1 ? "" : "s"} need attention.
          </p>
        </header>

        <Section title="Stuck" tasks={stuck} assignees={assignees} clientNames={clientNames} variant="destructive" />
        <Section title="Overdue (To-Do / In Progress)" tasks={overdue} assignees={assignees} clientNames={clientNames} variant="warning" />
      </div>
    </div>
  );
}

function Section({
  title,
  tasks,
  assignees,
  clientNames,
  variant,
}: {
  title: string;
  tasks: PublicTask[];
  assignees: Record<string, string[]>;
  clientNames: Record<string, string>;
  variant: "destructive" | "warning";
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold flex items-center gap-2">
        {title}
        <Badge variant="secondary">{tasks.length}</Badge>
      </h2>
      {tasks.length === 0 ? (
        <Card className="p-6 text-muted-foreground text-sm">Nothing here. 🎉</Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="px-4 py-3 font-medium">Task</th>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Assignee(s)</th>
                  <th className="px-4 py-3 font-medium">Priority</th>
                  <th className="px-4 py-3 font-medium">Due</th>
                  <th className="px-4 py-3 font-medium">Stage</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => {
                  const due = t.due_date ? new Date(t.due_date) : null;
                  const overdue = due && isPast(due);
                  const names = assignees[t.id] || (t.assigned_to ? [t.assigned_to] : []);
                  return (
                    <tr key={t.id} className="border-t border-border align-top">
                      <td className="px-4 py-3">
                        <div className="font-medium">{t.title}</div>
                        {t.description && (
                          <div className="text-muted-foreground text-xs mt-1 line-clamp-2 max-w-md">
                            {t.description}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {t.client_id ? clientNames[t.client_id] || "—" : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {names.length ? (
                          <div className="flex flex-wrap gap-1">
                            {names.map((n, i) => (
                              <Badge key={i} variant="outline">{n}</Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">Unassigned</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={t.priority === "high" || t.priority === "urgent" ? "destructive" : "secondary"}>
                          {t.priority || "medium"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {due ? (
                          <div>
                            <div className={overdue ? "text-destructive font-medium" : ""}>
                              {format(due, "MMM d, yyyy")}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {formatDistanceToNow(due, { addSuffix: true })}
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={variant === "destructive" ? "destructive" : "secondary"}>
                          {t.stage}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </section>
  );
}