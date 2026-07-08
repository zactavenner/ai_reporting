import { useState } from 'react';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { AnalyticsTab } from '@/components/admin/AnalyticsTab';
import { LeadsTab } from '@/components/admin/LeadsTab';
import { GHLTab } from '@/components/admin/GHLTab';
import { ConversationsTab } from '@/components/admin/ConversationsTab';
import { TrackingTab } from '@/components/admin/TrackingTab';
import { SettingsTab } from '@/components/admin/SettingsTab';
import { AuditReportsTab } from '@/components/admin/AuditReportsTab';

export default function Admin() {
  const [activeTab, setActiveTab] = useState('analytics');

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background text-foreground">
        <AdminSidebar activeTab={activeTab} onTabChange={setActiveTab} />

        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <header className="h-14 border-b border-border bg-card/60 backdrop-blur-sm sticky top-0 z-50 flex items-center px-4 gap-3">
            <SidebarTrigger />
            <h1 className="font-display text-lg font-bold capitalize">{activeTab}</h1>
            <span className="ml-auto text-xs text-muted-foreground">Last updated: {new Date().toLocaleDateString()}</span>
          </header>

          {/* Content */}
          <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
            {activeTab === 'analytics' && <AnalyticsTab />}
            {activeTab === 'leads' && <LeadsTab />}
            {activeTab === 'ghl' && <GHLTab />}
            {activeTab === 'conversations' && <ConversationsTab />}
            {activeTab === 'tracking' && <TrackingTab />}
            {activeTab === 'audit' && <AuditReportsTab />}
            {activeTab === 'settings' && <SettingsTab />}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
