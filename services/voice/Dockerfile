# LearnThrive AI's speech sidecar (development): speech recognition (faster-whisper) and speech output (Piper) behind HTTP.
# Started by `npm run dev` through config/compose.yaml. The voices are mounted from services/voice/models, not baked in.
FROM python:3.13-slim-bookworm

COPY --from=ghcr.io/astral-sh/uv:0.10.11 /uv /usr/local/bin/uv

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_NO_CACHE=1 UV_PROJECT_ENVIRONMENT=/opt/venv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
# The CUDA libraries recognition needs on the GPU (the versions the Windows setup was measured with). Without a GPU it uses the CPU.
RUN uv pip install --python /opt/venv/bin/python nvidia-cublas-cu12==12.9.2.10 nvidia-cudnn-cu12==9.27.0.42 nvidia-cuda-nvrtc-cu12==12.9.86
COPY server.py ./

ENV PATH=/opt/venv/bin:$PATH \
    LD_LIBRARY_PATH=/opt/venv/lib/python3.13/site-packages/nvidia/cublas/lib:/opt/venv/lib/python3.13/site-packages/nvidia/cudnn/lib:/opt/venv/lib/python3.13/site-packages/nvidia/cuda_nvrtc/lib \
    VOICE_HOST=0.0.0.0 VOICE_PORT=8765 VOICE_STT_DEVICE=auto PYTHONUNBUFFERED=1
EXPOSE 8765
CMD ["python", "server.py"]
