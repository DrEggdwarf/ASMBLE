"""
Sandbox — Limites de ressources pour l'exécution du code utilisateur.
"""

import resource


def apply_sandbox_limits() -> None:
    """
    Applique des limites de ressources au processus courant.
    À utiliser comme preexec_fn de subprocess.Popen/run.
    """
    # CPU: 10 secondes max
    resource.setrlimit(resource.RLIMIT_CPU, (10, 10))

    # RAM: 256 MB max
    mem_limit = 256 * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_AS, (mem_limit, mem_limit))

    # Processus: 10 max (anti fork bomb)
    resource.setrlimit(resource.RLIMIT_NPROC, (10, 10))

    # Fichiers: 1 MB max par fichier créé
    resource.setrlimit(resource.RLIMIT_FSIZE, (1 * 1024 * 1024, 1 * 1024 * 1024))

    # File descriptors: 32 max
    resource.setrlimit(resource.RLIMIT_NOFILE, (32, 32))
