import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, rupiah, fmtDateTime, SEGMENT_LABEL, ROLE_LABEL, isPic } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader, Stat, StatusBadge, Empty, NativeSelect } from "@/components/common";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, Pin } from "lucide-react";

const SEGS = ["", "depan", "dapur", "bar", "backoffice"];

function Section({ title, children, testid }) {
  return (
    <section className="rounded-2xl border bg-card p-5 rise" data-testid={testid}>
      <h3 className="font-semibold mb-3">{title}</h3>
      {children}
    </section>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [seg, setSeg] = useState("");
  const [branch, setBranch] = useState("");
  const [branches, setBranches] = useState([]);
  const [d, setD] = useState(null);
  const canSwitch = !isPic(user.role) && user.role !== "staff";

  useEffect(() => { api.get("/branches").then((r) => setBranches(r.data)); }, []);
  useEffect(() => { api.get("/dashboard", { params: { segment: seg, branch_id: branch } }).then((r) => setD(r.data)); }, [seg, branch]);
  if (!d) return <div className="text-muted-foreground">Memuat…</div>;

  const a = d.attendance;
  const reportsMissing = d.reports.filter((r) => !r.submitted);
  return (
    <div className="space-y-6">
      <PageHeader title={`Halo, ${user.name.split(" ")[0]}`} subtitle={`${ROLE_LABEL[user.role]} · Dashboard ${d.segment ? SEGMENT_LABEL[d.segment] : "Semua Segmen"}`}>
        {canSwitch && <NativeSelect testid="dash-branch-select" value={branch} onChange={setBranch} className="w-44"
          options={[{ value: "", label: "Semua cabang" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />}
        <Button onClick={() => nav("/absensi")} data-testid="dash-absen-btn">Absen sekarang</Button>
      </PageHeader>
      {canSwitch && (
        <Tabs value={seg} onValueChange={setSeg}>
          <TabsList className="flex-wrap h-auto" data-testid="dash-segment-tabs">
            {SEGS.map((s) => <TabsTrigger key={s} value={s} data-testid={`dash-seg-${s || "all"}`}>{s ? SEGMENT_LABEL[s] : "Semua"}</TabsTrigger>)}
          </TabsList>
        </Tabs>
      )}
      {d.pinned.map((p) => (
        <div key={p.id} className="rounded-xl border border-primary/30 bg-primary/5 p-4 flex gap-3" data-testid="pinned-announcement">
          <Pin className="h-4 w-4 text-primary mt-1 shrink-0" />
          <div><div className="font-semibold">{p.title}</div><div className="text-sm text-muted-foreground">{p.body}</div></div>
        </div>
      ))}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Hadir hari ini" value={`${a.present}/${a.scheduled}`} hint="hadir / terjadwal" testid="stat-present" />
        <Stat label="Telat" value={a.late} testid="stat-late" />
        <Stat label="Via HP Master" value={a.via_master} testid="stat-master" />
        <Stat label="Task menunggu verifikasi" value={d.tasks.pending_verification} testid="stat-verif" />
      </div>
      {(user.role === "management" || user.role === "hrd" || user.role === "spv" || user.role === "accounting") && (
        <Section title="Ringkasan lintas cabang" testid="branch-summary">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground uppercase"><tr className="text-left"><th className="py-2">Cabang</th><th>Hadir</th><th>Telat</th><th>Pemasukan (lap. PIC)</th><th>Laporan belum masuk</th></tr></thead>
              <tbody>
                {d.branches.map((b) => (
                  <tr key={b.branch_id} className="border-t">
                    <td className="py-2 font-medium">{b.name}</td><td>{b.present}/{b.scheduled}</td><td>{b.late}</td><td>{rupiah(b.income_today)}</td>
                    <td>{b.reports_missing ? <StatusBadge tone="danger">{b.reports_missing} belum</StatusBadge> : <StatusBadge tone="success">Lengkap</StatusBadge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
      <div className="grid lg:grid-cols-2 gap-6">
        <Section title="Laporan harian PIC" testid="report-status">
          {d.reports.length === 0 && <Empty text="Tidak ada PIC di segmen ini" />}
          <div className="space-y-2">
            {d.reports.map((r) => (
              <div key={r.pic_id + r.branch_id} className={`flex items-center justify-between rounded-lg p-3 border ${r.submitted ? "" : "border-destructive/40 bg-destructive/5"}`}>
                <div>
                  <div className="text-sm font-medium">{r.pic_name} <span className="text-muted-foreground font-normal">· {SEGMENT_LABEL[r.segment]} · {r.branch_name}</span></div>
                  {r.report && <div className="text-xs text-muted-foreground line-clamp-1">{r.report.work_done}</div>}
                </div>
                {r.submitted ? <CheckCircle2 className="h-5 w-5 text-[hsl(var(--success))]" /> : <span className="flex items-center gap-1 text-xs font-semibold text-destructive"><AlertTriangle className="h-4 w-4" />Belum diisi</span>}
              </div>
            ))}
          </div>
          {reportsMissing.length > 0 && <p className="text-xs text-destructive mt-2">{reportsMissing.length} laporan belum masuk hari ini</p>}
        </Section>
        <Section title="Kehadiran hari ini" testid="attendance-today">
          {a.list.length === 0 && <Empty text="Belum ada yang absen" />}
          <div className="divide-y">
            {a.list.map((p, i) => (
              <div key={i} className="flex items-center justify-between py-2 text-sm">
                <span className="font-medium">{p.name}</span>
                <span className="flex items-center gap-2 text-muted-foreground">{p.in}–{p.out || "…"} <StatusBadge status={p.status} />{p.via_master && <StatusBadge tone="info">Master</StatusBadge>}</span>
              </div>
            ))}
          </div>
        </Section>
        <Section title="Status task" testid="task-status">
          <div className="grid grid-cols-5 gap-2 mb-4">
            {Object.entries(d.tasks.counts).map(([k, v]) => (
              <div key={k} className="text-center rounded-lg bg-muted p-2"><div className="text-xl font-bold">{v}</div><StatusBadge status={k} /></div>
            ))}
          </div>
          {d.tasks.overdue.length > 0 && <div className="text-xs font-semibold text-destructive mb-2">Lewat deadline</div>}
          {d.tasks.overdue.map((t) => <div key={t.id} className="text-sm py-1 border-t">{t.title} <span className="text-xs text-muted-foreground">· {fmtDateTime(t.deadline)}</span></div>)}
        </Section>
        <Section title="Aktivitas PIC terbaru" testid="pic-activity">
          {d.activity.length === 0 && <Empty text="Belum ada aktivitas" />}
          <div className="space-y-2">
            {d.activity.map((x) => (
              <div key={x.id} className="text-sm flex justify-between gap-3 border-b last:border-0 pb-2">
                <span><b>{x.actor_name}</b> · {x.action.replaceAll("_", " ")}{x.detail?.title ? `: ${x.detail.title}` : ""}</span>
                <span className="text-xs text-muted-foreground whitespace-nowrap">{fmtDateTime(x.at)}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
