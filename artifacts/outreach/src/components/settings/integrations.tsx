import { Copy, Linkedin, Phone, PlugZap, Webhook } from "lucide-react";
import { useTestIntegration } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Panel, chColor } from "@/components/bits";

export type IntegrationForm = {
  unipileDsn: string; unipileApiKey: string; unipileAccountId: string; linkedinDailyLimit: number;
  voiceApiBaseUrl: string; voiceApiKey: string; voicePhoneNumberId: string; voiceName: string;
};

function Status({ on }: { on?: boolean }) {
  return <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${on ? "bg-[hsl(var(--ch-linkedin)/.14)] text-[hsl(var(--ch-linkedin))]" : "border border-dashed border-border text-muted-foreground"}`}>{on ? "Connected" : "Not connected"}</span>;
}

function TestButton({ provider, disabled }: { provider: "linkedin" | "voice"; disabled?: boolean }) {
  const test = useTestIntegration();
  const { toast } = useToast();
  return (
    <Button size="sm" variant="outline" disabled={disabled || test.isPending} data-testid={`button-test-${provider}`}
      onClick={() => test.mutate({ data: { provider } }, { onSuccess: (r) => toast({ title: r.ok ? "Connected" : "Connection failed", description: r.message, variant: r.ok ? undefined : "destructive" }) })}>
      <PlugZap className="mr-1 h-3.5 w-3.5" />{test.isPending ? "Testing..." : "Test saved settings"}
    </Button>
  );
}

export function LinkedinPanel({ f, set, connected, delay }: { f: IntegrationForm; set: (k: keyof IntegrationForm, v: string | number) => void; connected?: boolean; delay?: number }) {
  return (
    <Panel title="LinkedIn (via Unipile)" delay={delay} action={<Status on={connected} />}>
      <div className="grid gap-3 p-4">
        <div className="flex items-start gap-3 text-sm text-muted-foreground">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: chColor("linkedin", 0.12), color: chColor("linkedin") }}><Linkedin className="h-4 w-4" /></div>
          <p>Sends LinkedIn DMs to connections and connection requests with a note to everyone else. Create a Unipile account, connect your LinkedIn there and paste the details below.</p>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div><Label className="text-xs">DSN</Label><Input value={f.unipileDsn} onChange={(e) => set("unipileDsn", e.target.value)} placeholder="api8.unipile.com:13851" data-testid="input-unipile-dsn" /></div>
          <div><Label className="text-xs">Account id</Label><Input value={f.unipileAccountId} onChange={(e) => set("unipileAccountId", e.target.value)} data-testid="input-unipile-account" /></div>
          <div><Label className="text-xs">API key{connected && " (blank keeps current)"}</Label><Input type="password" value={f.unipileApiKey} onChange={(e) => set("unipileApiKey", e.target.value)} data-testid="input-unipile-key" /></div>
          <div><Label className="text-xs">Daily action limit</Label><Input type="number" min={1} value={f.linkedinDailyLimit} onChange={(e) => set("linkedinDailyLimit", Number(e.target.value))} data-testid="input-linkedin-limit" /></div>
        </div>
        <div><TestButton provider="linkedin" /></div>
      </div>
    </Panel>
  );
}

export function VoicePanel({ f, set, connected, delay }: { f: IntegrationForm; set: (k: keyof IntegrationForm, v: string | number) => void; connected?: boolean; delay?: number }) {
  return (
    <Panel title="AI voice agent" delay={delay} action={<Status on={connected} />}>
      <div className="grid gap-3 p-4">
        <div className="flex items-start gap-3 text-sm text-muted-foreground">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: chColor("call", 0.15), color: chColor("call") }}><Phone className="h-4 w-4" /></div>
          <p>The AI places cold calls from the call queue using the call script, then the transcript is summarized and a recap email goes out. Works with Vapi or any Vapi-compatible server (for example self-hosted OpenRing).</p>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="col-span-2"><Label className="text-xs">API base URL</Label><Input value={f.voiceApiBaseUrl} onChange={(e) => set("voiceApiBaseUrl", e.target.value)} data-testid="input-voice-base" /></div>
          <div><Label className="text-xs">API key{connected && " (blank keeps current)"}</Label><Input type="password" value={f.voiceApiKey} onChange={(e) => set("voiceApiKey", e.target.value)} data-testid="input-voice-key" /></div>
          <div><Label className="text-xs">Phone number id</Label><Input value={f.voicePhoneNumberId} onChange={(e) => set("voicePhoneNumberId", e.target.value)} data-testid="input-voice-number" /></div>
          <div className="col-span-2"><Label className="text-xs">Voice id (optional)</Label><Input value={f.voiceName} onChange={(e) => set("voiceName", e.target.value)} placeholder="Elliot" data-testid="input-voice-name" /></div>
        </div>
        <div><TestButton provider="voice" /></div>
      </div>
    </Panel>
  );
}

export function WebhooksPanel({ base, delay }: { base: string; delay?: number }) {
  const { toast } = useToast();
  const rows = [
    ["Generic inbound", `${base}/api/webhooks/inbound`, "Any provider: email, LinkedIn or SMS replies as JSON"],
    ["Unipile", `${base}/api/webhooks/unipile`, "Add as a messaging webhook in Unipile so LinkedIn replies arrive"],
    ["Voice", `${base}/api/webhooks/voice`, "Set automatically on each AI call"],
  ];
  return (
    <Panel title="Webhook endpoints" delay={delay}>
      <div className="divide-y divide-border">{rows.map(([name, url, hint]) => (
        <div key={name} className="space-y-1.5 p-4 text-sm">
          <div className="flex items-center justify-between"><b>{name}</b><span className="text-xs text-muted-foreground">{hint}</span></div>
          <div className="flex items-center gap-2 rounded-lg bg-foreground px-3 py-2 font-mono text-xs text-background">
            <Webhook className="h-3.5 w-3.5 text-primary" /><span className="opacity-60">POST</span><span className="flex-1 truncate" data-testid={`text-webhook-${name!.split(" ")[0]!.toLowerCase()}`}>{url}</span>
            <button onClick={() => { navigator.clipboard.writeText(url!); toast({ title: "Copied" }); }} data-testid={`button-copy-${name!.split(" ")[0]!.toLowerCase()}`}><Copy className="h-3.5 w-3.5" /></button>
          </div>
        </div>))}</div>
    </Panel>
  );
}
