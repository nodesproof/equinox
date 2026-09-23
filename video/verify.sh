#!/usr/bin/env bash
# Checks before the video leaves this machine. Exit non-zero on the first failure.
set -euo pipefail
cd "$(dirname "$0")"
MP4=out/equinox-demo.mp4
echo "1. streams + duration (≤ 180 s)"
ffprobe -v error -show_entries stream=codec_type,codec_name,width,height,r_frame_rate:format=duration -of csv=p=0 "$MP4"
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$MP4")
python3 -c "import sys; d=float('$dur'); print(f'   {d:.1f}s'); sys.exit(0 if d <= 180 else 1)"
echo "2. caption cue counts (ass == srt)"
python3 - <<'PY'
import sys
a = open("out/captions.ass").read().count(",Cap,")
b = open("out/equinox-demo.srt").read().count("-->")
print(f"   ass={a} srt={b}"); sys.exit(0 if a == b and a > 0 else 1)
PY
echo "3. narrated values come from the take"
node --experimental-strip-types - <<'JS' 2>/dev/null
const { beats, readTake } = await import("./script.ts");
const { words, decimalWords } = await import("./lib.ts");
const t = readTake(), text = beats(t).map((b) => b.narration).join(" ");
const want = [words(t.liveSeries), words(t.gasCheck.ok), decimalWords(t.vrp)];
if (t.settlement.state === "settled") want.push(t.settlement.settledText, t.settlement.released, t.settlement.escrowed, ...(t.settlement.claim ? [t.settlement.claim.payout] : []));
const missing = want.filter((w) => !text.toLowerCase().includes(w.toLowerCase()));
console.log(`   ${want.length - missing.length}/${want.length} present · settlement ${t.settlement.state}` + (missing.length ? ` · MISSING ${JSON.stringify(missing)}` : ""));
process.exit(missing.length ? 1 : 0);
JS
echo "4. the on-camera transaction succeeded on chain"
hash=$(python3 -c "import json; print(json.load(open('out/tx.json'))['hash'])")
status=$(cast receipt "$hash" status --rpc-url "$(python3 -c "import json; print(json.load(open('../deployments/arbitrum-sepolia.json'))['rpc'])")")
echo "   $hash → $status"; [[ "$status" == 1* || "$status" == *success* ]]
echo "5. no media staged in git"
if git -C .. status --short | grep -E "\.(mp4|webm|mp3|png)$" | grep -v "^?? " ; then echo "   media staged!"; exit 1; else echo "   ok"; fi
echo "all checks passed"
