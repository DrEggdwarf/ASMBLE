# ASMBLE — Backlog

> Issues connues, dette technique, et fonctionnalités planifiées.
> Dernière mise à jour : 26 mars 2026

---

## Table des matières

1. [Bugs connus](#bugs-connus)
2. [Dette technique](#dette-technique)
3. [Phase 3a — Sécurité (checksec, vmmap)](#phase-3a--sécurité)
4. [Phase 3b — Outils d'exploitation](#phase-3b--outils-dexploitation)
5. [Phase 3c — Heap visualizer](#phase-3c--heap-visualizer)
6. [Phase 3d — Multi-architecture](#phase-3d--multi-architecture)
7. [Améliorations UX](#améliorations-ux)
8. [Infrastructure](#infrastructure)

---

## Bugs connus

| # | Bug | Fichier | Sévérité |
|---|-----|---------|----------|
| B1 | ~~`Ctrl+A` dans l'éditeur efface le code au lieu de tout sélectionner~~ ✅ | `AsmEditor.tsx` | ~~Moyenne~~ |
| B2 | `REST /api/assemble` (POST) crée une session sans cleanup — fuite de sessions si appelé directement | `main.py` | Basse |
| B3 | CORS ouvert (`allow_origins=["*"]`) avec TODO dans le code | `main.py` | Basse (Docker isolé) |
| B4 | ~~`eflags` inclus dans `changed` mais absent de `regs` → `BigInt(undefined)` crash React → écran noir~~ ✅ | `gdb_bridge.py`, `AsmEditor.tsx` | Critique |
| B5 | ~~**Dependency confusion (npm)**~~ ✅ : versions exactes pinnées + `.npmrc` `save-exact=true` | `package.json` | ~~Moyenne~~ |
| B6 | ~~**Image base non pinnée**~~ ✅ : `node:22-slim` et `ubuntu:24.04` pinnés par digest SHA256 | `Dockerfile` | ~~Moyenne~~ |
| B7 | ~~**Dependency confusion (pip)**~~ ✅ : versions exactes pinnées (`==X.Y.Z`) | `requirements.txt` | ~~Moyenne~~ |
| B8 | ~~**CI `ubuntu-latest`**~~ ✅ : `ubuntu-24.04` pinné, versions outils pinnées | `.github/workflows/` | ~~Moyenne~~ |
| B9 | ~~**Sandbox insuffisant**~~ ✅ : remplacé par nsjail (mount+network+IPC namespace isolation) | `sandbox.py` | ~~Critique~~ |

---

## Dette technique

### Frontend

| # | Description | Fichier(s) | Effort |
|---|-------------|------------|--------|
| T1 | `AsmDebugger` monolithique (~860 lignes) — extraire en sous-composants (ControlBar, TabPanel, FlagPanel, etc.) | `App.tsx` | Moyen |
| T2 | ~~`filteredInstrs` et `filteredSyscalls` recalculés à chaque render — ajouter `useMemo`~~ ✅ | `App.tsx` | ~~Faible~~ |
| T3 | ~~Fichiers morts jamais importés : `data/steps.ts`, `data/sample.ts`~~ ✅ supprimés | `src/data/` | ~~Faible~~ |
| T4 | ~~`data/patterns.ts` exporté mais jamais utilisé dans l'UI~~ ✅ supprimé | `src/data/` | ~~Faible~~ |
| T5 | ~~Re-renders non optimisés : RegCard et flags re-rendus même si leurs valeurs n'ont pas changé — ajouter `React.memo`~~ ✅ | `RegCard.tsx` | ~~Faible~~ |

### Backend

| # | Description | Fichier(s) | Effort |
|---|-------------|------------|--------|
| T6 | 16 méthodes de délégation identiques dans `Session` (forward vers `GdbBridge`) — remplaçable par `__getattr__` | `session_manager.py` | Faible |
| T7 | Handler WebSocket : giant if/elif (~200 lignes) — refactorer en dispatch dict | `main.py` | Moyen |
| T8 | Duplication de code entre handlers `assemble` et `run` (code d'assemblage identique) | `main.py` | Faible |
| T9 | `callable` utilisé comme type annotation dans `ANNOTATION_GENERATORS` (devrait être `Callable`) | `annotations.py` | Trivial |

---

## Phase 3a — Sécurité ✅

**Objectif** : Afficher les protections du binaire et la carte mémoire.
**Prérequis** : Installer pwndbg dans le container Docker.
**Effort estimé** : Faible à moyen.

### Tâches

| # | Tâche | Détail |
|---|-------|--------|
| ~~P1~~ | ~~Activer pwndbg dans le Dockerfile~~ ✅ | pwndbg installé dans /opt/pwndbg, .gdbinit configuré |
| ~~P2~~ | ~~Nouveau message WS `checksec`~~ ✅ | `security.py` — analyse ELF via pyelftools (RELRO, NX, PIE, canary, etc.) |
| ~~P3~~ | ~~Nouveau message WS `vmmap`~~ ✅ | `security.py` — /proc/pid/maps ou fallback ELF segments |
| ~~P4~~ | ~~Nouveau message WS `got`~~ ✅ | `security.py` — parse .rela.plt + .got/.got.plt |
| ~~P5~~ | ~~Nouvel onglet UI « Security »~~ ✅ | `SecurityPanel.tsx` — section collapsible dans le panneau droit (checksec badges, vmmap table, GOT table) |
| ~~P6~~ | ~~Envoyer checksec automatiquement après `assemble`~~ ✅ | Auto-checksec dans `_assemble_session()` |

### Impact UI

Ajout d'un onglet `security` dans le panneau droit :
```
[stack] [memory] [eval] [console] [référence] [security]
```

Contenu :
- Badges checksec (NX ✅, PIE ❌, RELRO Partial, Canary ❌)
- Tableau vmmap (adresses, permissions rwxp, fichier mappé)
- Tableau GOT (symbol → adresse résolue)

### Défi technique

pwndbg formate sa sortie avec des codes ANSI couleur. Options :
1. Stripper les codes ANSI et parser le texte brut
2. Appeler les commandes GDB sous-jacentes directement (`info file`, `maintenance info sections`)
3. Utiliser l'API Python de pwndbg depuis le bridge (plus couplé)

L'option 1 est la plus pragmatique pour commencer.

---

## Phase 3b — Outils d'exploitation

**Objectif** : Fournir des outils de base pour l'exploitation (pattern, ROP gadgets).
**Prérequis** : Phase 3a (pwndbg installé).
**Effort estimé** : Moyen.

### Tâches

| # | Tâche | Détail |
|---|-------|--------|
| P7 | Commande `cyclic` (génération de pattern) | Input : longueur. Output : pattern De Bruijn |
| P8 | Commande `cyclic -l` (recherche d'offset) | Input : valeur trouvée. Output : offset exact |
| P9 | Commande `rop` (recherche de gadgets) | Input : filtre optionnel (`pop rdi`). Output : liste de gadgets avec adresses |
| P10 | Sous-onglet « Exploit Tools » dans l'onglet Security | UI avec inputs pour cyclic + rop, résultats formatés |

### Impact UI

Sous-onglet dans Security ou onglet dédié :
```
┌─ Exploit Tools ──────────────────────────┐
│ Pattern:  [200]  [Generate]  [Find: ___] │
│ Offset: 28                               │
│                                          │
│ ROP:  [pop rdi]  [Search]                │
│ 0x401234: pop rdi; ret                   │
│ 0x401256: pop rsi; pop r15; ret          │
└──────────────────────────────────────────┘
```

---

## Phase 3c — Heap visualizer

**Objectif** : Visualiser le heap (chunks malloc, bins, arenas).
**Prérequis** : Phase 3a + binaire linké avec libc (gcc au lieu de ld).
**Effort estimé** : Élevé.

### Tâches

| # | Tâche | Détail |
|---|-------|--------|
| P11 | Support build avec libc (`gcc -no-pie` au lieu de `ld`) | Ajouter un flag `link_libc` au message `assemble` |
| P12 | Parser la sortie de `heap` (chunks) | Extraire : adresse, taille, flags (P/M/A), contenu, état (alloc/free) |
| P13 | Parser la sortie de `bins` | Extraire : fastbins, tcache, unsorted, small, large bins |
| P14 | Composant React `HeapView` | Vue en blocs empilés avec couleurs par état (alloc=vert, free=rouge) |
| P15 | Nouvel onglet UI « Heap » | Chunks + bins + arena info |
| P16 | Annotations heap | Expliquer malloc/free/realloc dans les annotations pédagogiques |

### Impact UI

Nouvel onglet `heap` :
```
[stack] [memory] [eval] [console] [référence] [security] [heap]
```

Visualisation en blocs :
```
┌─ Chunk 0x603000 ──── ALLOCATED ──┐
│ size: 0x20  │  prev_size: 0x0    │
│ data: 48 65 6c 6c 6f 00 ...     │
└──────────────────────────────────┘
┌─ Chunk 0x603020 ──── FREE ───────┐
│ size: 0x40  │  flags: P          │
│ fd: 0x0  │  bk: 0x0              │
│ [fastbin[2]]                     │
└──────────────────────────────────┘
```

### Défis

- Le parsing du output pwndbg `heap` est complexe (texte formaté ANSI, multi-lignes)
- Alternative : parser directement `main_arena` avec `x/Ngx &main_arena` (plus fiable mais plus de code)
- Nécessite de détecter si le programme utilise malloc (sinon l'onglet est vide/masqué)

---

## Phase 3d — Multi-architecture

**Objectif** : Supporter ARM64 et RISC-V via QEMU user-mode.
**Prérequis** : Refactoring du bridge GDB pour abstraire l'architecture.
**Effort estimé** : Élevé.

### Tâches

| # | Tâche | Détail |
|---|-------|--------|
| P17 | Installer `qemu-user`, cross-compilers (`aarch64-linux-gnu-as`, `riscv64-linux-gnu-as`) dans Docker | Augmente la taille de l'image significativement |
| P18 | Adapter `GdbBridge` pour `gdb-multiarch` | Target remote QEMU, registres différents par arch |
| P19 | Adapter `RegCard` pour registres ARM (x0-x30, sp, pc) et RISC-V (x0-x31, sp, ra) | Composants dynamiques selon l'arch |
| P20 | Adapter le tokenizer pour syntaxe ARM/RISC-V | Nouvelles instructions, registres, directives |
| P21 | Adapter le lexique et les annotations | Nouvelles instructions, nouvelles conventions d'appel |

### Impact UI

- Sélecteur d'architecture dans le header (à côté du sélecteur d'assembleur)
- Registres adaptés dynamiquement
- Lexique et conventions par architecture

---

## Améliorations UX

| # | Description | Effort |
|---|-------------|--------|
| U1 | Thème clair (light mode) | Moyen — dupliquer les variables CSS |
| U2 | ~~Export/import de code (fichier .asm)~~ ✅ | ~~Faible~~ — boutons Import/Export dans le header éditeur |
| U3 | Historique des programmes (localStorage) | Faible — sauvegarder les 10 derniers codes |
| U4 | Raccourci clavier F5 = Build & Run, F10 = Step Over, F11 = Step Into | Faible |
| U5 | Tooltips sur les valeurs stack/registres (afficher en hex+dec+bin au survol) | Faible |
| U6 | Mode collaboratif (partage de session via URL) | Élevé |
| U7 | Exercices intégrés avec validation automatique | Élevé |
| U8 | Terminal interactif (stdin du programme) | Moyen — pipe stdin via GDB |

---

## Infrastructure

| # | Description | Effort |
|---|-------------|--------|
| I1 | ~~Tests unitaires backend (pytest) — 39 tests~~ ✅ | ~~Moyen~~ |
| I2 | Tests e2e frontend (Playwright) | Moyen |
| I3 | ~~CI/CD GitHub Actions (build + test + push image)~~ ✅ | ~~Moyen~~ |
| I4 | ~~Publier l'image sur GHCR (workflow publish.yml, tag v*)~~ ✅ | ~~Faible~~ |
| I5 | ~~Réduire la taille de l'image Docker (1.71→1.51 GB)~~ ✅ | ~~Moyen~~ |
| I6 | ~~Rate limiting sur les WebSocket connections (token bucket 30/20)~~ ✅ | ~~Faible~~ |
| I7 | ~~Monitoring / health checks détaillés (/api/health/detailed)~~ ✅ | ~~Faible~~ |
| I8 | ~~Docker hardening complet~~ ✅ | ~~Moyen~~ |
| I9 | ~~Nginx security headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy)~~ ✅ | ~~Faible~~ |
| I10 | ~~Read-only rootfs + cap_drop ALL + no-new-privileges~~ ✅ | ~~Faible~~ |

---

## QoL — Interface moderne

> Principe : **"Looks simple, is complete."**
> L'outil doit avoir l'air aussi simple qu'un éditeur de texte, mais révéler la puissance de GDB/pwndbg à la demande. Chaque feature complexe doit être à 1 clic ou 1 raccourci — pas visible par défaut.

### Terminal repensé

| # | Idée | Détail |
|---|------|--------|
| Q1 | ~~**Terminal en drawer**~~ ✅ | Implémenté — terminal collapsible en drawer avec barre cliquable + resize drag. |
| Q2 | ~~**Toast pour les erreurs**~~ ✅ | Implémenté — toasts rouge auto-dismiss 5s en haut à droite pour les erreurs d'assemblage. |
| Q3 | **Terminal flottant** | Option de détacher le terminal en panneau flottant repositionnable (drag). Utile quand on veut voir le terminal ET la stack en même temps. |
| Q4 | **Mini-terminal inline** | Sous l'éditeur, une ligne unique qui montre le dernier message (output/erreur). Clic pour expand le terminal complet. Comme la status bar de VS Code. |

### Panneau droit — moins de tabs, plus de contexte

| # | Idée | Détail |
|---|------|--------|
| Q5 | ~~**Référence en modal/overlay**~~ ✅ | Implémenté — modal Ctrl+K avec lexique/convention/adressage, libère le tab. |
| Q6 | **Console GDB en drawer latéral** | La console GDB glisse depuis la droite (drawer) au lieu d'occuper un tab. Toujours accessible via un FAB ou `Ctrl+\``. Se ferme en cliquant dehors. |
| Q7 | **Eval en popover** | Au lieu d'un tab dédié, l'évaluateur apparaît en popover quand on sélectionne du texte dans l'éditeur ou qu'on clique sur un registre/une valeur stack. Contextuel et immédiat. |
| Q8 | **Tabs → vues empilées** | Au lieu de tabs exclusifs (stack OU memory OU eval), empiler stack + memory dans une vue scrollable avec des sections collapsibles. Moins de clics, plus de contexte visible. |
| Q9 | **Panneau droit collapsible** | Bouton pour replier tout le panneau droit → l'éditeur + registres prennent toute la largeur. Utile pour l'écriture de code avant de debugger. |

### Registres & Flags — polish

| # | Idée | Détail |
|---|------|--------|
| Q10 | ~~**Registres : hover preview**~~ ✅ | Implémenté — au survol d'un token registre dans l'éditeur, tooltip avec valeur hex+dec (★ si modifié). |
| Q11 | ~~**Flags : inline pills**~~ ✅ | Implémenté — flags en pills compacts avec pulse animation sur changement. |
| Q12 | ~~**Registres : sparkline**~~ ✅ | Implémenté — SVG polyline sparkline (20 derniers steps) à côté de chaque registre et sous-registre. |
| Q13 | **Registres : diff mode** | Toggle pour afficher les registres en mode diff : valeur précédente → valeur actuelle, avec flèche et delta (ex: `RAX: 0x5 → 0xA (+5)`). |

### Interactions modernes

| # | Idée | Détail |
|---|------|--------|
| Q14 | ~~**Command palette**~~ ✅ | Implémenté — `Ctrl+K` ouvre une palette searchable : actions (Build, Step, Reset, Continue), display modes, instructions, syscalls. Navigation flèches + Enter. |
| Q15 | **FAB (Floating Action Button)** | Bouton flottant en bas à droite avec les actions principales : ▶ Build, ⏭ Step, ↻ Reset. Se déplie en radial menu au hover. Pour les utilisateurs qui préfèrent la souris. |
| Q16 | ~~**Animations & transitions**~~ ✅ | Implémenté — CSS transitions sur registres, flags, active line, tabs, stack slots, annotations. |
| Q17 | **Drag & drop layout** | Permettre de réarranger les panneaux par drag & drop. Chacun choisit son layout. Sauvegarder en localStorage. |
| Q18 | ~~**Context menu**~~ ✅ | Implémenté — clic droit dans l'éditeur → menu contextuel : Couper, Copier, Coller, Tout sélectionner, Rechercher, Annuler, Refaire, Toggle breakpoint. |
| Q19 | ~~**Breadcrumb d'exécution**~~ ✅ | Implémenté — barre au-dessus de l'éditeur : section › label › instruction courante. |
| Q20 | ~~**Status bar**~~ ✅ | Implémenté — barre en bas avec display mode, assembleur, lignes, step count, connexion, raccourci référence. |

### Éditeur — petits plus

| # | Idée | Détail |
|---|------|--------|
| Q21 | ~~**Inline register values**~~ ✅ | Implémenté — ghost text en fin de ligne active montrant les registres modifiés (ex: `rax=0x5  rdx=0x1`). |
| Q22 | ~~**Minimap**~~ ✅ | Implémenté — canvas minimap à droite avec token colors, active line highlight, breakpoints, click-to-jump. |
| Q23 | **Snippet templates** | Bouton "Templates" → drawer avec des snippets pré-faits : Hello World, boucle, fonction, syscall read/write, stack frame. Clic pour insérer. Bon pour les débutants. |
| Q24 | **Undo/Redo** | `Ctrl+Z` / `Ctrl+Y` pour l'éditeur (pas encore implémenté dans le textarea custom). |

### Onboarding & Aide

| # | Idée | Détail |
|---|------|--------|
| Q25 | **Tour guidé** | Au premier lancement, un overlay qui guide l'utilisateur : "Voici l'éditeur", "Cliquez ici pour assembler", "Les registres s'affichent ici"... Skip-able, rejouable. |
| Q26 | **Tooltips riches** | Chaque bouton/zone a un tooltip avec description + raccourci clavier. Pas juste le titre, mais une vraie explication courte. |
| Q27 | ~~**État vide accueillant**~~ ✅ | Implémenté — empty state avec templates (Hello World, Boucle, Fonction, Stack Frame, Format vierge) + raccourci Ctrl+K. |

### Responsive & polish visuel

| # | Idée | Détail |
|---|------|--------|
| Q28 | **Mode compact** | Sur petit écran / fenêtre étroite : passer automatiquement à un layout en tabs au lieu de colonnes (éditeur, registres, stack en tabs). |
| Q29 | **Thème adaptatif** | Détecter `prefers-color-scheme` et proposer un thème clair. Ou au moins un mode "high contrast" pour l'accessibilité. |
| Q30 | ~~**Micro-animations flags**~~ ✅ | Implémenté — pulse animation (scale 1→1.25→1) quand un flag change d'état. |
| Q31 | ~~**Smooth step animation**~~ ✅ | Implémenté — CSS transition sur le déplacement de la ligne active. |

---

## Priorités suggérées

> Baseline : `asmble:v1-baseline` (25 mars 2026, 585MB)
> Restaurer : `docker run -d --name asmble-test -p 8080:8080 asmble:v1-baseline`

### ✅ Terminé (v1-baseline)
1. ~~**B1**~~ ✅ — Fix Ctrl+A
2. ~~**B4**~~ ✅ — Fix crash eflags → écran noir
3. ~~**T2**~~ ✅ — `useMemo` sur filteredInstrs
4. ~~**T3**~~ ✅ — Supprimer fichiers morts
5. ~~**T4**~~ ✅ — Supprimer patterns.ts
6. ~~**T5**~~ ✅ — `React.memo` sur RegCard
7. ~~**U2**~~ ✅ — Export/import .asm
8. ~~**Q1**~~ ✅ — Terminal en drawer
9. ~~**Q2**~~ ✅ — Toast pour les erreurs
10. ~~**Q5**~~ ✅ — Référence en modal
11. ~~**Q10**~~ ✅ — Hover preview registres
12. ~~**Q11**~~ ✅ — Flags inline en pills
13. ~~**Q14**~~ ✅ — Command palette Ctrl+K
14. ~~**Q16**~~ ✅ — Animations & transitions
15. ~~**Q20**~~ ✅ — Status bar
16. ~~**Q21**~~ ✅ — Inline register values (lens)
17. ~~**Q27**~~ ✅ — État vide accueillant
18. ~~**Q30**~~ ✅ — Micro-animations flags
19. ~~**Q31**~~ ✅ — Smooth step animation
20. ~~**Q22**~~ ✅ — Minimap éditeur
21. ~~**Q18**~~ ✅ — Context menu (clic droit)
22. ~~**Q19**~~ ✅ — Breadcrumb d'exécution
23. **Q12** ⏸️ — Sparkline registres (code prêt, masqué)
24. ~~**Q25**~~ ✅ — Tour guidé (onboarding)
25. ~~**Q26**~~ ✅ — Tooltips riches (data-tip)
26. ~~**I1-I3**~~ ✅ — Tests pytest + CI GitHub Actions
27. ~~**I4**~~ ✅ — Publish GHCR workflow
28. ~~**I5**~~ ✅ — Image Docker réduite
29. ~~**I6**~~ ✅ — Rate limiting WebSocket
30. ~~**I7**~~ ✅ — Health checks détaillés
31. ~~**I8**~~ ✅ — Docker hardening (read-only rootfs, cap_drop ALL, no-new-privileges)
32. ~~**I9**~~ ✅ — Nginx security headers
33. ~~**I10**~~ ✅ — OCI labels, HEALTHCHECK, frontend read-only

---

### Sprint 1 — Nettoyage technique 🧹 ✅
> Prérequis pour tout le reste. Nettoyer avant de construire.

| # | Item | Description | Effort |
|---|------|-------------|--------|
| 1.1 | ~~**T9**~~ ✅ | Fix `callable` → `Callable` dans annotations | Trivial |
| 1.2 | ~~**T8**~~ ✅ | Déduplication handlers assemble/run | Faible |
| 1.3 | ~~**T6**~~ ✅ | `__getattr__` sur Session (16 délégations) | Faible |
| 1.4 | ~~**B2**~~ ✅ | Endpoint REST `/api/assemble` supprimé (WS only) | Faible |
| 1.5 | ~~**B3**~~ ✅ | CORS restreint (env `ASMBLE_CORS_ORIGINS`) | Faible |
| 1.6 | ~~**T7**~~ ✅ | Dispatch dict pour le WS handler | Moyen |
| 1.7 | ~~**T1**~~ ✅ | App.tsx → 6 sous-composants extraits | Moyen |

### Sprint 2 — Quick wins UX ✅
> Fonctionnalités à fort ratio impact/effort, indépendantes.

| # | Item | Description | Effort |
|---|------|-------------|--------|
| 2.1 | ~~**U4**~~ ✅ | Raccourcis F5/F10/F11/F9 + Shift | Faible |
| 2.2 | ~~**U3**~~ ✅ | Historique programmes (localStorage) | Faible |
| 2.3 | ~~**U5**~~ ✅ | Tooltips hex+dec+bin sur stack/registres | Faible |
| 2.4 | ~~**Q24**~~ ✅ | Undo/Redo éditeur (stack custom) | Faible |
| 2.5 | ~~**Q13**~~ ✅ | Registres : diff mode (ancien → nouveau + delta signé) | Faible |
| 2.6 | ~~**Q23**~~ ✅ | Snippet templates (dropdown + 6 templates) | Faible |

### Sprint 3 — Repenser le layout ✅
> Bloc cohérent : refonte du panneau droit. Ordre important.

| # | Item | Description | Dépend de |
|---|------|-------------|-----------|
| 3.1 | ~~**Q9**~~ ✅ | Panneau droit collapsible (thin strip + expand) | — |
| 3.2 | ~~**Q8**~~ ✅ | Tabs → vues empilées (stack + memory collapsibles) | Q9 |
| 3.3 | ~~**Q6**~~ ✅ | Console GDB en drawer latéral (slide-in 380px) | Q8 |
| 3.4 | ~~**Q7**~~ ✅ | Eval en popover contextuel (bottom-right floating) | Q8 |

### Sprint 4 — Phase 3a Sécurité 🔒 ✅
> Le gros morceau feature. Nécessite Sprint 1 (T7 dispatch dict, T1 composants).

| # | Item | Description | Dépend de |
|---|------|-------------|------------|
| 4.1 | ~~**P1**~~ ✅ | pwndbg dans Docker | — |
| 4.2 | ~~**P2**~~ ✅ | Message WS `checksec` (pyelftools) | P1, T7 |
| 4.3 | ~~**P3**~~ ✅ | Message WS `vmmap` (/proc/pid/maps) | P1, T7 |
| 4.4 | ~~**P4**~~ ✅ | Message WS `got` (.rela.plt + .got) | P1, T7 |
| 4.5 | ~~**P5**~~ ✅ | Section Security UI (SecurityPanel.tsx) | P2-P4, T1 |
| 4.6 | ~~**P6**~~ ✅ | Checksec auto après assemble | P5 |

### Sprint 5 — Phase 3b Exploit Tools ✅
> Outils d'exploitation : pattern cyclic + ROP gadgets. Prérequis : Phase 3a.

| # | Item | Description | Dépend de |
|---|------|-------------|------------|
| 5.1 | ~~**P7**~~ ✅ | Backend: commande `cyclic` (pattern De Bruijn) | P1 |
| 5.2 | ~~**P8**~~ ✅ | Backend: commande `cyclic -l` (recherche offset) | P7 |
| 5.3 | ~~**P9**~~ ✅ | Backend: commande `rop` (recherche gadgets ROPgadget) | P1 |
| 5.4 | ~~**P10**~~ ✅ | Frontend: sous-section Exploit Tools dans SecurityPanel | P7-P9 |

### Sprint 6 — Éditeur avancé ✏️ ✅
> Features éditeur indépendantes.

| # | Item | Description | Effort |
|---|------|-------------|--------|
| 6.1 | ~~**Q22**~~ ✅ | Minimap éditeur (canvas bird's-eye view, token colors, click-to-jump) | Moyen |
| 6.2 | ~~**Q18**~~ ✅ | Context menu (clic droit) — couper/copier/coller/breakpoint/rechercher | Moyen |
| 6.3 | ~~**Q19**~~ ✅ | Breadcrumb d'exécution (section › label › instruction) | Faible |
| 6.4 | **Q12** ⏸️ | Sparkline registres (code prêt, masqué via CSS — en attente de décision) | Moyen |

### Sprint 7 — Onboarding & Infra 🏗️ ✅
> Après stabilisation de l'UI. Les tests figent le comportement.

| # | Item | Description | Dépend de |
|---|------|-------------|------------|
| 7.1 | ~~**Q25**~~ ✅ | Tour guidé — overlay spotlight 11 étapes (FR), rejouable via Ctrl+K | UI stable |
| 7.2 | ~~**Q26**~~ ✅ | Tooltips riches (data-tip CSS) sur tous les boutons avec raccourcis | — |
| 7.3 | ~~**I1-I3**~~ ✅ | 39 tests pytest (models, annotations, exploit_tools, sandbox, API) + CI GitHub Actions | UI stable |
| 7.4 | ~~**I4**~~ ✅ | Workflow publish.yml — push GHCR sur tag v* | I3 (CI) |
| 7.5 | ~~**I5**~~ ✅ | Image Docker 1.71→1.51 GB (layers consolidés, cleanup .git/cache) | P1 |
| 7.6 | ~~**I6**~~ ✅ | Rate limiting WS token bucket (30 burst, 20/s refill) | — |
| 7.7 | ~~**I7**~~ ✅ | /api/health/detailed (tools check: nasm, gdb, yasm, gcc, pygdbmi) | — |

### Sprint 8 — Docker Hardening 🔒 ✅
> Sécurisation complète du conteneur Docker pour review DevSecOps.

| # | Item | Description | Effort |
|---|------|-------------|--------|
| 8.1 | ~~**I8**~~ ✅ | Dockerfile : OCI labels, HEALTHCHECK, git purgé après pwndbg, frontend chmod 444, user asmble | Moyen |
| 8.2 | ~~**I9**~~ ✅ | nginx.conf : `server_tokens off`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, dotfiles bloqués, `client_max_body_size 1m`, logs stdout/stderr | Faible |
| 8.3 | ~~**I10**~~ ✅ | docker-compose.yml : `read_only: true`, `cap_drop: ALL`, `cap_add` minimal (5 caps), `no-new-privileges`, tmpfs ciblés, limites CPU/RAM | Faible |

### Sprint 9 — Supply Chain Hardening 🔗 ✅
> Fixer toutes les vulnérabilités de dependency confusion signalées par Romsnack.

| # | Item | Description | Effort |
|---|------|-------------|--------|
| 9.1 | ~~**B5**~~ ✅ | `package.json` : versions exactes pinnées (retrait `^`), `.npmrc` avec `save-exact=true` | Faible |
| 9.2 | ~~**B6**~~ ✅ | `Dockerfile` : `node:22-slim` et `ubuntu:24.04` pinnés par digest SHA256 | Faible |
| 9.3 | ~~**B7**~~ ✅ | `requirements.txt` : versions exactes pinnées (`==X.Y.Z`) | Faible |
| 9.4 | ~~**B8**~~ ✅ | CI : `runs-on: ubuntu-24.04` au lieu de `ubuntu-latest` | Faible |
| 9.5 | ~~**B8**~~ ✅ | CI : versions pinnées des outils (`pytest==9.0.2`, etc.) | Faible |

### Sprint 10 — Sandbox & Isolation (pré-VPS) 🛡️ ✅
> **Objectif** : isoler le code assembleur exécuté pour que même un syscall malveillant ne puisse pas attaquer le système hôte.
>
> **Solution** : nsjail (Google) compilé dans le Dockerfile, chaque session GDB tourne dans un jail avec mount+network+IPC namespace isolation, rlimits, et time limit. En dev local (sans nsjail), fallback rlimits seuls.

| # | Item | Description | Effort |
|---|------|-------------|--------|
| 10.1 | ~~**Sandbox nsjail**~~ ✅ | nsjail compilé dans le Dockerfile (multi-stage), `build_gdb_command()` wraps GDB dans nsjail. Mount ns (seuls /lib,/usr,/bin,/sbin,/etc + workdir), network ns (vide, pas de réseau), IPC ns isolé. Fallback rlimits si nsjail absent. | Élevé |
| 10.2 | ~~**Network isolation**~~ ✅ | `--clone_newnet` par défaut (enabled) → le binaire ne peut ouvrir aucun socket. Vérifié en test. | Faible |
| 10.3 | ~~**Filesystem isolation**~~ ✅ | Le binaire ne voit que `/lib`, `/usr`, `/bin`, `/sbin`, `/etc` (read-only) + son workdir (writable). Pas d'accès à `/app`, `/home`, `/root`. Vérifié via `ls /` dans le jail. | Moyen |
| 10.4 | ~~**Max sessions = 5**~~ ✅ | `ASMBLE_MAX_SESSIONS=5` par défaut. Sessions count dans `/api/health`. | Faible |
| 10.5 | ~~**Timeout session auto**~~ ✅ | Auto-cleanup des sessions inactives après 10min (`ASMBLE_SESSION_IDLE_TIMEOUT=600`). Background loop toutes les 60s. `Session.touch()` sur chaque message WS. | Faible |
| 10.6 | ~~**Monitoring sessions**~~ ✅ | Logging structuré create/destroy/evict/stale. `/api/health/detailed` expose nsjail status, idle timeout, sessions count. | Faible |
| 10.7 | ~~**46 tests**~~ ✅ | 7 nouveaux tests : sandbox command builder (fallback, binary path, workdir mounted), session manager (touch, cleanup_stale, keeps_active, max_sessions). | Faible |

### Sprint 11 — Exploit Tools natifs pwndbg 🔧
> **Objectif** : remplacer l'implémentation custom de `exploit_tools.py` par les commandes natives de pwndbg (plus fiables, plus complètes, déjà installé).
>
> **Problème actuel** : `exploit_tools.py` réimplémente De Bruijn cyclic et appelle ROPgadget en subprocess — alors que pwndbg fournit `cyclic`, `cyclic -l`, `rop` nativement dans GDB.

| # | Item | Description | Effort |
|---|------|-------------|--------|
| 11.1 | **Cyclic via pwndbg** | Remplacer `cyclic()` et `cyclic_find()` par des commandes GDB via le bridge : `cyclic 200` → parse output, `cyclic -l 0x61616162` → parse offset. Supprimer `_de_bruijn()` custom. | Faible |
| 11.2 | **ROP via pwndbg** | Remplacer l'appel subprocess à ROPgadget par `rop` de pwndbg via GDB. Parse la sortie. Avantage : pas besoin de ROPgadget installé séparément. | Faible |
| 11.3 | **Cleanup exploit_tools.py** | Soit supprimer le fichier entier (tout passe par GDB bridge), soit le garder comme fallback si pwndbg n'est pas dispo (mode dégradé). | Faible |
| 11.4 | **Nouveaux outils pwndbg** | Exposer d'autres commandes pwndbg utiles : `checksec` natif, `heap` (pour futur Phase 3c), `search` (pattern in memory), `telescope` (stack inspection). | Moyen |

### Sprint 12 — Polish & Nice to have ✨
> Dernières couches de polish.

| # | Item | Description | Effort |
|---|------|-------------|--------|
| 12.1 | **U1** | Thème clair (light mode) | Moyen |
| 12.2 | **Q29** | Thème adaptatif (prefers-color-scheme) | Dépend U1 |
| 12.3 | **Q28** | Mode compact (responsive) | Moyen |
| 12.4 | **U8** | Terminal interactif (stdin) | Moyen |
| 12.5 | **Q3** | Terminal flottant (détachable) | Faible |
| 12.6 | **Q4** | Mini-terminal inline | Faible |
| 12.7 | **Q15** | FAB (Floating Action Button) | Faible |

### Long terme 🔭

| # | Item | Description |
|---|------|-------------|
| L1 | **P11-P16** | Phase 3c : heap visualizer |
| L2 | **P17-P21** | Phase 3d : multi-architecture (ARM64, RISC-V) |
| L3 | **Q17** | Drag & drop layout |
| L4 | **U6-U7** | Mode collaboratif + exercices intégrés |
| L5 | **VPS public** | Déployer sur VPS avec nsjail (Sprint 10), rate limiting par IP, auth optionnelle, HTTPS (Let's Encrypt) |
