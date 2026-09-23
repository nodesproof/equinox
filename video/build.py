#!/usr/bin/env python3
"""Trims each clip to its segment, muxes its narration, concatenates, burns the
captions and the route chip, and refuses to emit anything over 3:00."""
import json
import pathlib
import shutil
import subprocess
import sys

VIDEO = pathlib.Path(__file__).resolve().parent
OUT = VIDEO / "out"
SEG = OUT / "seg"
FINAL = OUT / "equinox-demo.mp4"
LIMIT_S = 180.0


def run(*args, cwd=None):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True, cwd=cwd)


def probe(path, entries="format=duration"):
    return subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", entries, "-of", "csv=p=0", str(path)], text=True
    ).strip()

CHAPTERS = {
    "01-problem": "Whose volatility is it?", "02-claim": "No IV oracle", "03-overview": "Live dashboard",
    "04-boards": "Boards, math parity, gas", "05-trade": "Trade from a browser wallet", "06-confirmed": "Confirmed on Arbiscan",
    "07-settlement": "First real settlement", "08-claim": "Claim", "09-honest-gas": "The honest gas numbers", "10-end": "Not 10×",
}


def write_youtube(timeline):
    """Title (≤ 80 chars), description and chapters (first at 0:00) for the upload, from the cut's own timeline."""
    title = "Equinox — on-chain ETH options on Arbitrum Stylus, no IV oracle"
    assert len(title) <= 80
    chapters = "\n".join(f"{int(r['startS'] // 60)}:{int(r['startS'] % 60):02d} {CHAPTERS.get(r['id'], r['id'])}" for r in timeline)
    (OUT / "youtube.md").write_text(f"""# {title}

Equinox is an options AMM for ETH on Arbitrum whose prices are computed entirely on-chain: Black-Scholes runs in Rust via Arbitrum Stylus, and the volatility it needs is derived on-chain from Chainlink prints — no IV oracle. Everything in this video is the live dashboard on Arbitrum Sepolia (testnet): USDG on pools A/B and the sequencer uptime feed are mocks; pool C settles in real Paxos USDG at faucet scale; the price feed is the real Chainlink ETH/USD.

Live: https://nodesproof.github.io/equinox/
Code: https://github.com/nodesproof/equinox (MIT)
Benchmark: https://github.com/nodesproof/equinox/blob/main/docs/BENCHMARK.md
Demo log (every transaction): https://github.com/nodesproof/equinox/blob/main/docs/DEMO_LOG.md

{chapters}
""")


def main():
    timeline = json.loads((OUT / "timeline.json").read_text())
    audio = {a["id"]: a for a in json.loads((OUT / "audio" / "index.json").read_text())}
    clips = {c["id"]: c for c in json.loads((OUT / "clips" / "index.json").read_text())}
    SEG.mkdir(exist_ok=True)
    parts = []
    for row in timeline:
        i, seg_s = row["id"], row["segmentS"]
        clip = OUT / "clips" / clips[i]["clip"]
        head_s = clips[i].get("headS", 0.0)   # lead-in (page loads before the narration clock) — cut here
        rec_s = float(probe(clip)) - head_s
        if rec_s + 0.05 < seg_s:
            sys.exit(f"{i}: clip is {rec_s:.2f}s but the segment needs {seg_s:.2f}s — re-record it (record.ts --only={i})")
        delay_ms = audio[i]["delayMs"]
        out = SEG / f"{i}.mp4"
        run(
            "-i", str(clip), "-i", str(OUT / "audio" / audio[i]["mp3"]),
            "-filter_complex",
            f"[0:v]trim=start={head_s}:duration={seg_s},setpts=PTS-STARTPTS,fps=30,scale=1920:1080:flags=lanczos,setsar=1[v];"
            f"[1:a]aresample=48000,adelay={delay_ms}|{delay_ms},apad,atrim=duration={seg_s},asetpts=PTS-STARTPTS[a]",
            "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", str(out),
        )
        parts.append(out)
        print(f"  {i}: {seg_s:.2f}s")
    lst = SEG / "list.txt"
    lst.write_text("".join(f"file '{p.name}'\n" for p in parts))
    concat = SEG / "concat.mp4"
    run("-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(concat))
    # burn captions: run from OUT so the ass filter gets a plain relative path
    run("-i", str(concat.relative_to(OUT)), "-vf", "ass=captions.ass",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
        "-c:a", "copy", "-movflags", "+faststart", FINAL.name, cwd=OUT)
    shutil.copy(OUT / "captions.srt", FINAL.with_suffix(".srt"))
    total = float(probe(FINAL))
    wh = probe(FINAL, "stream=width,height,r_frame_rate")
    run("-i", str(FINAL), "-vf", "fps=1/5,scale=480:-1,tile=6x6", str(OUT / "contact.png"))
    write_youtube(timeline)
    print(f"\n{FINAL.name}: {total:.1f}s, {wh}")
    if total > LIMIT_S:
        sys.exit(f"over the 3:00 ceiling by {total - LIMIT_S:.1f}s — apply the cut list in video/tts.py and re-run tts → record → captions → build")
    print("ok: under 3:00. Contact sheet:", OUT / "contact.png")


if __name__ == "__main__":
    main()
