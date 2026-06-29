import { useRef } from "react";
import { Upload, FileText, Trash2, Crown, User, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  useAgencyAgentFiles,
  useUploadAgencyAgentFile,
  useDeleteAgencyAgentFile,
  useAgentFileSignedUrl,
  totalTokensForFiles,
} from "@/hooks/useAgencyAgentFiles";
import { getModelInfo } from "@/lib/modelRegistry";

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function AgentFilesUploader({
  agentId,
  agentModel,
  clientId,
  scopeLabel,
}: {
  agentId: string;
  agentModel: string;
  clientId: string | null;
  scopeLabel: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: files = [], isLoading } = useAgencyAgentFiles(agentId, clientId);
  const upload = useUploadAgencyAgentFile();
  const del = useDeleteAgencyAgentFile();
  const signUrl = useAgentFileSignedUrl();

  const modelInfo = getModelInfo(agentModel);
  const capacity = Math.max(modelInfo?.contextTokens || 200_000, 1);
  const used = totalTokensForFiles(files);
  const pct = Math.min(100, Math.round((used / capacity) * 100));

  const onPick = () => inputRef.current?.click();
  const onFiles = async (fl: FileList | null) => {
    if (!fl) return;
    for (const f of Array.from(fl)) {
      await upload.mutateAsync({ agentId, clientId, file: f });
    }
    if (inputRef.current) inputRef.current.value = "";
  };

  const openFile = async (path: string) => {
    const url = await signUrl.mutateAsync(path);
    window.open(url, "_blank");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <FileText className="h-4 w-4" /> Files
          <Badge variant="outline" className="text-[10px]">{scopeLabel}</Badge>
        </div>
        <Button size="sm" variant="outline" onClick={onPick} disabled={upload.isPending}>
          <Upload className="h-3.5 w-3.5 mr-1" /> Upload
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept=".pdf,.md,.docx,.txt,.json,.csv,.png,.jpg,.jpeg,.webp,.gif,.svg,.mp4,.mov,image/*"
          onChange={(e) => onFiles(e.target.files)}
        />
      </div>

      <div>
        <Progress value={pct} className="h-1.5" />
        <p className="text-[11px] text-muted-foreground mt-1">
          {pct}% of project capacity used · ~{used.toLocaleString()} / {capacity.toLocaleString()} tokens
          {modelInfo ? ` · ${modelInfo.label}` : ""}
        </p>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading files…</p>
      ) : files.length === 0 ? (
        <div
          onClick={onPick}
          className="border border-dashed rounded-lg p-6 text-center text-xs text-muted-foreground cursor-pointer hover:border-primary/40"
        >
          Drop or click to upload knowledge files & creative references (PDF, MD, DOCX, TXT, JSON, CSV, PNG, JPG, MP4).
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {files.map((f) => (
            <div key={f.id} className="border rounded-lg p-3 bg-card/50 group">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{f.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {fmtBytes(f.size_bytes)}
                    {f.lines ? ` · ${f.lines.toLocaleString()} lines` : ""}
                  </p>
                </div>
                <Badge variant={f.scope === "master" ? "default" : "secondary"} className="text-[9px] h-4">
                  {f.scope === "master" ? (
                    <><Crown className="h-2.5 w-2.5 mr-0.5" /> master</>
                  ) : (
                    <><User className="h-2.5 w-2.5 mr-0.5" /> client</>
                  )}
                </Badge>
              </div>
              <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition">
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => openFile(f.storage_path)}>
                  <ExternalLink className="h-3 w-3 mr-1" /> Open
                </Button>
                {(clientId ? f.scope === "client" : true) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[10px] text-destructive"
                    onClick={() => del.mutate({ id: f.id, storage_path: f.storage_path, agentId, clientId })}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}