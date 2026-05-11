import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTeamMember } from '@/contexts/TeamMemberContext';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  MessageSquarePlus,
  CheckCircle2,
  XCircle,
  Loader2,
  Trash2,
  Sparkles,
  Clock,
} from 'lucide-react';

interface FeedbackItem {
  id: string;
  title: string;
  description: string | null;
  category: string;
  priority: string;
  status: string;
  submitted_by_name: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  admin_notes: string | null;
  created_at: string;
}

const STATUS_META: Record<string, { label: string; tone: string }> = {
  pending: { label: 'Pending', tone: 'bg-amber-500/15 text-amber-700 border-amber-500/30' },
  approved: { label: 'Approved', tone: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30' },
  rejected: { label: 'Rejected', tone: 'bg-red-500/15 text-red-700 border-red-500/30' },
  implemented: { label: 'Implemented', tone: 'bg-blue-500/15 text-blue-700 border-blue-500/30' },
};

export function FeedbackTab() {
  const { currentMember } = useTeamMember();
  const isAdmin = currentMember?.role === 'admin';
  const qc = useQueryClient();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('feature');
  const [priority, setPriority] = useState('medium');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['app-feedback'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('app_feedback')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as FeedbackItem[];
    },
  });

  const createFeedback = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).from('app_feedback').insert({
        title: title.trim(),
        description: description.trim() || null,
        category,
        priority,
        submitted_by_id: currentMember?.id || null,
        submitted_by_name: currentMember?.name || 'Anonymous',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Feedback submitted');
      setTitle('');
      setDescription('');
      setCategory('feature');
      setPriority('medium');
      qc.invalidateQueries({ queryKey: ['app-feedback'] });
    },
    onError: (e: any) => toast.error(e.message || 'Failed to submit'),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status, notes }: { id: string; status: string; notes?: string }) => {
      const update: any = {
        status,
        reviewed_by_name: currentMember?.name || null,
        reviewed_at: new Date().toISOString(),
      };
      if (notes !== undefined) update.admin_notes = notes;
      const { error } = await (supabase as any).from('app_feedback').update(update).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Updated');
      qc.invalidateQueries({ queryKey: ['app-feedback'] });
    },
    onError: (e: any) => toast.error(e.message || 'Failed'),
  });

  const deleteFeedback = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('app_feedback').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Deleted');
      qc.invalidateQueries({ queryKey: ['app-feedback'] });
    },
  });

  const filtered = statusFilter === 'all' ? items : items.filter((i) => i.status === statusFilter);
  const counts = items.reduce<Record<string, number>>((acc, i) => {
    acc[i.status] = (acc[i.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold flex items-center gap-2">
          <MessageSquarePlus className="h-5 w-5" /> App Feedback & Change Requests
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Submit ideas, bug reports, or change requests. Admins review and approve them for implementation.
        </p>
      </div>

      {/* Submit form */}
      <Card className="p-5 space-y-4 border-2">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" /> Submit a request
        </h3>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short summary (e.g. Add export button to Tasks)"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Description (optional)</Label>
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's the problem, where in the app, and what would solve it?"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="feature">New Feature</SelectItem>
                  <SelectItem value="bug">Bug Report</SelectItem>
                  <SelectItem value="improvement">Improvement</SelectItem>
                  <SelectItem value="design">Design / UI</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              disabled={!title.trim() || createFeedback.isPending}
              onClick={() => createFeedback.mutate()}
            >
              {createFeedback.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <MessageSquarePlus className="h-4 w-4 mr-2" />}
              Submit Request
            </Button>
          </div>
        </div>
      </Card>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {['all', 'pending', 'approved', 'rejected', 'implemented'].map((s) => (
          <Button
            key={s}
            variant={statusFilter === s ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter(s)}
            className="capitalize"
          >
            {s} {s !== 'all' && counts[s] ? `(${counts[s]})` : ''}
          </Button>
        ))}
      </div>

      {/* List */}
      <div className="space-y-3">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && filtered.length === 0 && (
          <Card className="p-8 text-center text-sm text-muted-foreground">No feedback yet.</Card>
        )}
        {filtered.map((item) => {
          const meta = STATUS_META[item.status] || STATUS_META.pending;
          return (
            <Card key={item.id} className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className={meta.tone}>{meta.label}</Badge>
                    <Badge variant="secondary" className="capitalize">{item.category}</Badge>
                    <Badge variant="outline" className="capitalize">{item.priority}</Badge>
                  </div>
                  <h4 className="font-semibold mt-2 leading-snug">{item.title}</h4>
                  {item.description && (
                    <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{item.description}</p>
                  )}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-2 flex-wrap">
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{format(new Date(item.created_at), 'MMM d, yyyy h:mm a')}</span>
                    {item.submitted_by_name && <span>by <span className="font-medium text-foreground">{item.submitted_by_name}</span></span>}
                    {item.reviewed_by_name && (
                      <span>· reviewed by <span className="font-medium text-foreground">{item.reviewed_by_name}</span></span>
                    )}
                  </div>
                  {item.admin_notes && (
                    <div className="mt-2 p-2 rounded bg-muted/50 text-xs">
                      <span className="font-medium">Notes:</span> {item.admin_notes}
                    </div>
                  )}
                </div>
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={() => {
                      if (confirm('Delete this feedback?')) deleteFeedback.mutate(item.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>

              {isAdmin && (
                <div className="flex items-center gap-2 flex-wrap pt-2 border-t">
                  {item.status !== 'approved' && (
                    <Button size="sm" variant="outline" className="text-emerald-700 border-emerald-500/40"
                      onClick={() => updateStatus.mutate({ id: item.id, status: 'approved' })}>
                      <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
                    </Button>
                  )}
                  {item.status !== 'implemented' && (
                    <Button size="sm" variant="outline" className="text-blue-700 border-blue-500/40"
                      onClick={() => updateStatus.mutate({ id: item.id, status: 'implemented' })}>
                      <Sparkles className="h-4 w-4 mr-1" /> Mark Implemented
                    </Button>
                  )}
                  {item.status !== 'rejected' && (
                    <Button size="sm" variant="outline" className="text-red-700 border-red-500/40"
                      onClick={() => updateStatus.mutate({ id: item.id, status: 'rejected' })}>
                      <XCircle className="h-4 w-4 mr-1" /> Reject
                    </Button>
                  )}
                  {item.status !== 'pending' && (
                    <Button size="sm" variant="ghost"
                      onClick={() => updateStatus.mutate({ id: item.id, status: 'pending' })}>
                      Reset to Pending
                    </Button>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}