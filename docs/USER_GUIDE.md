# ASMBLE — Guide utilisateur

> Guide complet de l'interface ASMBLE, le débogeur pédagogique x86-64.

---

## Table des matières

1. [Vue d'ensemble](#vue-densemble)
2. [L'éditeur](#léditeur)
3. [Contrôles d'exécution](#contrôles-dexécution)
4. [Panneau registres](#panneau-registres)
5. [Panneau flags](#panneau-flags)
6. [Panneau stack](#panneau-stack)
7. [Panneau droit](#panneau-droit)
8. [Terminal](#terminal)
9. [Mode Live vs Mock](#mode-live-vs-mock)
10. [Raccourcis clavier](#raccourcis-clavier)

---

## Vue d'ensemble

L'interface est divisée en 3 colonnes redimensionnables. Le terminal est désormais docké dans la colonne centrale, sous les registres :

```
┌──────────────────────────────────────────────────────────────────┐
│  ▶ ASMBLE | [NASM x86-64 ▾] | [args...] | Contrôles | ● Live   │
├──────────────┬──────────────────┬────────────────────────────────┤
│              │                  │                                │
│   Éditeur    │   Registres      │  Stack / Mémoire / Security   │
│   + hint     │   + Flags        │  Console / Eval               │
│              │   + Terminal     │                               │
│              │                  │                                │
└──────────────────────────────────────────────────────────────────┘
```

Les séparateurs entre colonnes sont glissables. Le terminal docké est redimensionnable verticalement dans la colonne centrale, et son split `stdout/stderr` / `stdin` possède sa propre poignée de resize.

---

## L'éditeur

### Syntaxe

L'éditeur supporte la coloration syntaxique x86-64 avec 12 types de tokens :
instructions (bleu), registres (bleu pâle), labels (jaune), directives (violet),
sections (turquoise), nombres, chaînes, commentaires (gris), etc.

### Fonctionnalités

| Fonctionnalité | Description |
|---------------|-------------|
| **Autocomplete** | Suggestions d'instructions avec description, déclenchées en tapant |
| **Linter temps réel** | Erreurs : instruction inconnue, nombre d'opérandes incorrect, crochet non fermé. Warnings : label non défini |
| **Code folding** | Replier/déplier les sections et procédures via `−`/`+` dans la gouttière |
| **Find & Replace** | `Ctrl+F` pour chercher, `Ctrl+H` pour chercher/remplacer. Option case-sensitive |
| **Flèches de saut** | Arcs SVG animés reliant les JMP/JCC à leur label cible |
| **Breakpoints** | Clic sur un numéro de ligne pour ajouter/retirer un breakpoint |
| **Navigation** | `Ctrl+Click` sur un label pour sauter à sa définition |
| **Tooltip** | Survol d'une instruction pour voir sa description |
| **Indicateur RIP** | Flèche `→` dans la gouttière indiquant l'instruction courante |
| **Ligne active** | Surlignage de la ligne en cours d'exécution |
| **Hint pédagogique** | Bandeau au-dessus de l'éditeur expliquant l'instruction courante |

### Sélecteur d'assembleur

Le dropdown dans l'en-tête permet de choisir la syntaxe :
- **NASM x86-64** (défaut) — syntaxe Intel
- **GAS (AT&T)** — syntaxe AT&T
- **MASM** / **FASM** — variantes Intel

---

## Contrôles d'exécution

### Barre de contrôle

Les boutons sont organisés en groupes :

#### Exécution
| Bouton | Action |
|--------|--------|
| **▶ Build & Run** | Assemble le code et l'exécute. En mode step, s'arrête à `_start` |
| **▶\| Continue** | Continue l'exécution jusqu'au prochain breakpoint ou la fin (live) |

#### Pas à pas
| Bouton | Action |
|--------|--------|
| **← Back** | Revient au snapshot précédent dans l'historique |
| **Next →** | Step une instruction (stepi). Demande un nouveau step au serveur |
| **Over ↵** | Step over — exécute l'instruction sans descendre dans les CALL (live) |
| **Out ↑** | Step out — finit la fonction en cours et revient à l'appelant (live) |

**Compteur de steps** : affiche `step 3/22` (mock) ou `step 3` (live).

#### Auto-step
| Contrôle | Description |
|----------|-------------|
| **▶▶ Play** | Lance le stepping automatique |
| **⏸⏸ Pause** | Arrête le stepping automatique |
| **Slider vitesse** | 100ms (rapide) → 2000ms (lent), défaut 500ms |

L'auto-step s'arrête automatiquement aux breakpoints et à la fin du programme.

#### Autres
| Bouton | Action |
|--------|--------|
| **↻ Reset** | Ré-assemble le code et redémarre le debugger |

### Arguments du programme

En mode live, un champ texte dans l'en-tête permet de passer des arguments au programme (ex: `arg1 arg2`).

### Indicateur de connexion

Un point coloré à droite des contrôles indique l'état de la connexion au backend :
- **Vert** : connecté
- **Rouge** : erreur
- **Gris** : déconnecté

---

## Panneau registres

### Registres principaux

Les 8 registres classiques (RAX, RBX, RCX, RDX, RSI, RDI, RSP, RBP) sont affichés sous forme de cartes avec :

- **Valeur** : en hex, décimal ou binaire (selon le mode d'affichage)
- **Barre de sous-registres** : visualisation proportionnelle des sous-registres. Cliquer pour voir la valeur de chaque sous-registre (ex: RAX → EAX → AX → AH/AL)
- **Couleur verte** : registre modifié par la dernière instruction exécutée
- **Double-clic** (live) : modifier la valeur d'un registre directement

### RIP

Le registre RIP (pointeur d'instruction) est affiché séparément avec la valeur et le nom de l'instruction en cours.

### r8–r15

Section repliable affichant les registres étendus r8 à r15 en format compact (RegExtRow).

### Modes d'affichage

Le bouton de mode cycle entre 3 formats :
- **0x** (hex) : `0x1a3f`
- **dec** : `6751`
- **bin** : `0b110100111111`

### Filtres

- **modifiés** : affiche uniquement les registres modifiés
- **63:32** : affiche/masque les bits 63:32 dans la barre de sous-registres

---

## Panneau flags

Les 7 flags CPU sont affichés avec état actif (rouge) ou inactif (gris) :

| Flag | Nom | Signification |
|------|-----|---------------|
| **ZF** | Zero Flag | Résultat = 0 |
| **CF** | Carry Flag | Retenue (unsigned overflow) |
| **SF** | Sign Flag | Résultat négatif (bit de poids fort = 1) |
| **OF** | Overflow Flag | Dépassement signé |
| **PF** | Parity Flag | Nombre pair de bits à 1 dans l'octet bas |
| **AF** | Adjust Flag | Retenue BCD (bit 3 → bit 4) |
| **DF** | Direction Flag | Direction pour les opérations string |

Un **flag hint** contextuel explique la signification des flags après les instructions arithmétiques (ex: « ZF=1 : résultat nul, les opérandes sont égaux »).

---

## Panneau stack

La pile est affichée avec les entrées de RSP à RBP (et au-delà) :

| Élément | Description |
|---------|-------------|
| **Adresse** | Adresse mémoire de chaque slot (8 octets) |
| **Valeur** | Contenu du slot en hex/dec/bin |
| **Label** | Marqueur contextuel : `RSP →`, `RBP →`, `[RBP-8]`, etc. |
| **Fond coloré** | RSP et RBP ont un fond distinct |

### Watchpoints (live)

En mode live, le panneau stack inclut un champ pour ajouter des watchpoints :
- Entrez une expression (ex: `$rax`, `*0x7fff1234`)
- Types : write (défaut), read, access
- Le programme s'arrête quand la valeur surveillée change

---

## Panneau droit

Le panneau droit est un empilement de sections repliables :
- **Stack**
- **Memory**
- **Security**

Par défaut, **Stack** et **Memory** sont repliés pour laisser visible immédiatement la section Security.

### Stack

Contenu de la pile + backtrace (frames d'appel en live) + watchpoints.

### Memory

- **Section .text** : désassemblage complet du programme (adresse, bytes, instruction)
- **Sections ELF** : cliquer sur `.data`, `.bss`, etc. pour charger leur contenu (live)

### Security

La section Security commence par un bandeau **Checksec** toujours visible, puis une grille de cards.

Cards actives aujourd'hui :
- **VMmap**
- **GOT**
- **Cyclic**
- **ROP**

Chaque card ouvre une **modal dédiée** avec plus d'espace pour les tables et les actions.

Des cards **WiP** sont aussi visibles pour matérialiser la roadmap outillage :
- **Telescope**
- **Search**
- **Heap**
- **Hexdump**
- **Canary**
- **Strings**

### Eval

Évaluateur d'expressions. En mode local :

| Expression | Résultat |
|-----------|----------|
| `$rax`, `rax` | Valeur du registre (hex + décimal) |
| `$rax+$rbx` | Somme arithmétique |
| `$rsp-8` | Arithmétique avec constante |
| `hex($rax)` | Forcer le format hexadécimal |
| `dec($rax)` | Forcer le format décimal |
| `bin($rax)` | Forcer le format binaire |
| `flags` | Tous les flags avec leurs valeurs |
| `regs` | Tous les registres |
| `stack` | Les 8 premiers slots de la pile |

En **mode live**, les expressions sont évaluées directement par GDB (support complet des expressions GDB).

### Console (live uniquement)

Interface directe vers GDB. Tapez n'importe quelle commande GDB :

```
(gdb) info registers
(gdb) x/10x $rsp
(gdb) disas
(gdb) bt
(gdb) print $rax
```

### Référence

Trois sous-onglets de documentation intégrée :

#### Lexique
~45 instructions x86-64 + ~15 syscalls Linux, avec recherche plein texte. Chaque entrée contient : nom, syntaxe, description, flags affectés.

#### Convention
Convention d'appel SysV AMD64 :
- Arguments de fonction : RDI, RSI, RDX, RCX, R8, R9
- Retour : RAX
- Caller-saved : RAX, RCX, RDX, RSI, RDI, R8–R11
- Callee-saved : RBX, RBP, R12–R15, RSP

#### Adressage
9 modes d'adressage x86-64 avec formule, syntaxe et explication.

---

## Terminal

Le terminal docké sous les registres affiche :
- **Connexion** : état de la connexion au backend
- **Sortie programme** : stdout/stderr du code assembleur exécuté
- **Erreurs** : erreurs d'assemblage ou d'exécution (en rouge)
- **Fin de programme** : message de sortie avec code de retour

En mode live, quand le programme attend une entrée, le terminal se divise en deux zones :
- **stdout / stderr** en haut
- **stdin** en bas

Le ratio est redimensionnable avec une poignée horizontale.

Contrôles :
- **clear** : vide le terminal
- **agrandir** : ouvre le terminal en modal large
- **réduire** : re-docke le terminal dans la colonne centrale
- **▲ / ▼** : replie ou déplie le terminal docké

---

## Mode Live vs Mock

| Aspect | Mock (`VITE_LIVE_MODE=false`) | Live (`VITE_LIVE_MODE=true`) |
|--------|------|------|
| Backend | Aucun requis | FastAPI + GDB requis |
| Données | Snapshots simulés | GDB réel via WebSocket |
| Steps | Pré-calculés, navigation libre | Un par un, demandés au serveur |
| Build & Run | Trace locale | Assemblage + exécution réelle |
| Console GDB | ❌ | ✅ |
| Watchpoints | ❌ | ✅ |
| Step Over/Out | ❌ | ✅ |
| Arguments | ❌ | ✅ |
| Modification registres | ❌ | ✅ (double-clic) |

Le mode mock est utile pour le développement frontend sans backend.

---

## Raccourcis clavier

| Raccourci | Action |
|-----------|--------|
| `Ctrl+F` | Ouvrir la barre de recherche |
| `Ctrl+H` | Ouvrir recherche et remplacement |
| `Tab` | Insérer 4 espaces (si pas d'autocomplete) |
| `Tab` / `Enter` | Appliquer la suggestion sélectionnée (autocomplete ouvert) |
| `↑` / `↓` | Naviguer dans les suggestions (autocomplete ouvert) |
| `Escape` | Fermer l'autocomplete ou la barre de recherche |
| `Ctrl+Click` | Sauter à la définition d'un label |
