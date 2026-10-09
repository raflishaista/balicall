"""Convert the same Indonesian checkpoint used by the research benchmark.

Run in the isolated speech environment after installing requirements-conversion.txt:
  python convert_small_id.py --output ./models/faster-whisper-small-id
Use --source with a pinned local checkpoint to reproduce a benchmark revision.
"""
import argparse
from pathlib import Path

import ctranslate2
from transformers import AutoTokenizer

parser = argparse.ArgumentParser()
parser.add_argument("--source", default="anggiatm/whisper-small-id")
parser.add_argument("--output", required=True)
args = parser.parse_args()
target = Path(args.output).resolve()
if target.exists():
    parser.error("Output already exists; choose a new directory")
converter = ctranslate2.converters.TransformersConverter(
    args.source, copy_files=["preprocessor_config.json"],
)
converter.convert(str(target), quantization="int8", force=False)
tokenizer = AutoTokenizer.from_pretrained(args.source, trust_remote_code=False)
tokenizer.backend_tokenizer.save(str(target / "tokenizer.json"))
print(f"Set WHISPER_SMALL_ID_PATH={target}")
