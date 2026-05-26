import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import { Building2, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export function GlobalClientSearch() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const { data: clients = [] } = useQuery({
    queryKey: ['all-clients-search'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name, status, industry, logo_url')
        .order('name');
      if (error) throw error;
      return data || [];
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  const handleSelect = (clientId: string) => {
    setOpen(false);
    navigate(`/client/${clientId}`);
  };

  const statusColor = (s: string) => {
    if (s === 'active') return 'default';
    if (s === 'onboarding') return 'secondary';
    if (s === 'cc_error') return 'destructive';
    return 'outline';
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground bg-muted/50 border border-border rounded-md hover:bg-muted transition-colors"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Search clients...</span>
        <kbd className="hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
          ⌘K
        </kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search clients by name..." />
        <CommandList>
          <CommandEmpty>No clients found.</CommandEmpty>
          <CommandGroup heading="Clients">
            {clients.map((client) => (
              <CommandItem
                key={client.id}
                value={client.name}
                onSelect={() => handleSelect(client.id)}
                className="flex items-center gap-3 cursor-pointer"
              >
                {client.logo_url ? (
                  <img src={client.logo_url} alt="" className="h-6 w-6 rounded object-cover" />
                ) : (
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="flex-1 font-medium">{client.name}</span>
                {client.industry && (
                  <span className="text-xs text-muted-foreground">{client.industry}</span>
                )}
                <Badge variant={statusColor(client.status)} className="text-[10px] capitalize">
                  {client.status}
                </Badge>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
