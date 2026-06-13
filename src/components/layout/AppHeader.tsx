import { useState } from 'react';
import { Settings2, User, LogOut, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { GlobalClientSearch } from '@/components/search/GlobalClientSearch';
import { NotificationBell } from '@/components/layout/NotificationBell';
import { CreateTaskModal } from '@/components/tasks/CreateTaskModal';
import { GlobalVoiceButton } from '@/components/layout/GlobalVoiceButton';
import { useClients } from '@/hooks/useClients';

interface AppHeaderProps {
  onSettings?: () => void;
  currentMemberName?: string;
  onLogout?: () => void;
  onTaskClick?: (taskId: string) => void;
}

export function AppHeader({ onSettings, currentMemberName, onLogout, onTaskClick }: AppHeaderProps) {
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const { data: clients = [] } = useClients();

  return (
    <>
      <header className="border-b border-border bg-card/80 apple-blur sticky top-0 z-30 h-12 flex items-center px-4 gap-2">
        <SidebarTrigger className="mr-2" />
        <GlobalClientSearch />
        <div className="flex-1" />
        <div className="flex items-center gap-1.5">
          <Button
            variant="default"
            size="sm"
            onClick={() => setCreateTaskOpen(true)}
            className="h-8 gap-1.5 text-xs font-medium"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Add Task</span>
          </Button>
          <NotificationBell onTaskClick={onTaskClick} />
          <GlobalVoiceButton />
          {onSettings && (
            <Button variant="ghost" size="icon" onClick={onSettings} title="Settings">
              <Settings2 className="h-4 w-4" />
            </Button>
          )}
          <ThemeToggle />
          {currentMemberName && onLogout && (
            <div className="flex items-center gap-2 ml-1 pl-2 border-l border-border">
              <div className="hidden sm:flex items-center gap-1.5 text-sm">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-medium text-sm">{currentMemberName}</span>
              </div>
              <Button variant="ghost" size="icon" onClick={onLogout} title="Sign out" className="h-8 w-8">
                <LogOut className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      </header>
      <CreateTaskModal
        open={createTaskOpen}
        onOpenChange={setCreateTaskOpen}
        clients={clients}
      />
    </>
  );
}
