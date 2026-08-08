#!/usr/bin/env node
/**
 * WCAG 2.2 AA contrast audit, computed from the real token values.
 *
 * Run: npm run audit:contrast
 *
 * Checks every ink/brand/status/alert token against every surface token in the
 * system, using the WCAG relative-luminance formula — not a visual judgement.
 * Normal text needs 4.5:1; large text and meaningful non-text graphics need
 * 3:1.
 *
 * This exists because the eye is a bad instrument for this. `--color-ink-faint`
 * looked perfectly readable and was 3.62:1 on white — a real AA failure across
 * 146 usages, nearly all of them 10-11px labels, which is exactly the text that
 * can least afford it. It was found by running this, not by looking.
 *
 * Some combinations are reported below threshold and are fine, because they do
 * not occur: --color-panic is never used as text (it is a fill with white on
 * it, 4.68:1, or a map line, which is a graphic needing only 3:1), and
 * text-alert / text-brand-bright never sit on bg-sunken. Before "fixing" a
 * failure here, grep for whether the pairing actually exists.
 */

import { readFileSync } from "node:fs";
const css = readFileSync("packages/shared/src/styles/tokens.css","utf8");
const tokens = {};
for (const m of css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})/g)) tokens[m[1]] = m[2];

const lin = c => { c/=255; return c<=0.04045 ? c/12.92 : ((c+0.055)/1.055)**2.4; };
const L = hex => { const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b); };
const ratio = (a,b) => { const l1=L(a),l2=L(b); return ((Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)); };

const SURFACES = { surface:"#FFFFFF", canvas: tokens.canvas, raised: tokens.raised, sunken: tokens.sunken };

// Foreground tokens that carry TEXT, and where they realistically sit.
const TEXT = [
  ["ink","body text"], ["ink-muted","secondary text"], ["ink-faint","labels/captions"],
  ["brand","links, headings"], ["brand-bright","interactive"], ["brand-strong","emphasis"],
  ["alert","errors"], ["panic","panic label"], ["panic-strong","panic emphasis"], ["panic-deep","panic body"],
  ["status-received-ink","status text"], ["status-assigned-ink","status text"],
  ["status-progress-ink","status text"], ["status-resolved-ink","status text"],
  ["status-closed-ink","status text"], ["status-reopened-ink","status text"],
];

console.log("WCAG 2.2 AA — normal text needs 4.5:1, large text 3:1\n");
let fails = [];
for (const [tok,use] of TEXT) {
  const fg = tokens[tok]; if (!fg) { console.log(`  ?? --color-${tok} not found`); continue; }
  const row = [];
  for (const [sname, s] of Object.entries(SURFACES)) {
    const r = ratio(fg, s);
    row.push(`${sname} ${r.toFixed(2)}${r>=4.5?"":r>=3?"~":"✗"}`);
    if (r < 4.5) fails.push({tok, use, sname, r:+r.toFixed(2), fg, bg:s});
  }
  console.log(`  ${("--color-"+tok).padEnd(30)} ${row.join("  ")}`);
}

console.log("\nStatus tag: ink on its own wash");
for (const s of ["received","assigned","progress","resolved","closed","reopened"]) {
  const fg = tokens[`status-${s}-ink`], bg = tokens[`status-${s}-wash`];
  const tab = tokens[`status-${s}-tab`];
  const r = ratio(fg,bg), rt = ratio(tab,"#FFFFFF");
  console.log(`  ${s.padEnd(10)} ink/wash ${r.toFixed(2)}${r>=4.5?" ok":" ✗"}   tab/white ${rt.toFixed(2)}${rt>=3?" ok(graphic)":" ✗"}`);
  if (r<4.5) fails.push({tok:`status-${s}-ink`,use:"status tag",sname:`status-${s}-wash`,r:+r.toFixed(2),fg,bg});
  if (rt<3) fails.push({tok:`status-${s}-tab`,use:"status tab (non-text graphic, needs 3:1)",sname:"surface",r:+rt.toFixed(2),fg:tab,bg:"#FFFFFF"});
}

console.log("\nWhite text on filled backgrounds");
for (const t of ["brand","brand-strong","panic","panic-strong","alert","ink"]) {
  const r = ratio("#FFFFFF", tokens[t]);
  console.log(`  white on --color-${t.padEnd(16)} ${r.toFixed(2)}${r>=4.5?" ok":" ✗"}`);
  if (r<4.5) fails.push({tok:`white on ${t}`,use:"button label",sname:t,r:+r.toFixed(2),fg:"#FFFFFF",bg:tokens[t]});
}

console.log("\nNon-text graphics (borders, rules) need 3:1 only where meaningful");
for (const t of ["line","line-strong","rule","brand-edge"]) {
  const r = ratio(tokens[t], "#FFFFFF");
  console.log(`  --color-${t.padEnd(14)} on white ${r.toFixed(2)}${r>=3?" ok":" (decorative only)"}`);
}

console.log(`\n${fails.length} combination(s) below threshold:`);
fails.forEach(f=>console.log(`  ✗ --color-${f.tok} on ${f.sname}: ${f.r}:1  (${f.use})  ${f.fg}/${f.bg}`));
