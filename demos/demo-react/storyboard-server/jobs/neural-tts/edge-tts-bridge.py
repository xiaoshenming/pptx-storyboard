#!/usr/bin/env python3
"""Stream Edge TTS audio and provider word boundaries to local files."""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

import edge_tts


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", required=True)
    parser.add_argument("--voice", required=True)
    parser.add_argument("--rate", default="+0%")
    parser.add_argument("--pitch", default="+0Hz")
    parser.add_argument("--media", required=True)
    parser.add_argument("--boundaries", required=True)
    return parser.parse_args()


async def synthesize(args: argparse.Namespace) -> None:
    media_path = Path(args.media)
    boundaries_path = Path(args.boundaries)
    communicator = edge_tts.Communicate(
        args.text,
        args.voice,
        rate=args.rate,
        pitch=args.pitch,
        boundary="WordBoundary",
    )
    boundaries: list[dict[str, object]] = []
    with media_path.open("wb") as media:
        async for chunk in communicator.stream():
            if chunk["type"] == "audio":
                media.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                boundaries.append(
                    {
                        "text": chunk["text"],
                        "startMs": round(chunk["offset"] / 10_000),
                        "endMs": round((chunk["offset"] + chunk["duration"]) / 10_000),
                    }
                )
    boundaries_path.write_text(
        json.dumps(boundaries, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


if __name__ == "__main__":
    asyncio.run(synthesize(parse_args()))
