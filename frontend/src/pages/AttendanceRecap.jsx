import { useEffect, useState } from "react";
import { api, todayWIB, addDays, openBlob, fmtDate, fmtTime } from "@/lib/api";
import { PageHeader, NativeSelect, Empty, StatusBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileSpreadsheet, FileText } from "lucide-react";

const PRESETS = { harian: 0, mingguan: 6, bulanan: 29 };

export default function AttendanceRecap() {
  const [end, setEnd] = useState(todayWIB());
  const [start, setStart] = useState(addDays(todayWIB(), -6));
  const [branch, setBranch] = useState("");
  const [branches, setBranches] = useState([]);
  const [rows, setRows] = useState([]);
  const [logs, setLogs] = useState([]);

  useEffect(() => { api.get("/branches").then((r) => setBranches(r.data)); }, []);
  useEffect(() => {
    const p = { start, end, branch_id: branch };
    api.get("/attendance/recap", { params: p }).then((r) => setRows(r.data));
    api.get("/attendance", { params: p }).then((r) => setLogs(r.data));
  }, [start, end, branch]);

  const q = `start=${start}&end=${end}&branch_id=${branch}`;
  return (
    <div>
      <PageHeader title="Rekap Absensi" subtitle="Per karyawan dan per cabang">
        <Button variant="outline" onClick={() => openBlob(`/attendance/export?${q}&fmt=xlsx`, `rekap-${start}.xlsx`)} data-testid="export-xlsx-btn"><FileSpreadsheet className="h-4 w-4 mr-2" />Excel</Button>
        <Button variant="outline" onClick={() => openBlob(`/attendance/export?${q}&fmt=pdf`, `rekap-${start}.pdf`)} data-testid="export-pdf-btn"><FileText className="h-4 w-4 mr-2" />PDF</Button>
      </PageHeader>
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        {Object.entries(PRESETS).map(([k, v]) => (
          <Button key={k} size="sm" variant="secondary" onClick={() => { setEnd(todayWIB()); setStart(addDays(todayWIB(), -v)); }} data-testid={`preset-${k}`}>{k[0].toUpperCase() + k.slice(1)}</Button>
        ))}
        <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="w-40" data-testid="recap-start" />
        <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="w-40" data-testid="recap-end" />
        <NativeSelect className="w-44" testid="recap-branch" value={branch} onChange={setBranch} options={[{ value: "", label: "Semua cabang" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
      </div>
      <Tabs defaultValue="recap">
        <TabsList><TabsTrigger value="recap">Rekap</TabsTrigger><TabsTrigger value="detail" data-testid="tab-detail">Detail log</TabsTrigger><TabsTrigger value="master" data-testid="tab-master">Penggunaan HP Master</TabsTrigger></TabsList>
        <TabsContent value="recap">
          <div className="border rounded-xl overflow-x-auto bg-card">
            <table className="w-full text-sm" data-testid="recap-table">
              <thead className="bg-muted text-xs uppercase text-muted-foreground"><tr className="text-left">{["Nama", "Hadir", "Telat", "Izin", "Sakit", "Cuti", "Alpha", "Via Master", "Blok Lembur"].map((h) => <th key={h} className="p-3">{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.user_id} className="border-t">
                    <td className="p-3 font-medium">{r.name}<div className="text-xs text-muted-foreground">{r.position}</div></td>
                    <td className="p-3">{r.hadir}</td><td className="p-3">{r.telat}</td><td className="p-3">{r.izin}</td><td className="p-3">{r.sakit}</td>
                    <td className="p-3">{r.cuti}</td><td className={`p-3 ${r.alpha ? "text-destructive font-semibold" : ""}`}>{r.alpha}</td><td className="p-3">{r.via_master}</td><td className="p-3">{r.ot_blocks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <Empty />}
          </div>
        </TabsContent>
        {["detail", "master"].map((tab) => (
          <TabsContent key={tab} value={tab}>
            <div className="space-y-2">
              {logs.filter((l) => tab === "detail" || l.via_master).map((l) => (
                <div key={l.id} className="border rounded-xl p-3 bg-card text-sm flex flex-wrap justify-between gap-2">
                  <div><b>{l.user_name}</b> · {fmtDate(l.date)} · {l.shift_name || "Tanpa jadwal"}</div>
                  <div className="text-muted-foreground">Masuk {fmtTime(l.clock_in?.time)} ({l.clock_in?.distance_m} m, skor {l.clock_in?.face_score}) · Pulang {l.clock_out ? fmtTime(l.clock_out.time) : "-"}</div>
                  <div className="flex gap-1"><StatusBadge status={l.status} />{l.via_master && <StatusBadge tone="info">via HP Master{l.clock_in?.reason ? `: ${l.clock_in.reason}` : ""}</StatusBadge>}</div>
                </div>
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
