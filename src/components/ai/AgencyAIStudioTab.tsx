import { useMemo, useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, Users } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useClients } from "@/hooks/useClients";
import { AIStudioTab } from "./AIStudioTab";
import { TaskBoardView } from "@/components/tasks/TaskBoardView";
import { AgencyFeedbackPanel } from "./AgencyFeedbackPanel";
import { AgencyActivityLog } from "./AgencyActivityLog";

/**
 * Agency-level AI Studio. Same agentic capabilities as the per-client
 * AI Studio (chat, canvas, references, tasks, sheet/doc review, lead
 * audit, static ad generation, brand-locked output), but with a client
 * picker on top so the agency team can run it across any client without
 * leaving the master dashboard. Conversations are persisted per
 * (user, client) — switching the picker resumes the client's thread.
 */
export function AgencyAIStudioTab() {
  const { data: clients = [] } = useClients();
  const sorted = useMemo(
    () => [...clients].sort((a, b) => a.name.localeCompare(b.name)),
    [clients]
  );

  const [selectedClientId, setSelectedClientId] = useState<string>(() => {
    return localStorage.getItem("agency-ai-studio:last-client") || "";
  });

  const selected = sorted.find((c) => c.id === selectedClientId) || sorted[0];
  const activeId = selected?.id || "";

  const handleChange = (id: string) => {
    setSelectedClientId(id);
    localStorage.setItem("agency-ai-studio:last-client", id);
  };

  const [mode, setMode] = useState<"studio" | "tasks" | "feedback" | "activity">("studio");

  // Broadcast current client so the floating Agency AI Chat can auto-detect it
  useEffect(() => {
    if (!activeId) return;
    window.dispatchEvent(
      new CustomEvent("agency:current-client", { detail: { clientId: activeId, clientName: selected?.name || "" } })
    );
  }, [activeId, selected?.name]);

  return (
    <div className="flex flex-col gap-3 h-[calc(100vh-7.5rem)] min-h-0">
      {/* Header */}
      <Card className="p-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-xl bg-primary/10 grid place-items-center">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-base font-semibold leading-tight">AI Studio</h2>
            <p className="text-xs text-muted-foreground">
              Agentic workspace across all clients — chat, audit sheets, generate brand-locked ads, trigger & track agent tasks.
            </p>
          </div>
        </div>
        <Tabs value={mode} onValueChange={(v) => setMode(v as any)} className="ml-auto">
          <TabsList className="h-9 rounded-xl">
            <TabsTrigger value="studio" className="rounded-lg text-xs">Studio</TabsTrigger>
            <TabsTrigger value="tasks" className="rounded-lg text-xs">Task Board</TabsTrigger>
            <TabsTrigger value="feedback" className="rounded-lg text-xs">Feedback</TabsTrigger>
            <TabsTrigger value="activity" className="rounded-lg text-xs">Activity</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Client:</span>
          <Select value={activeId} onValueChange={handleChange}>
            <SelectTrigger className="h-9 w-[260px] rounded-xl">
              <SelectValue placeholder="Pick a client" />
            </SelectTrigger>
            <SelectContent>
              {sorted.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Studio + Task Board — both reuse the same components the client detail page uses */}
      <div className="flex-1 min-h-0">
        {activeId ? (
          mode === "studio" ? (
            <AIStudioTab key={activeId} clientId={activeId} clientName={selected?.name || ""} />
          ) : mode === "tasks" ? (
            <TaskBoardView key={activeId} clientId={activeId} />
          ) : mode === "feedback" ? (
            <AgencyFeedbackPanel key={activeId} clientId={activeId} />
          ) : (
            <AgencyActivityLog key={activeId} clientId={activeId} />
          )
        ) : (
          <Card className="h-full grid place-items-center text-sm text-muted-foreground">
            Add a client to start using AI Studio.
          </Card>
        )}
      </div>
    </div>
  );
}