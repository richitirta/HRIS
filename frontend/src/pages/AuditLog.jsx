import { useEffect, useState } from "react";
import { api, fmtDateTime, ROLE_LABEL } from "@/lib/api";
import { PageHeader, Empty } from "@/components/common";
import { Input } from "@/components/ui/input";

export default function AuditLog() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  useEffect(() => {
    const t = setTimeout(() => api.get("/audit-logs", { params: { q } }).then((r) => setRows(r.data)), 300);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div>
      <PageHeader title="Audit Log" subtitle="Semua aksi penting tercatat: login, device, absensi, jadwal, approval, payroll">
        <Input placeholder="Filter aksi (mis. device, absen)" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" data-testid="audit-filter" />
      </PageHeader>
      <div className="border rounded-xl bg-card divide-y" data-testid="audit-list">
        {rows.length === 0 && <Empty />}
        {rows.map((r) => (
          <div key={r.id} className="p-3 text-sm flex flex-wrap gap-x-4 gap-y-1">
            <span className="text-muted-foreground w-44">{fmtDateTime(r.at)}</span>
            <span className="font-medium">{r.actor_name}</span>
            <span className="text-muted-foreground">{ROLE_LABEL[r.actor_role] || ""}</span>
            <span className="text-primary font-medium">{r.action.replaceAll("_", " ")}</span>
            <span className="text-xs text-muted-foreground font-mono truncate max-w-md">{JSON.stringify(r.detail)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
