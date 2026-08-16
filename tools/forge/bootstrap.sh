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

# Instant Meshes: field-aligned quad remesh (CPU). The 2019 binary links X11
# libs even in batch mode, so install its runtime deps on the disposable pod.
if [ ! -x /workspace/bin/instant-meshes ]; then
  mkdir -p /workspace/bin
  curl -sL -o /tmp/im.zip https://instant-meshes.s3.eu-central-1.amazonaws.com/instant-meshes-linux.zip
  python3 -c "import zipfile; zipfile.ZipFile('/tmp/im.zip').extractall('/tmp/im')"
  mv "/tmp/im/Instant Meshes" /workspace/bin/instant-meshes
  chmod +x /workspace/bin/instant-meshes
fi
apt-get update -qq >/dev/null 2>&1 || true
apt-get install -y -qq libopengl0 libxxf86vm1 libxrandr2 libxinerama1 libxcursor1 libx11-6 \
  libxext6 libxrender1 libxfixes3 libxcb1 libxau6 libxdmcp6 >/dev/null 2>&1 || \
  echo "WARN: X11 runtime libs install failed - instant-meshes may not run"
# (--help exits non-zero, so probe linkability, not exit status)
if ldd /workspace/bin/instant-meshes 2>/dev/null | grep -q "not found"; then
  echo "WARN: instant-meshes is missing shared libs - quad remesh stage will fail"
fi

echo "BOOTSTRAP_OK"
