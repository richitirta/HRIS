import { useState } from "react";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { api, errMsg, ROLE_LABEL, SEGMENT_LABEL, deviceId } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader, Field, StatusBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

export default function Profile() {
  const { user } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const [pw, setPw] = useState({ old_password: "", new_password: "" });
  const [reason, setReason] = useState("");
  const change = async () => {
    try { await api.post("/auth/change-password", pw); toast.success("Password diganti"); setPw({ old_password: "", new_password: "" }); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const reqReset = async () => {
    try { await api.post("/device-resets", { user_id: user.id, reason }); toast.success("Permintaan reset device dikirim ke HRD"); setReason(""); }
    catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Profil" />
      <div className="border rounded-2xl p-5 bg-card grid sm:grid-cols-2 gap-3 text-sm" data-testid="profile-card">
        <div><div className="text-muted-foreground text-xs">Nama</div><div className="font-semibold">{user.name}</div></div>
        <div><div className="text-muted-foreground text-xs">Email</div><div className="font-semibold">{user.email}</div></div>
        <div><div className="text-muted-foreground text-xs">Role</div><div className="font-semibold">{ROLE_LABEL[user.role]}</div></div>
        <div><div className="text-muted-foreground text-xs">Segmen / Jabatan</div><div className="font-semibold">{SEGMENT_LABEL[user.segment]} · {user.position}</div></div>
        <div><div className="text-muted-foreground text-xs">Face ID</div>{user.face_enrolled ? <StatusBadge tone="success">Terdaftar</StatusBadge> : <StatusBadge tone="warning">Belum terdaftar</StatusBadge>}</div>
        <div><div className="text-muted-foreground text-xs">HP terdaftar</div><div className="font-mono text-xs break-all">{user.device_id || "-"}</div><div className="text-[11px] text-muted-foreground">HP ini: <span className="font-mono">{deviceId()}</span></div></div>
      </div>
      <div className="border rounded-2xl p-5 bg-card flex items-center justify-between">
        <div><div className="font-semibold">Mode gelap</div><div className="text-sm text-muted-foreground">Nyaman dipakai di area minim cahaya</div></div>
        <Switch checked={resolvedTheme === "dark"} onCheckedChange={(v) => setTheme(v ? "dark" : "light")} data-testid="profile-dark-switch" />
      </div>
      <div className="border rounded-2xl p-5 bg-card space-y-3">
        <div className="font-semibold">Ganti password</div>
        <Input type="password" placeholder="Password lama" value={pw.old_password} onChange={(e) => setPw({ ...pw, old_password: e.target.value })} data-testid="old-password" />
        <Input type="password" placeholder="Password baru (min. 8 karakter)" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} data-testid="new-password" />
        <Button onClick={change} data-testid="change-password-btn">Simpan</Button>
      </div>
      <div className="border rounded-2xl p-5 bg-card space-y-3">
        <div className="font-semibold">Ganti HP (Reset Device)</div>
        <p className="text-sm text-muted-foreground">Jika akan pindah HP, ajukan reset. Setelah disetujui HRD/Management, login di HP baru akan mendaftarkannya otomatis.</p>
        <Field label="Alasan"><Input value={reason} onChange={(e) => setReason(e.target.value)} data-testid="reset-reason" /></Field>
        <Button variant="outline" disabled={!reason.trim()} onClick={reqReset} data-testid="request-reset-btn">Ajukan reset device</Button>
      </div>
    </div>
  );
}
