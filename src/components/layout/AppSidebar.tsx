import {
  LayoutDashboard,
  BarChart3,
  ClipboardCheck,
  Bot,
  Video,
  MessageSquare,
  Handshake,
  Smartphone,
  Settings,
  Database,
  Shield,
  ShieldAlert,
  Receipt,
  Palette,
  ChevronDown,
  Globe,
  HelpCircle,
  Calendar,
  BookOpen,
  DollarSign,
  Users,
  CheckCircle2,
  Zap,
  BarChart2,
  Megaphone,
  FileText,
  Plug,
  Cpu,
  TrendingUp,
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface AppSidebarProps {
  pendingTaskCount?: number;
  pendingCreativeCount?: number;
  pendingMeetingCount?: number;
  isAdmin?: boolean;
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const navStructure = [
  {
    title: 'Dashboard',
    value: 'dashboard',
    icon: LayoutDashboard,
  },
  {
    title: 'Tasks',
    value: 'tasks',
    icon: ClipboardCheck,
  },
  {
    title: 'Email',
    value: 'email',
    icon: MessageSquare,
  },
  {
    title: 'Onboarding',
    value: 'onboarding',
    icon: Users,
  },
  {
    title: 'AM Workspace',
    value: 'am-workspace',
    icon: Sparkles,
  },
  {
    title: 'AI Studio',
    value: 'ai-studio',
    icon: Bot,
  },
  {
    title: 'Reporting',
    value: 'reporting',
    icon: BarChart3,
    children: [
      { title: 'AI Hub', value: 'ai', icon: Bot },
      { title: 'Meetings', value: 'meetings', icon: Video },
      { title: 'Deals', value: 'deals', icon: Handshake },
      { title: 'Outreach', value: 'outreach', icon: MessageSquare },
    ],
  },
  {
    title: 'Agents',
    value: 'agents',
    icon: Cpu,
  },
  {
    title: 'Enrichment',
    value: 'enrichment',
    icon: Sparkles,
  },
  {
    title: 'Ads Manager',
    value: 'ads-manager',
    icon: Megaphone,
  },
  {
    title: 'Creatives',
    value: 'creatives-group',
    icon: Palette,
    children: [
      { title: 'Ads Generator', value: 'ads-generator-ext', icon: ExternalLink, externalUrl: 'https://id-preview--b57a79c0-3e59-4a78-be94-340c58fe824e.lovable.app' },
      { title: 'Top Performers', value: 'top-performers', icon: TrendingUp },
    ],
  },
  {
    title: 'Offers',
    value: 'offers',
    icon: FileText,
  },
  {
    title: 'Funnel Builder',
    value: 'funnel-group',
    icon: Smartphone,
    children: [
      { title: 'Funnel Overview', value: 'funnel-builder', icon: Globe },
      { title: 'Quiz Builder', value: 'funnel-quiz', icon: HelpCircle },
      { title: 'Booking Pages', value: 'funnel-booking', icon: Calendar },
      { title: 'Sales Deck', value: 'funnel-deck', icon: BookOpen },
      { title: 'Investment Page', value: 'funnel-invest', icon: DollarSign },
      { title: 'Onboarding', value: 'funnel-onboarding', icon: Users },
      { title: 'Fulfillment', value: 'funnel-fulfillment', icon: CheckCircle2 },
      { title: 'Kickoff', value: 'funnel-kickoff', icon: Zap },
      { title: 'Funnel Analytics', value: 'funnel-analytics', icon: BarChart2 },
    ],
  },
  {
    title: 'Settings',
    value: 'settings-group',
    icon: Settings,
    children: [
      { title: 'Database', value: 'database', icon: Database },
      { title: 'Spam List', value: 'spam', icon: Shield },
      { title: 'Integrations', value: 'integrations', icon: Plug },
    ],
  },
];

export function AppSidebar({
  pendingTaskCount = 0,
  pendingCreativeCount = 0,
  pendingMeetingCount = 0,
  isAdmin = false,
  activeTab,
  onTabChange,
}: AppSidebarProps) {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';

  const getBadge = (value: string) => {
    if (value === 'meetings' && pendingMeetingCount > 0) return pendingMeetingCount;
    if (value === 'creatives' && pendingCreativeCount > 0) return pendingCreativeCount;
    return 0;
  };

  const isChildActive = (item: typeof navStructure[number]) => {
    if (!item.children) return false;
    return item.children.some(c => c.value === activeTab);
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-border">
      <SidebarContent>
        {/* Logo */}
        <div className="px-3 py-4 flex items-center gap-2">
          <div className="h-8 w-8 rounded-xl bg-primary flex items-center justify-center flex-shrink-0">
            <span className="text-primary-foreground font-bold text-xs tracking-tight">HPA</span>
          </div>
          {!collapsed && (
            <span className="font-semibold text-sm tracking-tight">HPA Dashboard</span>
          )}
        </div>

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navStructure.map((item) => {
                if (!item.children) {
                  const badge = getBadge(item.value);
                  return (
                    <SidebarMenuItem key={item.value}>
                      <SidebarMenuButton
                        isActive={activeTab === item.value}
                        onClick={() => onTabChange(item.value)}
                        tooltip={item.title}
                      >
                        <item.icon className="h-4 w-4" />
                        {!collapsed && <span>{item.title}</span>}
                        {!collapsed && badge > 0 && (
                          <Badge variant="default" className="ml-auto h-5 min-w-[20px] flex items-center justify-center text-[10px] px-1.5">
                            {badge}
                          </Badge>
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                }

                const active = isChildActive(item);

                return (
                  <Collapsible key={item.value} defaultOpen={active} className="group/collapsible">
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton
                          isActive={active}
                          tooltip={item.title}
                        >
                          <item.icon className="h-4 w-4" />
                          {!collapsed && <span>{item.title}</span>}
                          {!collapsed && (
                            <ChevronDown className="ml-auto h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                          )}
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {item.children.map((child) => {
                            const badge = getBadge(child.value);
                            return (
                              <SidebarMenuSubItem key={child.value}>
                                <SidebarMenuSubButton
                                  isActive={activeTab === child.value}
                                  onClick={() => {
                                    if ('externalUrl' in child && (child as any).externalUrl) {
                                      window.open((child as any).externalUrl, '_blank');
                                    } else {
                                      onTabChange(child.value);
                                    }
                                  }}
                                >
                                  <child.icon className="h-3.5 w-3.5" />
                                  <span>{child.title}</span>
                                  {badge > 0 && (
                                    <Badge variant="default" className="ml-auto h-5 min-w-[20px] flex items-center justify-center text-[10px] px-1.5">
                                      {badge}
                                    </Badge>
                                  )}
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            );
                          })}
                          {/* Add Billing under Settings for admins */}
                          {item.value === 'settings-group' && isAdmin && (
                            <SidebarMenuSubItem>
                              <SidebarMenuSubButton
                                isActive={activeTab === 'billing'}
                                onClick={() => onTabChange('billing')}
                              >
                                <Receipt className="h-3.5 w-3.5" />
                                <span>Billing</span>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          )}
                          {/* Add Data Accuracy Audit under Settings for admins */}
                          {item.value === 'settings-group' && isAdmin && (
                            <SidebarMenuSubItem>
                              <SidebarMenuSubButton
                                isActive={activeTab === 'data-audit'}
                                onClick={() => onTabChange('data-audit')}
                              >
                                <ShieldAlert className="h-3.5 w-3.5" />
                                <span>Data Audit</span>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          )}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
