import { useState, useMemo } from 'react';
import { Plus, Edit2, Trash2, ChevronRight, GripVertical, Link2, ZoomIn, ZoomOut, Maximize2, MessageSquarePlus, GitBranch } from 'lucide-react';
import { DndContext, DragEndEvent, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { TransformWrapper, TransformComponent, useControls } from 'react-zoom-pan-pinch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { FunnelStepCard } from './FunnelStepCard';
import { useAllStepVariants, type FunnelStepVariant } from '@/hooks/useFunnelStepVariants';
import type { FunnelCampaign } from '@/hooks/useFunnelCampaigns';
import type { FunnelStep } from '@/hooks/useFunnelSteps';
import type { DeviceType } from './DeviceSwitcher';

interface CampaignFlowSectionProps {
  campaign: FunnelCampaign;
  steps: FunnelStep[];
  deviceType: DeviceType;
  isPublicView: boolean;
  clientId?: string;
  brandName?: string;
  publicShareToken?: string | null;
  onAddStep: (
    campaignId: string,
    parentStepId?: string | null,
    defaultKind?: FunnelStep['step_kind'],
  ) => void;
  onEditStep: (step: FunnelStep) => void;
  onDeleteStep: (stepId: string) => void;
  onReorderSteps: (orderedIds: string[]) => void;
  onEditCampaign: (campaign: FunnelCampaign) => void;
  onDeleteCampaign: (campaignId: string) => void;
}

interface SortableStepProps {
  step: FunnelStep;
  index: number;
  deviceType: DeviceType;
  isPublicView: boolean;
  isLast: boolean;
  variants: FunnelStepVariant[];
  clientId?: string;
  brandName?: string;
  childSteps: FunnelStep[];
  variantsByStep: Record<string, FunnelStepVariant[]>;
  onEditStep: (step: FunnelStep) => void;
  onDeleteStep: (stepId: string) => void;
  onAddNurture: () => void;
  onAddBranch: () => void;
  onInsertAfter: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function SortableStep({
  step, index, deviceType, isPublicView, isLast, variants, clientId, brandName,
  childSteps, variantsByStep, onEditStep, onDeleteStep,
  onAddNurture, onAddBranch, onInsertAfter, onEdit, onDelete,
}: SortableStepProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: step.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const NURTURE_KINDS = new Set(['sms', 'email', 'phone_call', 'note']);
  const nurtureChildren = childSteps.filter(c => NURTURE_KINDS.has(c.step_kind));
  const branchChildren = childSteps.filter(c => !NURTURE_KINDS.has(c.step_kind));

  return (
    <div ref={setNodeRef} style={style} className="flex items-start">
      <div className="relative flex flex-col items-center">
        {!isPublicView && (
          <button
            {...attributes}
            {...listeners}
            className="absolute -left-6 top-8 cursor-grab hover:bg-accent rounded p-1 touch-none z-10"
          >
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
        <FunnelStepCard
          step={step}
          stepNumber={index + 1}
          deviceType={deviceType}
          isPublicView={isPublicView}
          variants={variants}
          clientId={clientId}
          brandName={brandName}
          onEdit={onEdit}
          onDelete={onDelete}
        />

        {/* Horizontal branch chain (sub-flow) */}
        {branchChildren.length > 0 && (
          <div className="mt-4 flex flex-col items-center w-full">
            <div className="h-6 w-px bg-primary/50" aria-hidden />
            <div className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-primary bg-background/80 backdrop-blur px-2 py-0.5 rounded-full border border-primary/40">
              <GitBranch className="h-3 w-3" /> Branch
            </div>
            <div className="flex items-start gap-2">
              {branchChildren.map((b, bi) => (
                <div key={b.id} className="flex items-start">
                  <FunnelStepCard
                    step={b}
                    stepNumber={index + 1}
                    deviceType={deviceType}
                    isPublicView={isPublicView}
                    variants={variantsByStep[b.id] || []}
                    clientId={clientId}
                    brandName={brandName}
                    onEdit={() => onEditStep(b)}
                    onDelete={() => onDeleteStep(b.id)}
                  />
                  {bi < branchChildren.length - 1 && (
                    <ChevronRight className="mx-2 mt-[200px] h-5 w-5 text-muted-foreground" />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Nurture stack under this column */}
        {(nurtureChildren.length > 0 || !isPublicView) && (
          <div className="mt-4 flex flex-col items-center gap-3 w-full">
            {nurtureChildren.length > 0 && (
              <div className="h-6 w-px bg-border" aria-hidden />
            )}
            {nurtureChildren.map((child) => (
              <div key={child.id} className="flex flex-col items-center">
                <div className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground bg-background/70 backdrop-blur px-2 py-0.5 rounded-full border">
                  Nurture · {child.step_kind === 'sms' ? 'SMS' : child.step_kind === 'email' ? 'Email' : child.name}
                </div>
                <FunnelStepCard
                  step={child}
                  stepNumber={index + 1}
                  deviceType={deviceType}
                  isPublicView={isPublicView}
                  variants={variantsByStep[child.id] || []}
                  clientId={clientId}
                  brandName={brandName}
                  onEdit={() => onEditStep(child)}
                  onDelete={() => onDeleteStep(child.id)}
                />
                <div className="h-4 w-px bg-border/60 mt-2" aria-hidden />
              </div>
            ))}
            {!isPublicView && (
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onAddNurture}
                  className="h-7 text-xs bg-background/80 backdrop-blur"
                >
                  <MessageSquarePlus className="h-3 w-3 mr-1" /> Nurture
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onAddBranch}
                  className="h-7 text-xs bg-background/80 backdrop-blur border-primary/40 text-primary hover:text-primary"
                >
                  <GitBranch className="h-3 w-3 mr-1" /> Branch
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
      {!isLast && (
        <div className="flex-shrink-0 self-stretch flex items-start relative group">
          <ChevronRight className="mx-3 mt-[200px] h-6 w-6 text-muted-foreground" />
          {!isPublicView && (
            <button
              onClick={onInsertAfter}
              title="Insert step here"
              className="absolute left-1/2 -translate-x-1/2 top-[190px] opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7 rounded-full bg-primary text-primary-foreground shadow-md flex items-center justify-center hover:scale-110"
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ZoomToolbar() {
  const { zoomIn, zoomOut, resetTransform } = useControls();
  return (
    <div className="absolute top-2 right-2 z-20 flex items-center gap-1 bg-background/80 backdrop-blur border rounded-md shadow-sm p-1">
      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => zoomOut()} title="Zoom out">
        <ZoomOut className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => resetTransform()} title="Reset">
        <Maximize2 className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => zoomIn()} title="Zoom in">
        <ZoomIn className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function CampaignFlowSection({
  campaign,
  steps,
  deviceType,
  isPublicView,
  clientId,
  brandName,
  publicShareToken,
  onAddStep,
  onEditStep,
  onDeleteStep,
  onReorderSteps,
  onEditCampaign,
  onDeleteCampaign,
}: CampaignFlowSectionProps) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState(campaign.name);

  // Fetch all variants for steps in this campaign
  const stepIds = useMemo(() => steps.map(s => s.id), [steps]);
  const { data: allVariants = [] } = useAllStepVariants(stepIds);
  
  // Group variants by step ID
  const variantsByStep = useMemo(() => {
    const map: Record<string, FunnelStepVariant[]> = {};
    allVariants.forEach(v => {
      if (!map[v.step_id]) map[v.step_id] = [];
      map[v.step_id].push(v);
    });
    return map;
  }, [allVariants]);

  // Split into top-level columns + children map
  const { topSteps, childrenByParent } = useMemo(() => {
    const top: FunnelStep[] = [];
    const kids: Record<string, FunnelStep[]> = {};
    steps.forEach(s => {
      if (s.parent_step_id) {
        (kids[s.parent_step_id] ||= []).push(s);
      } else {
        top.push(s);
      }
    });
    Object.values(kids).forEach(arr => arr.sort((a, b) => a.sort_order - b.sort_order));
    return { topSteps: top, childrenByParent: kids };
  }, [steps]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    
    const oldIndex = topSteps.findIndex(s => s.id === active.id);
    const newIndex = topSteps.findIndex(s => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    
    const newOrder = arrayMove(topSteps, oldIndex, newIndex);
    onReorderSteps(newOrder.map(s => s.id));
  };

  const handleSaveName = () => {
    if (editName.trim() && editName !== campaign.name) {
      onEditCampaign({ ...campaign, name: editName.trim() });
    }
    setIsEditingName(false);
  };

  const handleCopyPreviewLink = () => {
    if (!publicShareToken) {
      toast.error('This client needs a public share token first.');
      return;
    }
    const url = `${window.location.origin}/public/${publicShareToken}?tab=funnel&campaign=${campaign.id}`;
    navigator.clipboard.writeText(url).then(
      () => toast.success('Preview link copied to clipboard'),
      () => toast.error('Failed to copy link')
    );
  };

  return (
    <div 
      className="rounded-xl p-6 border"
      style={{ backgroundColor: campaign.color }}
    >
      {/* Campaign Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {isEditingName ? (
            <div className="flex items-center gap-2">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="h-8 w-64"
                autoFocus
                onBlur={handleSaveName}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
              />
            </div>
          ) : (
            <h3 className="text-xl font-bold">{campaign.name}</h3>
          )}
          {!isPublicView && !isEditingName && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsEditingName(true)}
              className="h-7 w-7 p-0"
            >
              <Edit2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        {!isPublicView && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleCopyPreviewLink} title="Copy client preview link">
              <Link2 className="h-4 w-4 mr-1" /> Copy Preview Link
            </Button>
            <Button size="sm" variant="outline" onClick={() => onAddStep(campaign.id)}>
              <Plus className="h-4 w-4 mr-1" /> Add Step
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Campaign?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will delete "{campaign.name}" and all its steps. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onDeleteCampaign(campaign.id)}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>
      
      {/* Flow Diagram with Steps */}
      {topSteps.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <p>No steps in this campaign yet. Click "Add Step" to get started.</p>
        </div>
      ) : (
        <div className="relative rounded-lg border bg-background/40 overflow-hidden" style={{ height: 780 }}>
          <TransformWrapper
            initialScale={1}
            minScale={0.4}
            maxScale={2}
            limitToBounds={false}
            wheel={{ step: 0.03 }}
            doubleClick={{ disabled: true }}
            panning={{ excluded: ['input', 'textarea', 'button', 'a', 'select', 'iframe'] }}
          >
            <ZoomToolbar />
            <TransformComponent
              wrapperStyle={{ width: '100%', height: '100%' }}
              contentStyle={{ padding: '2rem 2rem 3rem 2.5rem' }}
            >
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext items={topSteps.map(s => s.id)} strategy={horizontalListSortingStrategy}>
                  <div className="flex items-start gap-2">
                    {topSteps.map((step, index) => (
                      <SortableStep
                        key={step.id}
                        step={step}
                        index={index}
                        deviceType={deviceType}
                        isPublicView={isPublicView}
                        isLast={index === topSteps.length - 1}
                        variants={variantsByStep[step.id] || []}
                        clientId={clientId}
                        brandName={brandName}
                        childSteps={childrenByParent[step.id] || []}
                        variantsByStep={variantsByStep}
                        onEditStep={onEditStep}
                        onDeleteStep={onDeleteStep}
                        onAddNurture={() => onAddStep(campaign.id, step.id)}
                        onAddBranch={() => onAddStep(campaign.id, step.id, 'page')}
                        onInsertAfter={() => onAddStep(campaign.id, null, 'page')}
                        onEdit={() => onEditStep(step)}
                        onDelete={() => onDeleteStep(step.id)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </TransformComponent>
          </TransformWrapper>
        </div>
      )}
    </div>
  );
}
