#!/usr/bin/env bash
# kitbash-forge bootstrap — run on a fresh pod; everything heavy lands on /workspace (network volume).
# Weights cache in /workspace/hf survives pod termination; pip deps reinstall fast from /workspace/pip-cache.
set -euo pipefail
export HF_HOME=/workspace/hf
export PIP_CACHE_DIR=/workspace/pip-cache
mkdir -p /workspace/in /workspace/out /workspace/hf /workspace/pip-cache

# PEP 668: the image's system python is externally managed. A venv on the volume
# (inheriting the image's Blackwell-correct torch via system-site-packages)
# persists across pod sessions and keeps pip happy.
if [ ! -d /workspace/venv ]; then
  python3 -m venv --system-site-packages /workspace/venv
fi
source /workspace/venv/bin/activate

if [ ! -d /workspace/Hunyuan3D-2 ]; then
  git clone --depth 1 https://github.com/Tencent-Hunyuan/Hunyuan3D-2.git /workspace/Hunyuan3D-2
fi

cd /workspace/Hunyuan3D-2
# The image's torch 2.9.1+cu128 is the Blackwell-correct build — never let requirements replace it.
grep -viE '^(torch|torchvision|torchaudio)' requirements.txt > /tmp/req-notorch.txt
pip install -q numpy -r /tmp/req-notorch.txt
# The image ships torch 2.9.1+cu128 but no torchvision; 0.24.1 is its pair.
pip install -q torchvision==0.24.1 --index-url https://download.pytorch.org/whl/cu128 --no-deps
pip install -q -e . --no-deps

echo "BOOTSTRAP_OK"
