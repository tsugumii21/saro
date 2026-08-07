import { useEffect, useRef, useState } from "react";
import { Copy, Check, Download, QrCode } from "lucide-react";
import QRCodeLib from "qrcode";
import { TrackingCode } from "@saro/ui";

/**
 * The receipt.
 *
 * Every report that lands — Panic, Describe, queued-then-delivered — ends here,
 * because a tracking code the person cannot keep hold of is the same as no
 * tracking code. Four ways off this screen with the code intact:
 *
 *   read it   set large in the disambiguated mono, so it survives being read
 *             aloud down a phone line
 *   copy it   one tap
 *   scan it   a QR the person beside you can photograph off your screen
 *   keep it   a PNG in the camera roll, which is the only one that survives a
 *             dead battery and a borrowed phone
 *
 * The ticket image is drawn on a canvas rather than screenshotted, so it is
 * legible at whatever size a messaging app compresses it to, and carries the
 * code as text as well as in the QR — a QR that will not scan is not a
 * fallback, and a photo of a screen is exactly where scanning fails.
 */

const TICKET_W = 1080;
const TICKET_H = 1350;   // 4:5, the tallest a phone gallery shows uncropped

function trackUrl(code) {
  return `${window.location.origin}/track?code=${encodeURIComponent(code)}`;
}

export default function ReportTicket({ code, categoryLabel, filedAt, tone = "standard" }) {
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState("");
  const qrRef = useRef(null);

  const accent = tone === "panic" ? "var(--color-panic)" : "var(--color-brand)";

  useEffect(() => {
    if (!code || !qrRef.current) return;
    QRCodeLib.toCanvas(qrRef.current, trackUrl(code), {
      width: 132,
      margin: 0,
      // Highest error correction: this gets scanned off a cracked screen, in
      // rain, at an angle, by someone in a hurry.
      errorCorrectionLevel: "H",
      color: { dark: "#101725", light: "#FFFFFF" },
    }).catch(() => {});
  }, [code]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Clipboard API refused (insecure context, or an older browser). Select
      // it instead so the person can copy by hand rather than being told
      // nothing happened.
      const range = document.createRange();
      const node = document.getElementById("ticket-code");
      if (node) {
        range.selectNodeContents(node);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };

  const saveImage = async () => {
    setSaving(true);
    setSaveNote("");
    try {
      const blob = await drawTicket({ code, categoryLabel, filedAt, tone });
      const file = new File([blob], `SARO-${code}.png`, { type: "image/png" });

      // Share sheet first: on a phone this offers "Save Image" alongside
      // sending it to whoever is helping you, which is the actual use.
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `SARO report ${code}` });
        setSaveNote("Saved.");
        return;
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `SARO-${code}.png`;
      link.click();
      URL.revokeObjectURL(url);
      setSaveNote("Downloaded.");
    } catch (err) {
      // AbortError means the person dismissed the share sheet. That is a
      // decision, not a failure, and telling them it failed would be wrong.
      if (err?.name !== "AbortError") setSaveNote("Could not save the image. The code above still works.");
    } finally {
      setSaving(false);
      setTimeout(() => setSaveNote(""), 4000);
    }
  };

  return (
    <div className="saro-clip saro-card overflow-hidden" style={{ borderColor: accent }}>
      <div className="flex items-start justify-between gap-4 border-b border-rule p-5">
        <div className="min-w-0">
          <span className="t-label text-ink-faint">Your tracking code</span>
          <div className="mt-2" id="ticket-code">
            <TrackingCode code={code} size="xl" />
          </div>
          {categoryLabel && <p className="t-body-sm mt-2 text-ink-muted">{categoryLabel}</p>}
        </div>
        <canvas
          ref={qrRef}
          width={132}
          height={132}
          className="shrink-0 border border-line bg-surface p-1.5"
          aria-label={`QR code linking to report ${code}`}
        />
      </div>

      <div className="flex flex-col gap-2 p-5">
        <div className="flex gap-2">
          <button type="button" onClick={copy} className="saro-btn saro-btn-secondary saro-btn-lg flex-1">
            {copied ? <Check width={16} height={16} /> : <Copy width={16} height={16} />}
            {copied ? "Copied" : "Copy code"}
          </button>
          <button
            type="button"
            onClick={saveImage}
            disabled={saving}
            className="saro-btn saro-btn-secondary saro-btn-lg flex-1"
          >
            <Download width={16} height={16} />
            {saving ? "Saving…" : "Save to Photos"}
          </button>
        </div>

        {saveNote && <p className="t-body-sm text-ink-muted" role="status">{saveNote}</p>}

        <p className="t-body-sm flex items-start gap-2 text-ink-faint">
          <QrCode width={14} height={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          Anyone helping you can scan this to see the status. It shows the status only —
          never your description, photo, or number.
        </p>
      </div>
    </div>
  );
}

/* ── The saved image ─────────────────────────────────────────────────────── */

/**
 * Draw the ticket at print size on an offscreen canvas.
 *
 * Rebuilt rather than rasterised from the DOM because the saved artefact has a
 * different job from the on-screen card: it will be looked at months later, out
 * of context, possibly by somebody else, after a messaging app has compressed
 * it. So the code is enormous, the QR is large enough to survive rescaling, and
 * the instruction for what to do with it is printed on the image itself.
 */
async function drawTicket({ code, categoryLabel, filedAt, tone }) {
  const canvas = document.createElement("canvas");
  canvas.width = TICKET_W;
  canvas.height = TICKET_H;
  const ctx = canvas.getContext("2d");

  const INK = "#101725";
  const MUTED = "#4E596E";
  const FAINT = "#7C879B";
  const RULE = "#A9CFE3";
  const accent = tone === "panic" ? "#E2231A" : "#1B2E6B";

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, TICKET_W, TICKET_H);

  // The index edge, same device as every run card in the product.
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 24, TICKET_H);

  const M = 96;

  ctx.fillStyle = accent;
  ctx.font = "700 40px 'Atkinson Hyperlegible', system-ui, sans-serif";
  ctx.fillText("SARO", M, 132);

  ctx.fillStyle = FAINT;
  ctx.font = "600 26px 'Public Sans', system-ui, sans-serif";
  ctx.fillText("LEGAZPI CITY  ·  ONE PLACE TO REPORT", M, 176);

  ctx.strokeStyle = RULE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(M, 220);
  ctx.lineTo(TICKET_W - M, 220);
  ctx.stroke();

  ctx.fillStyle = FAINT;
  ctx.font = "700 26px 'Public Sans', system-ui, sans-serif";
  ctx.fillText("TRACKING CODE", M, 296);

  // The reason this image exists.
  ctx.fillStyle = INK;
  ctx.font = "700 132px 'Atkinson Hyperlegible Mono', ui-monospace, monospace";
  ctx.fillText(code, M, 420);

  let y = 500;
  if (categoryLabel) {
    ctx.fillStyle = MUTED;
    ctx.font = "500 32px 'Public Sans', system-ui, sans-serif";
    ctx.fillText(categoryLabel.slice(0, 46), M, y);
    y += 52;
  }
  if (filedAt) {
    ctx.fillStyle = FAINT;
    ctx.font = "500 28px 'Public Sans', system-ui, sans-serif";
    ctx.fillText(
      `Filed ${new Date(filedAt).toLocaleString("en-PH", { dateStyle: "long", timeStyle: "short" })}`,
      M, y
    );
  }

  const qrDataUrl = await QRCodeLib.toDataURL(trackUrl(code), {
    width: 520,
    margin: 1,
    errorCorrectionLevel: "H",
    color: { dark: "#101725", light: "#FFFFFF" },
  });

  const qrImage = new Image();
  await new Promise((resolve, reject) => {
    qrImage.onload = resolve;
    qrImage.onerror = reject;
    qrImage.src = qrDataUrl;
  });

  const qrSize = 520;
  ctx.drawImage(qrImage, (TICKET_W - qrSize) / 2, 640, qrSize, qrSize);

  ctx.textAlign = "center";
  ctx.fillStyle = MUTED;
  ctx.font = "500 30px 'Public Sans', system-ui, sans-serif";
  ctx.fillText("Scan, or enter the code at", TICKET_W / 2, 1230);

  ctx.fillStyle = INK;
  ctx.font = "700 32px 'Public Sans', system-ui, sans-serif";
  ctx.fillText(`${window.location.host} → Check a report`, TICKET_W / 2, 1276);

  ctx.textAlign = "left";

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))), "image/png");
  });
}
