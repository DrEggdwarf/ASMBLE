# ── ASMBLE — Dockerfile ──────────────────────────────────
# Image all-in-one : frontend (Nginx) + backend (FastAPI) + toolchain (GDB, nasm, etc.)
#
# Build:   docker build -t asmble .
# Run:     docker run -p 8080:8080 asmble
# ─────────────────────────────────────────────────────────

# ── Stage 1: Build nsjail ───────────────────────────────
FROM ubuntu:24.04@sha256:186072bba1b2f436cbb91ef2567abca677337cfc786c86e107d25b7072feef0c AS nsjail-build

RUN apt-get update && apt-get install -y --no-install-recommends \
    autoconf bison flex gcc g++ git make pkg-config ca-certificates \
    protobuf-compiler libprotobuf-dev libnl-3-dev libnl-route-3-dev \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --recurse-submodules https://github.com/google/nsjail /nsjail \
    && cd /nsjail && make -j$(nproc) && strip nsjail

# ── Stage 2: Build frontend ─────────────────────────────
FROM node:22-slim@sha256:80fdb3f57c815e1b638d221f30a826823467c4a56c8f6a8d7aa091cd9b1675ea AS frontend-build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY index.html main.tsx index.ts manifest.json tsconfig.json vite.config.ts vite-plugin-asm-runner.ts ./
COPY src/ ./src/
ENV VITE_LIVE_MODE=true
RUN npm run build


# ── Stage 3: Runtime ─────────────────────────────────────
FROM ubuntu:24.04@sha256:186072bba1b2f436cbb91ef2567abca677337cfc786c86e107d25b7072feef0c

LABEL org.opencontainers.image.title="ASMBLE" \
      org.opencontainers.image.description="x86-64 assembly pedagogical debugger" \
      org.opencontainers.image.source="https://github.com/DrEggdwarf/ASMBLE" \
      org.opencontainers.image.licenses="MIT"

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Toolchain: GDB, assemblers, linker, curl (healthcheck) — single layer
RUN apt-get update && apt-get install -y --no-install-recommends \
    gdb \
    nasm \
    yasm \
    binutils \
    gcc \
    python3 \
    python3-pip \
    python3-venv \
    nginx \
    supervisor \
    git \
    curl \
    libglib2.0-0 \
    file \
    libnl-3-200 \
    libnl-route-3-200 \
    libprotobuf32t64 \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/*

# nsjail binary from build stage
COPY --from=nsjail-build /nsjail/nsjail /usr/local/bin/nsjail

# Python backend + pwndbg — single layer, purge git after clone
WORKDIR /app/backend
COPY backend/requirements.txt .
RUN python3 -m venv /app/venv \
    && /app/venv/bin/pip install --no-cache-dir -r requirements.txt \
    && git clone --depth 1 https://github.com/pwndbg/pwndbg /opt/pwndbg \
    && cd /opt/pwndbg \
    && /app/venv/bin/pip install --no-cache-dir -e . \
    && rm -rf /opt/pwndbg/.git /opt/pwndbg/.github /opt/pwndbg/tests \
              /opt/pwndbg/docs /root/.cache/pip \
    && find /app/venv -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true \
    && find /opt/pwndbg -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true \
    && apt-get purge -y git && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

COPY backend/ .

# Frontend static files
COPY --from=frontend-build /app/dist /app/frontend

# Nginx config
COPY docker/nginx.conf /etc/nginx/sites-available/default
RUN rm -f /etc/nginx/sites-enabled/default \
    && ln -s /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default \
    && sed -i 's|access_log /var/log/nginx/access.log;|access_log /dev/stdout;|' /etc/nginx/nginx.conf \
    && sed -i 's|error_log /var/log/nginx/error.log;|error_log /dev/stderr;|' /etc/nginx/nginx.conf

# Supervisord config
COPY docker/supervisord.conf /etc/supervisor/conf.d/asmble.conf

# Seccomp profile (referenced by docker-compose)
COPY docker/seccomp-profile.json /etc/asmble/seccomp-profile.json

# Non-root user for sandboxed code execution
# GDB needs ptrace — supervisor/nginx stay root, user code runs as asmble
ENV PWNDBG_VENV_PATH=/app/venv \
    PWNDBG_NO_AUTOUPDATE=1 \
    TERM=dumb

RUN useradd --system --create-home --home-dir /home/asmble --shell /usr/sbin/nologin asmble \
    && echo "set auto-load safe-path /" > /home/asmble/.gdbinit \
    && chown -R asmble:asmble /home/asmble \
    && chmod 750 /home/asmble \
    && mkdir -p /var/log/nginx /var/lib/nginx /run \
    && chown -R www-data:www-data /var/log/nginx /var/lib/nginx

# Ensure frontend is read-only
RUN chmod -R 444 /app/frontend && find /app/frontend -type d -exec chmod 555 {} +

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -sf http://localhost:8080/api/health || exit 1

EXPOSE 8080

CMD ["supervisord", "-n", "-c", "/etc/supervisor/conf.d/asmble.conf"]
