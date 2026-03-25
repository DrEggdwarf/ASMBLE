# ── ASMBLE — Dockerfile ──────────────────────────────────
# Image all-in-one : frontend (Nginx) + backend (FastAPI) + toolchain (GDB, nasm, etc.)
#
# Build:   docker build -t asmble .
# Run:     docker run -p 8080:8080 asmble
# ─────────────────────────────────────────────────────────

# ── Stage 1: Build frontend ─────────────────────────────
FROM node:22-slim AS frontend-build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY index.html main.tsx index.ts manifest.json tsconfig.json vite.config.ts vite-plugin-asm-runner.ts ./
COPY src/ ./src/
ENV VITE_LIVE_MODE=true
RUN npm run build


# ── Stage 2: Runtime ─────────────────────────────────────
FROM ubuntu:24.04

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
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/*

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
RUN useradd --system --create-home --home-dir /home/asmble --shell /usr/sbin/nologin asmble \
    && echo "source /opt/pwndbg/gdbinit.py" > /home/asmble/.gdbinit \
    && echo "set auto-load safe-path /" >> /home/asmble/.gdbinit \
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
