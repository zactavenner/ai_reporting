 import { useNavigate, useParams } from 'react-router-dom';
 import { ArrowLeft, Sparkles } from 'lucide-react';
 import { Button } from '@/components/ui/button';
 import { CreativesSection } from '@/components/creative/CreativesSection';
 import { ThemeToggle } from '@/components/theme/ThemeToggle';
 import { CashBagLoader } from '@/components/ui/CashBagLoader';
 import { useClient } from '@/hooks/useClients';

 export default function ClientCreatives() {
   const { clientId } = useParams<{ clientId: string }>();
   const navigate = useNavigate();
   const { data: client, isLoading } = useClient(clientId);

   if (isLoading) {
     return (
       <div className="min-h-screen flex items-center justify-center">
         <CashBagLoader message="Loading creatives..." />
       </div>
     );
   }

   if (!client) {
     return (
       <div className="min-h-screen flex items-center justify-center">
         <p>Client not found</p>
       </div>
     );
   }

   return (
     <div className="min-h-screen bg-background">
       <header className="sticky top-0 z-30 border-b border-border/30 bg-background/80 backdrop-blur-xl">
         <div className="px-6 py-3 flex items-center justify-between max-w-7xl mx-auto">
           <div className="flex items-center gap-4">
             <Button variant="ghost" size="sm" onClick={() => navigate(`/client/${clientId}`)} className="rounded-xl gap-2 text-muted-foreground hover:text-foreground">
               <ArrowLeft className="h-4 w-4" />
               Back
             </Button>
             <div className="h-5 w-px bg-border/30" />
             <div className="flex items-center gap-2.5">
               <div className="client-ring">
                 <div className="client-ring-inner h-8 w-8 text-xs">
                   {client.name.charAt(0)}
                 </div>
               </div>
               <div>
                 <h1 className="text-sm font-semibold tracking-tight">{client.name}</h1>
                 <p className="text-[11px] text-muted-foreground/40 flex items-center gap-1">
                   <Sparkles className="h-3 w-3" /> Creative Studio
                 </p>
               </div>
             </div>
           </div>
           <ThemeToggle />
         </div>
       </header>

       <main className="p-6 max-w-7xl mx-auto">
         <CreativesSection
           clientId={client.id}
           clientName={client.name}
           isPublicView={false}
         />
       </main>
     </div>
   );
 }
