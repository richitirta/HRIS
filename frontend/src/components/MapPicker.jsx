import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Circle, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";

const pin = L.divIcon({
  className: "",
  html: '<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;background:hsl(24 92% 48%);transform:rotate(-45deg);border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 22],
});

function Recenter({ lat, lng }) {
  const map = useMap();
  useEffect(() => { map.setView([lat, lng]); }, [lat, lng]);
  return null;
}

function ClickSet({ onChange }) {
  useMapEvents({ click: (e) => onChange && onChange(e.latlng.lat, e.latlng.lng) });
  return null;
}

export function BranchMap({ lat, lng, radius, onChange, height = 300, extra }) {
  return (
    <div className="rounded-xl overflow-hidden border" style={{ height }} data-testid="branch-map">
      <MapContainer center={[lat, lng]} zoom={18} style={{ height: "100%", width: "100%" }}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" maxZoom={19} />
        <Recenter lat={lat} lng={lng} />
        <ClickSet onChange={onChange} />
        <Marker position={[lat, lng]} icon={pin} draggable={!!onChange}
          eventHandlers={{ dragend: (e) => { const p = e.target.getLatLng(); onChange && onChange(p.lat, p.lng); } }} />
        <Circle center={[lat, lng]} radius={radius} pathOptions={{ color: "#E8650F", fillOpacity: 0.15 }} />
        {extra && <Circle center={[extra.lat, extra.lng]} radius={Math.max(extra.acc || 3, 2)} pathOptions={{ color: "#2563eb", fillOpacity: 0.3 }} />}
      </MapContainer>
    </div>
  );
}

export function AddressSearch({ onPick }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState([]);
  const search = async () => {
    if (!q.trim()) return;
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=id&q=${encodeURIComponent(q)}`);
    setRes(await r.json());
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari alamat cabang…" data-testid="address-search-input"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(); } }} />
        <Button type="button" variant="secondary" onClick={search} data-testid="address-search-btn"><Search className="h-4 w-4" /></Button>
      </div>
      {res.length > 0 && (
        <div className="border rounded-lg divide-y max-h-40 overflow-auto text-sm">
          {res.map((r) => (
            <button type="button" key={r.place_id} className="block w-full text-left px-3 py-2 hover:bg-accent"
              onClick={() => { onPick(parseFloat(r.lat), parseFloat(r.lon), r.display_name); setRes([]); }}>{r.display_name}</button>
          ))}
        </div>
      )}
    </div>
  );
}
