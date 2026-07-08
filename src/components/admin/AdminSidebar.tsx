import { BarChart3, Users, Code, Settings, Waypoints, MessageSquare, ShieldCheck } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';

const items = [
  { title: 'Analytics', value: 'analytics', icon: BarChart3 },
  { title: 'Leads', value: 'leads', icon: Users },
  { title: 'GoHighLevel', value: 'ghl', icon: Waypoints },
  { title: 'Conversations', value: 'conversations', icon: MessageSquare },
  { title: 'Tracking', value: 'tracking', icon: Code },
  { title: 'Audit Reports', value: 'audit', icon: ShieldCheck },
  { title: 'Settings', value: 'settings', icon: Settings },
];

interface AdminSidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export function AdminSidebar({ activeTab, onTabChange }: AdminSidebarProps) {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <div className="px-4 py-5 border-b border-sidebar-border">
          {!collapsed ? (
            <span className="font-display text-lg font-bold text-primary">Admin</span>
          ) : (
            <BarChart3 className="w-5 h-5 text-primary mx-auto" />
          )}
        </div>

        <SidebarGroup>
          <SidebarGroupLabel>Dashboard</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.value}>
                  <SidebarMenuButton
                    onClick={() => onTabChange(item.value)}
                    className={activeTab === item.value ? 'bg-primary/10 text-primary font-medium' : ''}
                  >
                    <item.icon className="mr-2 h-4 w-4" />
                    {!collapsed && <span>{item.title}</span>}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
