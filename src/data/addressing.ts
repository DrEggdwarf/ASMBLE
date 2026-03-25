export const ADDRESSING_MODES = [
  { mode: 'Immédiat', syntax: 'mov rax, 42', desc: 'Valeur constante encodée dans l\'instruction.', formula: 'valeur' },
  { mode: 'Registre', syntax: 'mov rax, rbx', desc: 'Copie directe entre registres.', formula: 'registre' },
  { mode: 'Direct', syntax: 'mov rax, [0x600000]', desc: 'Adresse mémoire absolue.', formula: '[addr]' },
  { mode: 'Indirect registre', syntax: 'mov rax, [rbx]', desc: 'Adresse contenue dans un registre.', formula: '[base]' },
  { mode: 'Base + déplacement', syntax: 'mov rax, [rbp-8]', desc: 'Base + offset signé. Accès aux variables locales.', formula: '[base + disp]' },
  { mode: 'Base + index', syntax: 'mov rax, [rbx+rcx]', desc: 'Somme de deux registres.', formula: '[base + index]' },
  { mode: 'Base + index*scale', syntax: 'mov rax, [rbx+rcx*4]', desc: 'Accès tableau : base + index × taille_élément.', formula: '[base + index*scale]' },
  { mode: 'Complet (SIB)', syntax: 'mov rax, [rbx+rcx*8+16]', desc: 'Forme la plus complexe : base + index × scale + déplacement.', formula: '[base + index*scale + disp]' },
  { mode: 'RIP-relatif', syntax: 'mov rax, [rel msg]', desc: 'Relatif au compteur programme. Utilisé pour les données globales en PIC.', formula: '[rip + disp]' },
]
