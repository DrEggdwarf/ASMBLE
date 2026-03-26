# ASMBLE — Architecture & Roadmap

> Vision d'ensemble, architecture, phases de développement et choix techniques.

---

## Table des matières

1. [Vision](#vision)
2. [Architecture cible](#architecture-cible)
3. [Phases de développement](#phases-de-développement)
4. [Backend — GDB/MI Bridge](#backend--gdbmi-bridge)
5. [Frontend — React](#frontend--react)
6. [Conteneurisation Docker](#conteneurisation-docker)
7. [Sécurité & Sandbox](#sécurité--sandbox)
8. [Toolchain intégrée](#toolchain-intégrée)
9. [API WebSocket](#api-websocket)
10. [Choix techniques](#choix-techniques)

---

## Vision

ASMBLE est un débogeur pédagogique x86-64 interactif. Collez un snippet assembleur, steppez instruction par instruction, observez les registres, flags et la pile se modifier en temps réel — le tout dans le navigateur.

**Objectif** : un seul `docker run -p 8080:8080 asmble` pour avoir un environnement d'apprentissage complet.

```
 ┌──────────────────────────────────────────────────────────┐
 │  Browser — ASMBLE                                        │
 │  ┌──────────┬────────────────────┬─────────────────────┐  │
 │  │ Éditeur  │ Registres + Flags  │ Stack / Mémoire     │  │
 │  │ x86-64   │ (RegCard)          │ Référence / Eval    │  │
 │  │          │                    │ Console GDB         │  │
 │  ├──────────┴────────────────────┴─────────────────────┤  │
 │  │ Terminal (sortie programme / erreurs)                │  │
 │  └─────────────────────────────────────────────────────┘  │
 │                     │ WebSocket                           │
 │  ┌──────────────────▼──────────────────────────────────┐  │
 │  │  FastAPI + pygdbmi → GDB/MI3 → code sandboxé        │  │
 │  └─────────────────────────────────────────────────────┘  │
 └──────────────────────────────────────────────────────────┘
```

---

## Architecture cible

### Composants

| Composant | Technologie | Rôle |
|-----------|-------------|------|
| Frontend | React 19 + TypeScript 5.6 + Vite | UI interactive |
| Backend | FastAPI + pygdbmi | Bridge WebSocket ↔ GDB/MI |
| Debugger | GDB (MI3 protocol) | Exécution contrôlée |
| Assemblers | NASM, GAS, FASM, YASM | Assemblage multi-syntax |
| Proxy (prod) | Nginx | Reverse proxy, static files |
| Process mgr | supervisord | Orchestration en container |

### Flux de données

```
Navigateur                     Serveur                         Système
──────────                     ───────                         ───────
Éditeur → code source
             ─── WS { type: "assemble" } ──►
                                nasm/gas + ld → binaire ELF
                                GdbBridge.start() → GDB MI3
             ◄── WS { type: "session" } ────

Bouton "Step" →
             ─── WS { type: "step" } ──────►
                                GDB: -exec-next-instruction
                                parse registres + stack + flags
                                annotation pédagogique
             ◄── WS { type: "snapshot" } ───

Terminal ← sortie programme
             ◄── WS { type: "program_exit" } ─
```

---

## Phases de développement

### Phase 1 — Frontend mock ✅

Frontend complet avec données simulées :

- [x] Éditeur x86-64 avec syntax highlighting, linter, autocomplete
- [x] Tokenizer à 12 types de tokens + flèches de saut animées
- [x] Registres (RegCard) avec sous-registres cliquables (rax → eax/ax/ah/al)
- [x] r8–r15 dans section repliable (RegExtRow)
- [x] 7 flags CPU (ZF, CF, SF, OF, PF, AF, DF) avec état actif/inactif
- [x] Stack view avec marqueurs RSP/RBP
- [x] Historique d'exécution avec deltas de registres
- [x] Patterns C → ASM (17 patterns avec notes)
- [x] Lexique : ~45 instructions + ~15 syscalls avec recherche plein texte
- [x] Convention d'appel SysV AMD64 + 9 modes d'adressage
- [x] Toggle live/mock via `VITE_LIVE_MODE`
- [x] Layout 3 colonnes + terminal redimensionnables

### Phase 2 — Backend GDB/MI réel ✅

Bridge complet FastAPI ↔ GDB avec stepping temps réel :

- [x] FastAPI WebSocket endpoint (`/api/ws`)
- [x] pygdbmi → `StepSnapshot` bridge complet
- [x] Step, step over, step out, step back (reverse debug)
- [x] Continue (exécution jusqu'au breakpoint/fin)
- [x] Breakpoints conditionnels + watchpoints
- [x] Multi-assembleur (NASM, GAS, FASM, YASM)
- [x] Session management avec cleanup automatique (max 10 sessions)
- [x] Sandbox rlimit (CPU, mémoire, processus, I/O)
- [x] Annotations pédagogiques auto-générées (français)
- [x] Sortie programme capturée (stdout/stderr dans terminal)
- [x] Détection fin de programme + auto-reset
- [x] Résolution off-by-one sur highlight registres
- [x] Build & Run — exécution directe sans stepping
- [x] Évaluation d'expressions + commandes GDB brutes
- [x] Lecture de sections ELF + mémoire brute
- [x] Dockerfile + docker-compose + Nginx + supervisord
- [x] Profil seccomp pour production

### Phase 3a — Sécurité ✅

- [x] pwndbg installé dans Docker (`/opt/pwndbg`)
- [x] Checksec via pyelftools (NX, PIE, RELRO, canary)
- [x] vmmap via `/proc/pid/maps`
- [x] GOT entries (`.rela.plt` + `.got.plt`)
- [x] SecurityPanel.tsx (badges + tables)
- [x] Auto-checksec après assemblage

### Phase 3b — Outils d'exploitation ✅

- [x] Cyclic patterns (De Bruijn) — génération + recherche offset
- [x] ROP gadget search (ROPgadget)
- [x] Sous-section Exploit Tools dans SecurityPanel
- [x] **pwndbg natif** — cyclic/rop/telescope/search via GDB bridge (`pwndbg_tools.py`)
- [x] Fallback custom (`exploit_tools.py`) si pwndbg non disponible
- [x] `gdb_command_logged()` — capture fiable de la sortie async pwndbg (flush + drain + ANSI strip)
- [x] 2 nouveaux WS message types : `telescope`, `search`

### Phase 3c-3d — Futures 📋

- [ ] Heap visualizer (malloc/free tracking)
- [ ] Multi-architecture (ARM64, RISC-V via QEMU)
- [ ] Collaborative mode
- [ ] Exercices intégrés avec validation auto
- [x] Themes (dark/light) — Sprint 12 : variables CSS, thème clair GitHub-style, prefers-color-scheme
- [x] Responsive / compact mode — Sprint 12 : @media breakpoints 1200px/768px
- [x] Terminal interactif (stdin) — Sprint 12 : PTY pair, WS `send_stdin`
- [x] Terminal flottant — Sprint 12 : dock/float toggle
- [x] FAB (Floating Action Button) — Sprint 12 : menu radial actions rapides

---

## Backend — GDB/MI Bridge

### `GdbBridge` — Cœur du debugger

Pilote GDB/MI via pygdbmi. Toutes les opérations GDB sont exécutées via `asyncio.to_thread()` pour ne pas bloquer l'event loop FastAPI.

**Cycle de vie** :
1. `_assemble_sync()` — assemble le code source → binaire ELF
2. `start()` — lance GDB, breakpoint à `_start`, exec-run
3. `read_state()` → `StepSnapshot` (registres + flags + stack + disasm)
4. `step()` / `step_over()` / `step_out()` / `step_back()` → nouveau snapshot
5. `cleanup()` — kill GDB, supprime les fichiers temporaires

**Particularité off-by-one** : `_step_and_read()` capture `ip` et `instr` AVANT le step, puis `regs/changed` APRÈS. Ainsi le highlight vert correspond à l'instruction qui a causé les changements visibles.

**Caches performants** :
- Disassembly : mis en cache après le 1er chargement
- Stack : sauté si RSP est inchangé depuis le dernier read
- Backtrace : géré de même

### `SessionManager` — Gestion des sessions

- Une session par connexion WebSocket
- Limite configurable : `ASMBLE_MAX_SESSIONS` (défaut 10)
- Cleanup automatique via FastAPI lifespan context manager
- Workspace tmpdir par session (code + objet + binaire)

### `annotations.py` — Annotations pédagogiques

Génère automatiquement des explications FR pour chaque instruction :
- **14 générateurs dynamiques** : `mov`, `push`, `pop`, `add`, `sub`, `cmp`, `test`, `xor`, `call`, `ret`, `jmp`, `syscall`, `lea`, `nop`
- **~25 annotations statiques** : sauts conditionnels, opérations logiques, shifts, etc.
- **Flag hints** : résumé des flags actifs après les instructions arithmétiques

---

## Frontend — React

### Composant principal : `AsmDebugger`

Composant unique dans `App.tsx` (~800 lignes) gérant tout l'état :
- Code source, position courante, registres, flags, stack
- Historique des snapshots (navigation Back/Next)
- Terminal (sortie programme + erreurs + connexion)
- Breakpoints, watchpoints, évaluation, console GDB
- Modes d'affichage (hex/dec/bin), auto-step

### Hook `useGdbSession`

Machine à états pour la connexion WebSocket :
- `disconnected` → `connecting` → `connected` | `error`
- Gère `programExited` (empêche steps inutiles, auto-reset)
- Accumule `history` (tous les snapshots successifs)
- Sépare `evalResult`, `gdbOutput`, `programOutput`

### Éditeur (`AsmEditor`)

Pattern « textarea invisible + highlight overlay » :
- Tokenizer (12 types), linter temps réel, autocomplete
- Flèches de saut SVG avec algorithme de niveaux sans croisement
- Code folding par sections/procédures
- Find & replace (`Ctrl+H`)

---

## Conteneurisation Docker

```
Dockerfile (multi-stage, 3 stages)
├── Stage 1: ubuntu:24.04 → nsjail compilation
├── Stage 2: node:22-slim → npm ci + vite build
└── Stage 3: ubuntu:24.04 → python + GDB + nasm + pwndbg + nsjail + dist/

Ports:
  8080 → Nginx (proxy, reverse proxy + static files)
  8000 → FastAPI (backend, interne uniquement)
```

### Fichiers Docker

| Fichier | Rôle |
|---------|------|
| `Dockerfile` | Build multi-stage (node → ubuntu), OCI labels, HEALTHCHECK |
| `docker-compose.yml` | Orchestration avec hardening complet |
| `docker/nginx.conf` | Reverse proxy + security headers |
| `docker/supervisord.conf` | Gestion processus (nginx + uvicorn) |
| `docker/seccomp-profile.json` | Profil sécurité syscalls |

### Hardening Docker

| Mesure | Détail |
|--------|--------|
| Rootfs | `read_only: true` + tmpfs ciblés (`/tmp`, `/run`, `/var/log`, `/var/lib/nginx`) |
| Capabilities | `cap_drop: ALL` → seuls `SYS_PTRACE`, `DAC_OVERRIDE`, `CHOWN`, `SETUID`, `SETGID` |
| Privilege escalation | `no-new-privileges:true` |
| Resources | 2 CPU, 512 MB RAM |
| Nginx | `server_tokens off`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, dotfiles bloqués, `client_max_body_size 1m` |
| Logs | stdout/stderr (12-factor, pas de fichiers log) |
| HEALTHCHECK | `curl -sf http://localhost:8080/api/health` toutes les 30s |
| User isolation | Code utilisateur exécuté en tant que `asmble` (non-root, nologin) |
| Build hygiene | git purgé après clone pwndbg, `--no-install-recommends`, pip cache nettoyé, `__pycache__` supprimés |
| Frontend | `chmod 444` (read-only) dans l'image |
| OCI Labels | `title`, `description`, `source`, `licenses` |

---

## Sécurité & Sandbox

### Menaces et contre-mesures

| Menace | Contre-mesure |
|--------|---------------|
| Boucle infinie | `RLIMIT_CPU = 10s` (sandbox.py) |
| Allocation massive | `RLIMIT_AS = 256 MB` (sandbox.py) |
| Fork bomb | `RLIMIT_NPROC = 10` (sandbox.py) |
| Écriture disque | `RLIMIT_FSIZE = 1 MB` (sandbox.py) |
| Accès réseau | Docker network isolation |
| Syscalls dangereux | Profil seccomp restrictif |
| Escalade privilèges | User `asmble` (non-root), `no-new-privileges`, `cap_drop: ALL` |
| DoS WebSocket | Rate limiting token bucket (30 burst, 20/s refill) |
| Session flood | Max 10 sessions simultanées, auto-cleanup |

### Isolation Docker (production)

```bash
# Via docker-compose (recommandé) :
docker compose up --build

# Ou manuellement :
docker run \
  --read-only \
  --tmpfs /tmp:size=128m,exec \
  --tmpfs /run:size=8m \
  --tmpfs /var/log:size=32m \
  --tmpfs /var/lib/nginx:size=8m \
  --security-opt no-new-privileges:true \
  --cap-drop ALL \
  --cap-add SYS_PTRACE --cap-add DAC_OVERRIDE \
  --cap-add CHOWN --cap-add SETUID --cap-add SETGID \
  --memory=512m --cpus=2 \
  -p 8080:8080 asmble
```

---

## Toolchain intégrée

| Assembleur | Syntaxe | Commande | Extension |
|------------|---------|----------|-----------|
| **NASM** | Intel | `nasm -f elf64 -g -F dwarf` | `.asm` |
| GAS | AT&T | `as --64 -g` | `.s` |
| FASM | Intel (FASM) | `fasm` | `.asm` |
| YASM | Intel (NASM-compat) | `yasm -f elf64 -g dwarf2` | `.asm` |

NASM est l'assembleur par défaut. Le linker est toujours `ld -m elf_x86_64`.

---

## API WebSocket

### Client → Serveur (18 types)

| Type | Payload | Description |
|------|---------|-------------|
| `assemble` | `code`, `flavor` | Assemble + pause à `_start` |
| `run` | `code`, `flavor` | Assemble + exécute |
| `step` | — | Step instruction (stepi) |
| `step_over` | — | Step over (ne descend pas dans CALL) |
| `step_out` | — | Step out (finit la fonction) |
| `step_back` | — | Reverse step |
| `continue` | — | Continue jusqu'à breakpoint/fin |
| `reset` | — | Re-crée la session (même code) |
| `breakpoint_add` | `line`, `condition?` | Ajoute un breakpoint |
| `breakpoint_remove` | `line` | Supprime un breakpoint |
| `watchpoint_add` | `expr`, `kind?` | Ajoute un watchpoint |
| `watchpoint_remove` | `id` | Supprime un watchpoint |
| `set_register` | `reg`, `value` | Modifie un registre |
| `set_args` | `args` | Arguments du programme |
| `gdb_command` | `cmd` | Commande GDB brute |
| `read_section` | `name` | Lit une section ELF |
| `read_memory` | `addr`, `size` | Lit la mémoire brute |
| `evaluate` | `expr` | Évalue une expression |
| `disconnect` | — | Ferme la connexion |

### Serveur → Client

| Type | Payload |
|------|---------|
| `session` | `id`, `lines`, `binary_size` |
| `snapshot` | `StepSnapshot` complet |
| `error` | `message`, `phase` |
| `program_exit` | `code`, `output` |
| `breakpoint_added` | `line`, `id` |
| `watchpoint_added` | `expr`, `id` |
| `gdb_output` | `cmd`, `output` |
| `section_data` | `name`, `entries` |
| `memory` | `addr`, `data` (hex) |
| `eval_result` | `expr`, `value` |

---

## Choix techniques

| Décision | Choix | Raison |
|----------|-------|--------|
| Transport | WebSocket | Bidirectionnel, faible latence (~170ms/step) |
| Bridge GDB | pygdbmi | Lib Python mature pour GDB/MI |
| Backend | FastAPI | Async natif, WebSocket natif, Pydantic intégré |
| Frontend state | React hooks (local) | Pas besoin de store global pour une SPA single-page |
| Assembleur par défaut | NASM | Syntaxe Intel, le plus utilisé en pédagogie |
| CSS | Pure CSS (prefixed `asm-`) | Léger, pas de dépendance, isolation garantie |
| Thread model | `asyncio.to_thread()` pour GDB | pygdbmi est synchrone, ne bloque pas l'event loop |
| Sessions | 1 session = 1 WS connection | Simple, cleanup automatique à la déconnexion |

### Démarrage rapide

```bash
# Dev local
VITE_LIVE_MODE=true npx vite &
uvicorn backend.app.main:app --port 8000

# Production
docker compose up --build
```
