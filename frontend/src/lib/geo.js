export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toR = (d) => (d * Math.PI) / 180;
  const dp = toR(lat2 - lat1);
  const dl = toR(lng2 - lng1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function securityFlags(pos) {
  const f = [];
  if (navigator.webdriver) f.push("otomasi_browser_terdeteksi");
  if (pos && pos.coords.accuracy === 0) f.push("kemungkinan_mock_location");
  return f;
}

export function watchGps(onPos, onErr) {
  if (!navigator.geolocation) {
    onErr("Perangkat tidak mendukung GPS");
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(onPos, (e) => onErr(e.code === 1 ? "Izin lokasi ditolak. Aktifkan izin lokasi." : "Lokasi tidak dapat dibaca"), {
    enableHighAccuracy: true, maximumAge: 5000, timeout: 20000,
  });
  return () => navigator.geolocation.clearWatch(id);
}
