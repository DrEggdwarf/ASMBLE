# ASMBLE

> Debugger pédagogique x86-64 interactif. Assemblez, steppez, explorez — directement dans le navigateur.

## Quick Start

```bash
git clone https://github.com/DrEggdwarf/ASMBLE.git
cd ASMBLE
docker compose up --build
```

Ouvrir **http://localhost:8080**

## Aperçu

Interface en 3 colonnes redimensionnables — éditeur, registres + flags, panneaux (stack, mémoire, sécurité, console GDB) — avec un terminal intégré.

Un seul `docker compose up` donne un environnement complet : éditeur avec syntax highlighting, assemblage réel (NASM/GAS/YASM), debugging pas-à-pas via GDB, analyse de sécurité (checksec, vmmap, GOT, ROP gadgets).

## Features

### Éditeur
- Coloration syntaxique x86-64 — 12 types de tokens
- Auto-complétion (100+ items : instructions, registres, directives)
- Linting en temps réel (instructions inconnues, opérandes, labels)
- Pliage de code (sections et blocs de labels)
- Rechercher / Remplacer (Ctrl+F / Ctrl+H)
- Flèches de saut (JMP, JCC, CALL) avec niveaux automatiques
- Breakpoints (clic sur numéro de ligne)
- Context menu (clic droit)
- Minimap (vue d'ensemble, click-to-jump)
- Breadcrumb d'exécution (section › label › instruction)
- Inline register values (ghost text en fin de ligne active)
- Undo/Redo, snippets templates, code history (localStorage)

### Débogage (GDB/MI réel)
- Assemblage réel : NASM, GAS, FASM, YASM
- Exécution pas-à-pas (step into / over / out / back)
- Continue (run-to-breakpoint)
- Build & Run (exécution directe)
- Auto-step avec vitesse configurable (100ms–2s)
- Breakpoints conditionnels + watchpoints
- Annotation pédagogique FR contextuelle à chaque step
- Console GDB (commandes brutes)
- Évaluateur d'expressions

### Registres
- 16 registres (rax–r15) + RIP
- Sous-registres cliquables (rax → eax → ax → ah/al)
- Mode diff : ancien → nouveau + delta signé
- Filtres : modifiés seuls, hex/dec/bin
- Registres étendus r8–r15 en grille compacte
- Tooltips multi-format au survol

### Flags
- 7 flags : ZF, CF, SF, OF, PF, AF, DF
- Pills actif/inactif avec pulse animation
- Indice contextuel expliquant l'état des flags

### Stack & Mémoire
- Stack view : RSP → RBP (cadre de pile actif)
- Marqueurs RSP (turquoise) et RBP (orange)
- Watchpoints live
- Vue mémoire (.text) avec highlight instruction courante
- Sections collapsibles (stack + mémoire empilés)

### Sécurité & Exploit
- **Checksec** : badges NX, PIE, RELRO, Canary (auto après assemblage)
- **vmmap** : carte mémoire du processus (/proc/pid/maps)
- **GOT** : table des symboles résolus (.rela.plt + .got.plt)
- **Cyclic patterns** : génération De Bruijn + recherche d'offset
- **ROP gadgets** : recherche avec filtres
- pwndbg intégré dans le container Docker

### Référence intégrée
- **Lexique** : ~45 instructions + ~15 syscalls Linux, recherche plein texte
- **Convention d'appel** : SysV AMD64, caller/callee-saved
- **Modes d'adressage** : 9 modes avec formule et syntaxe

### UX
- Command palette (Ctrl+K) : actions, display modes, instructions
- Tour guidé (11 étapes, rejouable)
- Raccourcis clavier : F5 Run, F10 Step Over, F11 Step Into, F9 Breakpoint
- Panneau droit collapsible
- Console GDB en drawer latéral
- Terminal avec stdout/stderr du programme
- Snippets templates (Hello World, Boucle, Fonction, Stack Frame, Conditions, Tableau)

## Architecture

```
┌─ Browser ──────────────────────────────────────────┐
│  React 19 + TypeScript 5.6 + Vite 6               │
│  Éditeur │ Registres+Flags │ Stack/Mémoire/Sécu   │
│                    │ WebSocket                     │
│  ┌─────────────────▼──────────────────────────┐    │
│  │  Nginx :8080 → FastAPI :8000               │    │
│  │  pygdbmi → GDB/MI3 → binaire sandboxé      │    │
│  └────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────┘
```

| Composant | Technologie |
|-----------|-------------|
| Frontend | React 19 + TypeScript 5.6 + Vite 6 |
| Backend | FastAPI + pygdbmi + pwndbg |
| Assembleurs | NASM, GAS, FASM, YASM |
| Proxy | Nginx (reverse proxy + static files) |
| Container | Docker (Ubuntu 24.04, multi-stage build) |

## Sécurité Docker

| Mesure | Détail |
|--------|--------|
| Rootfs | `read_only: true` + tmpfs ciblés |
| Capabilities | `cap_drop: ALL` + 5 caps minimales |
| Privileges | `no-new-privileges:true` |
| Resources | 2 CPU, 512 MB RAM |
| Nginx | `server_tokens off`, security headers, dotfiles bloqués |
| HEALTHCHECK | `/api/health` toutes les 30s |
| User isolation | Code exécuté en tant que `asmble` (non-root) |

## Dev local (sans Docker)

```bash
# Terminal 1 — Backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000

# Terminal 2 — Frontend
npm install
VITE_LIVE_MODE=true npx vite --port 5173
```

Ouvrir http://localhost:5173 (Vite proxy `/api` → `:8000`)

## Structure

```
asmble/
├── Dockerfile              # Multi-stage (node → ubuntu)
├── docker-compose.yml      # Orchestration + hardening
├── docker/                 # nginx.conf, supervisord, seccomp
├── backend/app/            # FastAPI + GDB bridge + sandbox
│   ├── main.py             # WebSocket endpoint (24 msg types)
│   ├── gdb_bridge.py       # pygdbmi → StepSnapshot
│   ├── session_manager.py  # Sessions + assemblage
│   ├── sandbox.py          # rlimit sandboxing
│   ├── security.py         # checksec, vmmap, GOT
│   ├── exploit_tools.py    # cyclic, ROP gadgets
│   └── annotations.py      # Annotations pédagogiques FR
├── src/                    # Frontend React
│   ├── App.tsx             # Composant principal
│   ├── components/         # RegCard, AsmEditor, panels/*
│   ├── data/               # Types, lexicon, registres
│   ├── hooks/              # useGdbSession, useColResize
│   └── styles/             # CSS (~3500 lignes, préfixe asm-)
├── tests/                  # 39 pytest tests
└── docs/                   # Architecture, Backlog, User Guide
```

## Documentation

- [Guide utilisateur](docs/USER_GUIDE.md)
- [Architecture & Roadmap](docs/ARCHITECTURE.md)
- [Documentation technique](docs/TECHNICAL.md)
- [Backlog](docs/BACKLOG.md)

## Stats

- ~14 000 lignes de code (4 264 TS/React, 3 557 CSS, 2 123 Python, 4 081 config/docs)
- 39 tests backend (models, annotations, exploit_tools, sandbox, API)
- 24 types de messages WebSocket
- Step ~170ms, build ~1.2s

## License

MIT
