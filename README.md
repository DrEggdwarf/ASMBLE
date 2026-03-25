# ASMBLE

> Debugger pédagogique x86-64 interactif. Visualisez l'exécution pas-à-pas d'un programme assembleur directement dans le navigateur.

## Aperçu

Interface en 3 colonnes redimensionnables — éditeur, registres + flags, panneaux de référence — avec un terminal intégré.

## Features

### Éditeur
- Coloration syntaxique x86-64 (NASM) — 12 types de tokens
- Auto-complétion (100+ items : instructions, registres, directives, snippets)
- Linting en temps réel (instructions inconnues, opérandes, labels)
- Pliage de code (sections et blocs de labels)
- Rechercher / Remplacer (Ctrl+F / Ctrl+H)
- Flèches de saut (JMP, JCC, CALL) avec niveaux automatiques
- Breakpoints (clic sur numéro de ligne)
- Infobulle au survol des instructions
- Navigation de labels (Ctrl+clic)
- Mise en surbrillance du mot sous le curseur

### Débogage
- Exécution pas-à-pas (avant / arrière)
- Run complet et run-to-breakpoint
- Auto-step avec vitesse configurable (100ms–2s)
- Annotation pédagogique contextuelle à chaque step
- Badge JUMP quand un saut est pris

### Registres
- 16 registres (rax–r15) + RIP
- Cartes avec barre proportionnelle de sous-registres (eax, ax, ah, al)
- Delta ancien → nouveau (rouge → vert)
- Filtres : modifiés seuls, bits 63:32, hex/dec/bin
- Registres étendus r8–r15 en grille compacte

### Flags
- 7 flags : ZF, CF, SF, OF, PF, AF, DF
- Pilules actif/inactif (rouge/gris)
- Indice contextuel expliquant l'état des flags

### Stack
- Vue RSP → RBP (cadre de pile actif)
- Marqueurs RSP (turquoise) et RBP (orange)
- Labels sémantiques (return addr, saved rbp, [rbp-8]=n)

### Référence intégrée
- **Lexique** : ~45 instructions + ~15 syscalls Linux, recherche plein texte
- **Convention d'appel** : SysV AMD64, caller/callee-saved, syscall args
- **Modes d'adressage** : 9 modes avec formule, syntaxe, description

### Autres
- Vue mémoire (.text) avec highlight de l'instruction courante
- Terminal avec output d'exécution
- Panneaux redimensionnables (colonnes + terminal)
- Palette Tokyo Night

## Documentation

- [Guide utilisateur](docs/USER_GUIDE.md) — prise en main complète
- [Documentation technique](docs/TECHNICAL.md) — architecture, structures de données, conventions

## Stack

- React 19 + TypeScript 5.6 + Vite 6
- Pure CSS (~1980 lignes, préfixe `asm-`)
- Zéro dépendance runtime (hors React)
- Architecture modulaire (`src/` avec `data/`, `components/`, `hooks/`, `styles/`)

## Structure

```
asmble/
├── main.tsx / index.ts / index.html     # Points d'entrée
├── src/
│   ├── App.tsx                          # Composant principal
│   ├── components/
│   │   ├── RegCard.tsx                  # Registres (carte + ligne compacte)
│   │   └── editor/                      # Éditeur complet
│   │       ├── AsmEditor.tsx            # Composant éditeur
│   │       ├── tokenizer.ts             # Coloration syntaxique
│   │       ├── linter.ts                # Validation temps réel
│   │       ├── completions.ts           # Auto-complétion
│   │       └── foldRegions.ts           # Code folding
│   ├── data/                            # Données et types
│   │   ├── types.ts, sample.ts, steps.ts
│   │   ├── lexicon.ts, patterns.ts
│   │   ├── registers.ts, convention.ts
│   │   └── addressing.ts, memory.ts
│   ├── hooks/                           # Hooks custom
│   └── styles/                          # CSS
└── docs/                                # Documentation
```

## Démarrage

```bash
npm install
npm run dev     # Dev server avec HMR
npm run build   # Build production → dist/
```

## État actuel

Le frontend est complet avec des **données mock** (snapshots d'exécution pré-enregistrés). Le backend (FastAPI + GDB/MI pour le vrai assemblage et stepping) est prévu.

## License

MIT
