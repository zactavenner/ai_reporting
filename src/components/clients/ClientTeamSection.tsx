import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Trash2, Star, Mail, Phone, Users, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

interface TeamMember {
  id: string;
  client_id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  is_primary_contact: boolean;
  sort_order: number;
}

type FormState = {
  name: string;
  role: string;
  email: string;
  phone: string;
  notes: string;
  is_primary_contact: boolean;
};

const emptyForm: FormState = {
  name: '',
  role: '',
  email: '',
  phone: '',
  notes: '',
  is_primary_contact: false,
};

export function ClientTeamSection({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['client-team-members', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_team_members' as any)
        .select('*')
        .eq('client_id', clientId)
        .order('is_primary_contact', { ascending: false })
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as TeamMember[];
    },
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['client-team-members', clientId] });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error('Name is required');
      const payload = {
        client_id: clientId,
        name: form.name.trim(),
        role: form.role.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        notes: form.notes.trim() || null,
        is_primary_contact: form.is_primary_contact,
      };

      // If marking as primary, clear other primary flags
      if (form.is_primary_contact) {
        await supabase
          .from('client_team_members' as any)
          .update({ is_primary_contact: false })
          .eq('client_id', clientId)
          .neq('id', editing?.id ?? '00000000-0000-0000-0000-000000000000');
      }

      if (editing) {
        const { error } = await supabase
          .from('client_team_members' as any)
          .update(payload)
          .eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('client_team_members' as any)
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? 'Team member updated' : 'Team member added');
      setOpen(false);
      setEditing(null);
      setForm(emptyForm);
      invalidate();
    },
    onError: (e: any) => toast.error(e.message || 'Failed to save'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('client_team_members' as any)
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Removed');
      invalidate();
    },
    onError: (e: any) => toast.error(e.message || 'Failed to remove'),
  });

  const openAdd = () => {
    setEditing(null);
    setForm({ ...emptyForm, is_primary_contact: members.length === 0 });
    setOpen(true);
  };

  const openEdit = (m: TeamMember) => {
    setEditing(m);
    setForm({
      name: m.name,
      role: m.role ?? '',
      email: m.email ?? '',
      phone: m.phone ?? '',
      notes: m.notes ?? '',
      is_primary_contact: m.is_primary_contact,
    });
    setOpen(true);
  };

  const primary = members.find((m) => m.is_primary_contact);
  const others = members.filter((m) => !m.is_primary_contact);

  return (
    <div className="mt-10 pt-8 border-t border-border">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Point of Contact & Team
          </h2>
          <p className="text-sm text-muted-foreground">
            Primary contact plus everyone on the client side. Used as a reference for outreach and approvals.
          </p>
        </div>
        <Button size="sm" onClick={openAdd}>
          <Plus className="h-4 w-4 mr-1.5" /> Add Member
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </div>
      ) : members.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-8 text-center text-sm text-muted-foreground">
          No team members yet. Add a point of contact to get started.
        </div>
      ) : (
        <div className="space-y-3">
          {primary && <MemberCard m={primary} onEdit={openEdit} onDelete={(id) => deleteMutation.mutate(id)} />}
          {others.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {others.map((m) => (
                <MemberCard key={m.id} m={m} onEdit={openEdit} onDelete={(id) => deleteMutation.mutate(id)} />
              ))}
            </div>
          )}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Team Member' : 'Add Team Member'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jane Doe" />
            </div>
            <div>
              <Label>Role / Title</Label>
              <Input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="CEO, Marketing Lead, etc." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jane@co.com" />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 555 0123" />
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Preferences, timezone, decision power, etc." />
            </div>
            <label className="flex items-center gap-2 text-sm pt-1 cursor-pointer">
              <Checkbox
                checked={form.is_primary_contact}
                onCheckedChange={(c) => setForm({ ...form, is_primary_contact: !!c })}
              />
              <span>Primary point of contact</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editing ? 'Save' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MemberCard({
  m,
  onEdit,
  onDelete,
}: {
  m: TeamMember;
  onEdit: (m: TeamMember) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="group border border-border rounded-lg p-4 bg-card hover:border-primary/40 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold truncate">{m.name}</span>
            {m.is_primary_contact && (
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                <Star className="h-3 w-3" /> Primary
              </span>
            )}
          </div>
          {m.role && <div className="text-sm text-muted-foreground">{m.role}</div>}
        </div>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button size="sm" variant="ghost" onClick={() => onEdit(m)}>Edit</Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (confirm(`Remove ${m.name}?`)) onDelete(m.id);
            }}
          >
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      </div>
      {(m.email || m.phone) && (
        <div className="mt-2 space-y-1 text-sm">
          {m.email && (
            <a href={`mailto:${m.email}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground truncate">
              <Mail className="h-3.5 w-3.5" /> {m.email}
            </a>
          )}
          {m.phone && (
            <a href={`tel:${m.phone}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
              <Phone className="h-3.5 w-3.5" /> {m.phone}
            </a>
          )}
        </div>
      )}
      {m.notes && <p className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap">{m.notes}</p>}
    </div>
  );
}