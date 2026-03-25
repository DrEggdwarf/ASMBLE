# ASMBLE — Documentation technique

> Architecture, structure du code, conventions et guide de contribution.

---

## Table des matières

1. [Stack technique](#stack-technique)
2. [Arborescence](#arborescence)
3. [Architecture](#architecture)
4. [Backend — GDB/MI Bridge](#backend--gdbmi-bridge)
5. [Frontend — React](#frontend--react)
6. [Protocole WebSocket](#protocole-websocket)
7. [Structures de données](#structures-de-données)
8. [Éditeur (AsmEditor)](#éditeur-asmeditor)
9. [Système de styling](#système-de-styling)
10. [Sécurité & Sandbox](#sécurité--sandbox)
11. [Build & dev](#build--dev)
12. [Conventions de code](#conventions-de-code)

---

## Stack technique

| Technologie    | Version  | Rôle                              |
|----------------|----------|-----------------------------------|
| React          | 19.x     | UI components                     |
| TypeScript     | 5.6+     | Typage statique                   |
| Vite           | 6.x      | Build / dev server / proxy        |
| Python         | 3.12+    | Backend                           |
| FastAPI        | 0.115+   | API WebSocket + REST              |
| pygdbmi        | 0.11+    | Bridge GDB/MI en Python           |
| Pydantic       | 2.x      | Validation / sérialisation models |
| GDB            | 14+      | Débogueur (protocole MI3)         |
| NASM/GAS/FASM  | —        | Assembleurs x86-64                |
| Pure CSS       | —        | Styles (pas de framework CSS)     |

Pas de state management library, pas de router, pas de CSS-in-JS.

---

## Arborescence

```
asmble/
├── main.tsx                # Point d'entrée Vite (createRoot)
├── index.ts                # Point d'entrée module (mount/unmount factory)
├── index.html              # Template HTML
├── vite.config.ts          # Configuration Vite + proxy backend
├── manifest.json           # Métadonnées de l'app
├── src/
│   ├── App.tsx             # Composant principal — layout, état, UI
│   ├── components/
│   │   ├── RegCard.tsx     # RegCard + RegExtRow — affichage registres
│   │   └── editor/
│   │       ├── AsmEditor.tsx    # Composant éditeur complet
│   │       ├── tokenizer.ts     # Tokenizer x86-64 (12 types de tokens)
│   │       ├── linter.ts        # Linter temps réel
│   │       ├── completions.ts   # Autocomplete + instruction info
│   │       └── foldRegions.ts   # Code folding (sections, labels)
│   ├── data/
│   │   ├── index.ts        # Barrel re-export
│   │   ├── types.ts        # Interfaces TypeScript (StepSnapshot, etc.)
│   │   ├── lexicon.ts      # ~45 instructions + ~15 syscalls
│   │   ├── patterns.ts     # 17 patterns C → ASM
│   │   ├── registers.ts    # Listes registres + sous-registres
│   │   ├── convention.ts   # Convention SysV AMD64
│   │   ├── addressing.ts   # 9 modes d'adressage
│   │   └── memory.ts       # Section .text mock (fallback)
│   ├── hooks/
│   │   ├── useColResize.ts     # Hook resize 3 colonnes
│   │   ├── useTermResize.ts    # Hook resize terminal
│   │   └── useGdbSession.ts    # Hook WebSocket GDB client
│   └── styles/
│       ├── index.css       # Point d'entrée CSS
│       └── asmble.css      # Tous les styles (~2000 lignes)
├── backend/
│   ├── requirements.txt    # Dépendances Python
│   └── app/
│       ├── __init__.py
│       ├── main.py             # FastAPI app + WebSocket endpoint
│       ├── models.py           # Pydantic models (StepSnapshot, etc.)
│       ├── gdb_bridge.py       # pygdbmi → StepSnapshot bridge
│       ├── session_manager.py  # Session lifecycle + assemblage
│       ├── sandbox.py          # rlimit sandboxing
│       └── annotations.py      # Annotations pédagogiques auto-générées
├── docker/
│   ├── nginx.conf              # Reverse proxy config
│   ├── supervisord.conf        # Process manager
│   └── seccomp-profile.json    # Security profile
├── docs/
│   ├── ARCHITECTURE.md         # Architecture & roadmap
│   ├── TECHNICAL.md            # Ce fichier
│   └── USER_GUIDE.md           # Guide utilisateur
└── CLAUDE.md                   # Contexte pour l'assistant IA
```

---

## Architecture

### Vue d'ensemble

```
┌─────────────────────────────────────────────────────────┐
│  Browser (http://localhost:5173)                         │
│  ┌────────────────────────────────────────────────────┐  │
│  │  React App (App.tsx)                               │  │
│  │  ├─ AsmEditor (éditeur x86-64)                     │  │
│  │  ├─ RegCard/Flags/Stack (visualisation état)       │  │
│  │  ├─ Tabs (stack/memory/eval/console/référence)     │  │
│  │  └─ Terminal (sortie programme)                    │  │
│  └─────────────┬──────────────────────────────────────┘  │
│                │ WebSocket (ws://localhost:5173/api/ws)   │
│                │ (proxied par Vite vers :8000)            │
│  ┌─────────────▼──────────────────────────────────────┐  │
│  │  FastAPI Backend (:8000)                            │  │
│  │  ├─ SessionManager (sessions, assemblage)           │  │
│  │  ├─ GdbBridge (pygdbmi → StepSnapshot)              │  │
│  │  ├─ Annotations (explications pédagogiques)         │  │
│  │  └─ Sandbox (rlimit)                                │  │
│  └─────────────┬──────────────────────────────────────┘  │
│                │ GDB/MI3 (subprocess)                     │
│  ┌─────────────▼──────────────────────────────────────┐  │
│  │  GDB + nasm/gas/ld                                  │  │
│  │  Exécution sandboxée du code utilisateur             │  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Flux de données — mode Live

```
[Éditeur]──code──►[Build & Run]──WS──►[FastAPI]──nasm+ld──►[binaire ELF]
                                                                │
                                                          GDB MI3
                                                                │
[Terminal]◄──output──[useGdbSession]◄──WS──[snapshot]◄──[GdbBridge]
[Registres]◄─────────────┘
[Stack]◄─────────────────┘
[Flags]◄─────────────────┘
```

### Modules et responsabilités

| Module | Fichiers | Rôle |
|--------|----------|------|
| `backend/app/` | 7 fichiers | API, bridge GDB, sessions, annotations, sandbox |
| `src/hooks/` | 3 fichiers | WebSocket client, resize colonnes/terminal |
| `src/components/editor/` | 5 fichiers | Éditeur : tokenizer, linter, autocomplete, folding |
| `src/components/` | 1 fichier | Composants réutilisables (RegCard, RegExtRow) |
| `src/data/` | 8 fichiers | Types, données de référence (lexique, conventions) |
| `src/styles/` | 2 fichiers | Styles CSS centralisés |

---

## Backend — GDB/MI Bridge

### `gdb_bridge.py` — Cœur du debugger

La classe `GdbBridge` pilote GDB via pygdbmi et traduit les réponses en `StepSnapshot` :

```python
class GdbBridge:
    def start()           # Lance GDB, breakpoint à _start, exec-run
    def read_state()      # Lit l'état complet (registres, stack, disasm)
    def step()            # -exec-next-instruction + read_state
    def step_over()       # -exec-next
    def step_out()        # -exec-finish
    def step_back()       # reverse step (active record au 1er appel)
    def continue_exec()   # -exec-continue (détecte la fin du programme)
    def gdb_command(cmd)  # Commande GDB brute
    def add_breakpoint()  # -break-insert
    def evaluate(expr)    # -data-evaluate-expression
```

**Particularités** :
- **Off-by-one fix** : `_step_and_read()` retourne `ip/instr` de l'instruction pré-step, et `changed/regs` post-step. Ainsi le highlight correspond à l'instruction qui a causé les changements.
- **Détection de sortie** : `_check_stop_or_exit()` détecte `exited-normally`, `exited`, `exited-signalled` et empêche le step sur un programme terminé.
- **Caches** : disassembly, sections, stack (skip si RSP inchangé), backtrace.
- **Output capture** : `_capture_output()` intercepte `type=output|target` de GDB pour la sortie du programme.

### `session_manager.py` — Cycle de vie

- `Session._assemble_sync(code, flavor)` : assemble avec nasm/gas/fasm/yasm + ld → binaire ELF
- `Session.start_debug()` : lance GdbBridge sur le binaire
- `SessionManager` : gère les sessions actives, cleanup automatique

### `annotations.py` — Explications pédagogiques

Génère automatiquement des annotations FR pour chaque instruction :
- **Générateurs dynamiques** : `mov`, `push`, `pop`, `add`, `sub`, `cmp`, `test`, `xor`, `call`, `ret`, `jmp`, `syscall`, `lea`, `nop`
- **Annotations statiques** : ~25 instructions (sauts conditionnels, logique, shifts, etc.)
- **Flag hints** : résumé des flags actifs après chaque instruction arithmétique

### Performance

| Opération | Latence typique |
|-----------|-----------------|
| Step (stepi) | ~170ms |
| Reset (re-assemble + GDB restart) | ~1s |
| Build & Run (assemble + continue) | ~1.2s |
| Step après exit (erreur rapide) | ~3ms |

---

## Frontend — React

### `App.tsx` — Composant principal

Composant unique `AsmDebugger` gérant :
- **État** : code, step, registres, flags, stack, terminal, breakpoints, watchpoints, évaluation, console GDB
- **Mode Live/Mock** : toggle via `VITE_LIVE_MODE` (env var)
- **Contrôles** : Build & Run, Continue, Back/Next, Step Over/Out, Auto-step, Reset
- **Layout** : 3 colonnes redimensionnables + terminal redimensionnable

### `useGdbSession.ts` — Hook WebSocket

Gère la connexion WebSocket et l'état GDB :
- **`connect(code, flavor, mode)`** : ouvre un WS, envoie `run` ou `assemble`
- **`step()`** : envoie `step`. Si `programExited`, fait auto-reset + step.
- **`programExited`** : flag tracking, empêche les steps inutiles.
- **`history`** : accumule les snapshots pour navigation Back/Next.

### `RegCard.tsx` — Affichage registres

- `RegCard` : carte avec barre proportionnelle de sous-registres (eax/ax/ah/al)
- `RegExtRow` : ligne compacte pour r8–r15
- Support `hex`/`dec`/`bin` via `displayMode`

---

## Protocole WebSocket

### Messages client → serveur

```typescript
// Exécution
{ type: "run", code: string, flavor: string }           // Assemble + exécute
{ type: "assemble", code: string, flavor: string }       // Assemble + pause à _start

// Stepping
{ type: "step" }                    // Step instruction
{ type: "step_over" }              // Step over (ne rentre pas dans CALL)
{ type: "step_out" }               // Step out (termine la fonction)
{ type: "step_back" }              // Reverse step
{ type: "continue" }               // Continue jusqu'au prochain breakpoint
{ type: "reset" }                   // Re-crée la session (même code)

// Breakpoints & Watchpoints
{ type: "breakpoint_add", line: number, condition?: string }
{ type: "breakpoint_remove", line: number }
{ type: "watchpoint_add", expr: string, kind: "write"|"read"|"access" }
{ type: "watchpoint_remove", id: string }

// Inspection
{ type: "evaluate", expr: string }
{ type: "gdb_command", cmd: string }
{ type: "read_section", name: string }
{ type: "read_memory", addr: number, size: number }
{ type: "set_register", reg: string, value: number }
{ type: "set_args", args: string }

// Session
{ type: "disconnect" }
```

### Messages serveur → client

```typescript
{ type: "session", id: string, lines: number, binary_size: number }
{ type: "snapshot", payload: StepSnapshot }
{ type: "error", message: string, phase: "assemble"|"runtime" }
{ type: "program_exit", code: number, output: string[] }
{ type: "gdb_output", cmd: string, output: string }
{ type: "eval_result", expr: string, value: string }
{ type: "section_data", name: string, entries: {addr,val}[] }
```

---

## Structures de données

### StepSnapshot

Structure centrale — un instantané complet de l'état machine :

```typescript
interface StepSnapshot {
  ip: number                    // Numéro de ligne (1-indexed)
  instr: string | null          // Instruction exécutée
  regs: Record<string, number>  // 16 registres + rip
  flags: Record<string, number> // 7 flags (ZF, CF, SF, OF, PF, AF, DF)
  changed: string[]             // Registres modifiés par cette instruction
  stackEntries: StackEntry[]    // Contenu de la pile
  annotation: string            // Explication pédagogique (FR)
  jumped?: boolean              // true si un saut a été pris
  flagHint?: string             // Explication contextuelle des flags
  disassembly?: DisasmEntry[]   // Désassemblage complet de .text
  backtrace?: FrameInfo[]       // Pile d'appels
  sections?: SectionInfo[]      // Sections ELF
  inferiorOutput?: string[]     // Sortie stdout/stderr du programme
}
```

### StackEntry

```typescript
interface StackEntry {
  addr: number       // Adresse mémoire
  val: number        // Valeur stockée (8 octets)
  label?: string     // ex: "RSP →", "[RBP-8]"
  isRsp?: boolean
  isRbp?: boolean
}
```

---

## Éditeur (AsmEditor)

### Tokenizer

Parcourt chaque ligne et produit des tokens colorés. 12 types : `comment`, `keyword`, `register`, `number`, `string`, `label-def`, `label-ref`, `directive`, `section`, `prefix`, `punctuation`, `plain`.

### Linter

Validation temps réel (debounced) :
- Instruction inconnue → erreur
- Nombre d'opérandes incorrect → erreur
- Crochet non fermé → erreur
- Label non défini → warning

### Jump arrows

Algorithme de niveaux pour dessiner les flèches de saut sans croisement :
1. Détection des JMP/JCC/CALL avec target label
2. Tri par taille de span (petit → grand)
3. Assignation greedy de niveaux
4. Rendu SVG avec animation sur la flèche active

### Architecture interne

Pattern « textarea invisible + highlight overlay » :
- `<textarea>` : transparent, capture les événements
- `<pre>` overlay : tokens colorés, synchronisé via `transform: translate()`
- Couches : active-line, indent guides, scope highlights, error underlines, find matches

---

## Système de styling

### Préfixes CSS

Toutes les classes sont préfixées `asm-` pour éviter les collisions :
`asm-root`, `asm-header`, `asm-body`, `asm-ed-*`, `asm-regcard-*`, `asm-flag-*`, `asm-stack-*`, `asm-terminal-*`, `asm-resize-*`

### Palette (Tokyo Night)

| Rôle | Couleur |
|------|---------|
| Fond racine | `#010409` |
| Panneaux | `#0d1117` |
| Cartes | `#161b22` |
| Registres modifiés | `#3fb950` (vert) |
| Flags actifs | `#ff7b72` (rouge) |
| Jump badge | `#388bfd` (bleu) |
| Instructions | `#569cd6` (bleu) |
| Registres | `#9cdcfe` (bleu pâle) |
| Labels | `#e0af68` (jaune) |
| Directives | `#bb9af7` (violet) |
| Sections | `#73daca` (turquoise) |

---

## Sécurité & Sandbox

Le code utilisateur est assemblé et exécuté sous GDB avec des limites :

| Limite | Valeur | Protège contre |
|--------|--------|----------------|
| `RLIMIT_CPU` | 10s | Boucles infinies |
| `RLIMIT_AS` | 256 MB | Allocation mémoire excessive |
| `RLIMIT_NPROC` | 10 | Fork bombs |
| `RLIMIT_FSIZE` | 1 MB | Écriture fichier massive |

En production Docker : profil seccomp restrictif, `--network=none`, montage tmpfs, utilisateur `nobody`.

---

## Build & dev

### Développement local

```bash
# Frontend (terminal 1)
npm install
VITE_LIVE_MODE=true npx vite --port 5173

# Backend (terminal 2)
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
```

Vite proxy `/api/ws` (WebSocket) et `/api` vers `localhost:8000`.

### Production (Docker)

```bash
docker compose up --build     # Dev (avec hot-reload)
docker run -p 8080:8080 asmble  # Production
```

Architecture Docker : Nginx (:8080) → Frontend (dist/) + FastAPI (:8000) → GDB/MI

---

## Conventions de code

- **Architecture modulaire** : un fichier par responsabilité
- **State local** : `useState` + `useCallback` + `useMemo`, pas de Redux/Zustand
- **CSS scopé** : préfixe `asm-` sur toutes les classes
- **Barrel exports** : `data/index.ts` réexporte tout
- **Français** : annotations, descriptions, UI — tout en français
- **Code anglais** : noms de variables/fonctions en anglais
- **StepSnapshot** : interface commune frontend/backend, sérialisée en JSON via WebSocket
