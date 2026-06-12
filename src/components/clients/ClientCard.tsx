import { Client } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { MoreHorizontal, Pencil, Trash2, Zap } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

interface ClientCardProps {
  client: Client;
  onEdit: (client: Client) => void;
  onDelete: (client: Client) => void;
  onQuickGenerate?: (client: Client) => void;
  index?: number;
  projectCount?: number;
  assetCount?: number;
}

function getInitialsBgColor(name: string): string {
  const colors = [
    'bg-rose-500', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500',
    'bg-purple-500', 'bg-cyan-500', 'bg-indigo-500', 'bg-pink-500',
    'bg-teal-500', 'bg-orange-500',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

export function ClientCard({ client, onEdit, onDelete, onQuickGenerate, index = 0, projectCount, assetCount }: ClientCardProps) {
  const navigate = useNavigate();
  const primaryColor = client.brand_colors?.[0];

  const handleClick = () => {
    navigate(`/clients/${client.id}`);
  };

  return (
    <Card 
      className={cn(
        'group cursor-pointer transition-all duration-200 hover:shadow-lg hover:border-primary/50 hover:-translate-y-1 stagger-item h-full'
      )}
      style={{ animationDelay: `${index * 50}ms` }}
      onClick={handleClick}
    >
      <CardContent className="p-5 flex flex-col min-h-[140px] h-full">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Avatar className="h-11 w-11 shrink-0">
              <AvatarImage src={client.logo_url || undefined} alt={client.name} />
              <AvatarFallback 
                className={cn(
                  'text-primary-foreground font-bold text-sm',
                  primaryColor ? '' : getInitialsBgColor(client.name)
                )}
                style={primaryColor ? { backgroundColor: primaryColor } : undefined}
              >
                {client.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold line-clamp-1" title={client.name}>{client.name}</h3>
              {client.description && (
                <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                  {client.description}
                </p>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-0.5 shrink-0">
            {onQuickGenerate && (
              <Button
                variant="ghost"
                size="icon"
                className="opacity-0 group-hover:opacity-100 h-8 w-8 transition-opacity duration-200"
                onClick={(e) => { e.stopPropagation(); onQuickGenerate(client); }}
                title="Quick Generate"
              >
                <Zap className="h-3.5 w-3.5 text-primary" />
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 h-8 w-8 transition-opacity duration-200">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(client); }}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={(e) => { e.stopPropagation(); onDelete(client); }}
                  className="text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Counts & Colors */}
        <div className="mt-auto pt-3 flex items-center justify-between gap-2">
          <div className="flex gap-1.5">
            {typeof assetCount === 'number' && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {assetCount} assets
              </Badge>
            )}
            {typeof projectCount === 'number' && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {projectCount} projects
              </Badge>
            )}
          </div>
          {client.brand_colors && client.brand_colors.length > 0 && (
            <div className="flex gap-1">
              {client.brand_colors.slice(0, 4).map((color, i) => (
                <div
                  key={i}
                  className="h-4 w-4 rounded-full border border-border/50"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
