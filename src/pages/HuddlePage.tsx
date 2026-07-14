import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { HuddleRunner } from '@/components/huddle/HuddleRunner';
import { HuddleHistory } from '@/components/huddle/HuddleHistory';

export default function HuddlePage() {
  const [tab, setTab] = useState('run');
  return (
    <div className="min-h-screen">
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <div className="border-b px-4 md:px-8 py-2 flex items-center justify-between">
          <div className="text-sm font-semibold">Daily Huddle</div>
          <TabsList>
            <TabsTrigger value="run">Run Huddle</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="run" className="mt-0">
          <HuddleRunner onFinish={() => setTab('history')} />
        </TabsContent>
        <TabsContent value="history" className="mt-0 p-4 md:p-8">
          <HuddleHistory />
        </TabsContent>
      </Tabs>
    </div>
  );
}