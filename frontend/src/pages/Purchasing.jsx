import { PageHeader } from "@/components/common";
import { ShoppingCart } from "lucide-react";

export default function Purchasing() {
  return (
    <div>
      <PageHeader title="Purchasing" subtitle="Modul pengadaan" />
      <div className="border border-dashed rounded-2xl p-12 text-center bg-card" data-testid="purchasing-placeholder">
        <ShoppingCart className="h-10 w-10 mx-auto text-primary" />
        <h2 className="text-lg font-bold mt-3">Segera hadir</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">Detail modul pengadaan (permintaan barang, PO, supplier, stok) menunggu konfirmasi kebutuhan dari tim Purchasing.</p>
      </div>
    </div>
  );
}
