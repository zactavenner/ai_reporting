import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Library, Trash2, Plus, ExternalLink, Globe, User as UserIcon } from "lucide-react";
import {
  useAgencyReferences, useClientReferences, useSaveReference, useDeleteReference,
  type RefKind, type ReferenceItem,
} from "@/hooks/useReferences";

const KINDS: { value: RefKind; label: string }[] = [
  { value: "avatar", label: "Avatar" },
  { value: "product", label: "Product image" },
  { value: "brand", label: "Brand asset" },
  { value: "image", label: "Image" },
  { value: "video", label: "Video" },
  { value: "pdf", label: "PDF" },
  { value: "doc", label: "Document" },
];

function RefRow({ r, onDelete }: { r: ReferenceItem; onDelete: () => void }) {
  const isImg = ["avatar", "product", "brand", "image"].includes(r.kind);
  return (
    <li className="flex items-center gap-2 rounded-md border border-border/60 p-2">
      <div className="h-10 w-10 rounded bg-muted overflow-hidden grid place-items-center shrink-0">
        {isImg ? <img src={r.url} alt={r.name} className="h-full w-full object-cover" /> :
          <span className="text-[9px] uppercase">{r.kind}</span>}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">{r.name}</div>
        <a href={r.url} target="_blank" rel="noreferrer" className="text-[10px] text-muted-foreground truncate flex items-center gap-1 hover:underline">
          <ExternalLink className="h-2.5 w-2.5" /> {r.url.slice(0, 60)}
        </a>
      </div>
      <Badge variant="outline" className="text-[9px]">{r.kind}</Badge>
      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={onDelete}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </li>
  );
}

function AddRefRow({
  onAdd, scope, clientId,
}: {
  onAdd: (r: { kind: RefKind; name: string; url: string; client_id?: string }) => void;
  scope: "agency" | "client";
  clientId?: string;
}) {
  const [kind, setKind] = useState<RefKind>("image");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  return (
    <div className="grid grid-cols-[110px_1fr_1.5fr_auto] gap-2">
      <Select value={kind} onValueChange={(v) => setKind(v as RefKind)}>
        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>{KINDS.map(k => <SelectItem key={k.value} value={k.value} className="text-xs">{k.label}</SelectItem>)}</SelectContent>
      </Select>
      <Input className="h-8 text-xs" placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
      <Input className="h-8 text-xs" placeholder="https://… (image, pdf, video URL)" value={url} onChange={e => setUrl(e.target.value)} />
      <Button
        size="sm" className="h-8"
        disabled={!name.trim() || !url.trim()}
        onClick={() => {
          onAdd({ kind, name: name.trim(), url: url.trim(), ...(scope === "client" && clientId ? { client_id: clientId } : {}) });
          setName(""); setUrl("");
        }}
      >
        <Plus className="h-3.5 w-3.5 mr-1" /> Add
      </Button>
    </div>
  );
}

export function ReferencesManager({ clientId }: { clientId: string }) {
  const { data: agency = [] } = useAgencyReferences();
  const { data: client = [] } = useClientReferences(clientId);
  const saveAgency = useSaveReference("agency");
  const saveClient = useSaveReference("client");
  const delAgency = useDeleteReference("agency");
  const delClient = useDeleteReference("client");

  return (
    <div className="space-y-3">
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Agency master references</h3>
          <Badge variant="outline" className="ml-auto">{agency.length}</Badge>
        </div>
        <p className="text-[11px] text-muted-foreground">Shared by every client. Use for global brand assets, stock avatars, agency-wide logos.</p>
        <AddRefRow scope="agency" onAdd={(r) => saveAgency.mutate(r as any)} />
        {agency.length > 0 && (
          <ul className="space-y-1.5 mt-2">
            {agency.map(r => <RefRow key={r.id} r={r} onDelete={() => delAgency.mutate({ id: r.id })} />)}
          </ul>
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <UserIcon className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Client master references</h3>
          <Badge variant="outline" className="ml-auto">{client.length}</Badge>
        </div>
        <p className="text-[11px] text-muted-foreground">Shared by every agent on this client. Persistent — no need to attach them per message.</p>
        <AddRefRow scope="client" clientId={clientId} onAdd={(r) => saveClient.mutate(r as any)} />
        {client.length > 0 && (
          <ul className="space-y-1.5 mt-2">
            {client.map(r => <RefRow key={r.id} r={r} onDelete={() => delClient.mutate({ id: r.id, client_id: clientId })} />)}
          </ul>
        )}
      </Card>
    </div>
  );
}