import { useEffect, useRef, useState } from "react";
import * as faceapi from "@vladmandic/face-api";
import { Button } from "@/components/ui/button";
import { Loader2, ScanFace, RotateCcw } from "lucide-react";

const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model";
let modelsPromise = null;
const loadModels = () => {
  if (!modelsPromise) {
    modelsPromise = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]).catch((e) => { modelsPromise = null; throw e; });
  }
  return modelsPromise;
};

const STEPS = { left: "Tolehkan kepala perlahan ke KIRI", right: "Sekarang tolehkan ke KANAN", center: "Hadap lurus ke kamera", done: "Wajah terverifikasi" };

function yaw(lm) {
  const jaw = lm.getJawOutline();
  const nose = lm.getNose()[3];
  return (nose.x - jaw[0].x) / (jaw[16].x - jaw[0].x);
}

// Camera face capture with head-turn liveness challenge; returns {descriptor, photo, liveness}
export default function FaceCapture({ onResult, busy }) {
  const video = useRef(null);
  const stream = useRef(null);
  const [state, setState] = useState("loading");
  const [step, setStep] = useState("left");
  const [msg, setMsg] = useState("");
  const seen = useRef({ left: false, right: false });

  const stop = () => stream.current?.getTracks().forEach((t) => t.stop());

  const start = async () => {
    setState("loading");
    setStep("left");
    seen.current = { left: false, right: false };
    try {
      await loadModels();
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 480, height: 480 } });
      video.current.srcObject = stream.current;
      await video.current.play();
      setState("running");
    } catch (e) {
      setState("error");
      setMsg(e?.name === "NotAllowedError" ? "Izin kamera ditolak. Aktifkan izin kamera di browser." : "Kamera atau model wajah tidak dapat dimuat.");
    }
  };

  useEffect(() => {
    start();
    return stop;
  }, []);

  useEffect(() => {
    if (state !== "running") return undefined;
    let alive = true;
    const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
    const loop = async () => {
      if (!alive || !video.current) return;
      const det = await faceapi.detectSingleFace(video.current, opts).withFaceLandmarks();
      if (!det) setMsg("Wajah tidak terdeteksi");
      else {
        setMsg("");
        const y = yaw(det.landmarks);
        if (y < 0.36) seen.current.left = true;
        if (y > 0.64) seen.current.right = true;
        const s = !seen.current.left && !seen.current.right ? "left" : !(seen.current.left && seen.current.right) ? "right" : "center";
        setStep(s);
        if (s === "center" && y > 0.42 && y < 0.58) {
          const full = await faceapi.detectSingleFace(video.current, opts).withFaceLandmarks().withFaceDescriptor();
          if (full) {
            const c = document.createElement("canvas");
            c.width = video.current.videoWidth;
            c.height = video.current.videoHeight;
            c.getContext("2d").drawImage(video.current, 0, 0);
            const photo = c.toDataURL("image/jpeg", 0.7);
            alive = false;
            setStep("done");
            setState("captured");
            stop();
            onResult({ descriptor: Array.from(full.descriptor), photo, liveness: true });
            return;
          }
        }
      }
      setTimeout(loop, 180);
    };
    loop();
    return () => { alive = false; };
  }, [state]);

  return (
    <div className="space-y-3" data-testid="face-capture">
      <div className="relative aspect-square w-full max-w-xs mx-auto rounded-2xl overflow-hidden bg-black">
        <video ref={video} playsInline muted className="w-full h-full object-cover -scale-x-100" />
        <div className="absolute inset-6 rounded-full border-4 border-dashed border-white/50 pointer-events-none" />
        {state === "loading" && <div className="absolute inset-0 grid place-items-center text-white text-sm"><Loader2 className="h-6 w-6 animate-spin" /></div>}
      </div>
      <div className="text-center">
        <div className="font-semibold flex items-center justify-center gap-2" data-testid="face-step"><ScanFace className="h-4 w-4 text-primary" />{state === "error" ? "Kamera tidak tersedia" : STEPS[step]}</div>
        {msg && <div className="text-xs text-muted-foreground mt-1">{msg}</div>}
        {busy && <div className="text-xs text-primary mt-1">Memproses…</div>}
      </div>
      {(state === "error" || state === "captured") && !busy && (
        <Button variant="outline" className="w-full" onClick={start} data-testid="face-retry-btn"><RotateCcw className="h-4 w-4 mr-2" />Ulangi scan wajah</Button>
      )}
    </div>
  );
}
