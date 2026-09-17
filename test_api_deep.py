import json
import os
import sys
import base64
from openai import OpenAI
from ddgs import DDGS

# 1. Initialisation du client DeepSeek
api_key = os.getenv("DEEPSEEK_API_KEY")
if not api_key:
    api_key = input("Clé API DeepSeek non trouvée dans l'environnement. Entrez votre clé : ").strip()
    if not api_key:
        print("Erreur : La clé API est requise.")
        sys.exit(1)

client = OpenAI(
    api_key=api_key,
    base_url="https://api.deepseek.com"
)

# ─── TARIFS DeepSeek-V3 (deepseek-chat) ──────────────────────────────────────
# https://api-docs.deepseek.com/quick_start/pricing
PRIX_INPUT_PAR_M  = 0.27   # $ par million de tokens (entrée)
PRIX_OUTPUT_PAR_M = 1.10   # $ par million de tokens (sortie)
TAUX_EUR          = 0.92   # $ -> € approximatif

def afficher_cout(usage, label: str) -> float:
    """Affiche le coût d'un appel API et retourne le coût en USD."""
    if not usage:
        return 0.0
    tok_in  = usage.prompt_tokens
    tok_out = usage.completion_tokens
    cout_usd = (tok_in / 1_000_000 * PRIX_INPUT_PAR_M) + (tok_out / 1_000_000 * PRIX_OUTPUT_PAR_M)
    cout_eur = cout_usd * TAUX_EUR
    print(f"   📊 [{label}] In: {tok_in:,} tok | Out: {tok_out:,} tok | Coût: ${cout_usd:.6f} (~{cout_eur*100:.4f}¢)")
    return cout_usd


# ─── ÉTAPE 1 : Identifier l'objet sur l'image ───────────────────────────────

def identifier_objet(data_url: str, contexte_utilisateur: str = "") -> dict | None:
    """Envoie l'image à DeepSeek pour identifier l'objet (marque, modèle, état)."""

    bloc_contexte = ""
    if contexte_utilisateur.strip():
        bloc_contexte = f"""
    IMPORTANT — L'utilisateur a fourni ce contexte sur l'objet (fiabilité maximale) :
    "{contexte_utilisateur}"
    Utilise ces informations pour corriger ou préciser ton identification visuelle.
"""

    prompt_id = f"""
    Analyse cette image et identifie l'objet photographié.
{bloc_contexte}
    Réponds EXCLUSIVEMENT en JSON avec cette structure :
    {{
        "objet": "Nom complet (ex: DJI Avata 2)",
        "marque": "Marque (ex: DJI)",
        "modele": "Modèle exact (ex: Avata 2)",
        "etat": "Neuf / Très bon état / Bon état / Usagé",
        "query_recherche": "Requête de recherche optimale pour trouver les prix (ex: DJI Avata 2 occasion prix)"
    }}
    """
    try:
        response = client.chat.completions.create(
            model="deepseek-chat",
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": "Tu identifies des objets sur des photos avec précision. Tu réponds toujours en JSON."},
                {"role": "user", "content": [
                    {"type": "text", "text": prompt_id},
                    {"type": "image_url", "image_url": {"url": data_url}}
                ]}
            ],
            temperature=0
        )
        return json.loads(response.choices[0].message.content), response.usage
    except Exception as e:
        print(f"Erreur identification : {e}")
        return None, None


# ─── ÉTAPE 2 : Chercher les prix en ligne via DuckDuckGo ─────────────────────

def chercher_prix_en_ligne(objet_complet: str) -> tuple[str, list]:
    """Cherche les prix actuels sur internet. Retourne (texte_contexte, liste_liens)."""
    resultats_texte = []
    liens = []

    # Domaines de tracking/pub à exclure
    DOMAINES_EXCLUS = ("bing.com/aclick", "google.com/aclk", "doubleclick.net", "googlesyndication.com")

    def est_lien_valide(url: str) -> bool:
        return url and not any(d in url for d in DOMAINES_EXCLUS)

    ddgs = DDGS()

    # Recherche annonces occasion
    query_occasion = f"{objet_complet} occasion prix acheter"
    print(f"  🔍 Occasion : {query_occasion}")
    try:
        for r in ddgs.text(query_occasion, max_results=6):
            resultats_texte.append(f"[OCCASION] {r['title']} — {r['body'][:200]}")
            if est_lien_valide(r.get('href')):
                liens.append({"type": "Occasion", "titre": r['title'], "url": r['href']})
    except Exception as e:
        print(f"  ⚠️  Erreur occasion : {e}")

    # Recherche prix neuf — avec le nom complet pour être précis
    query_neuf = f"{objet_complet} prix neuf"
    print(f"  🔍 Neuf     : {query_neuf}")
    try:
        for r in ddgs.text(query_neuf, max_results=4):
            resultats_texte.append(f"[NEUF] {r['title']} — {r['body'][:200]}")
            if est_lien_valide(r.get('href')):
                liens.append({"type": "Neuf", "titre": r['title'], "url": r['href']})
    except Exception as e:
        print(f"  ⚠️  Erreur neuf : {e}")

    if resultats_texte:
        print(f"  ✅ {len(resultats_texte)} résultats trouvés ({len(liens)} liens valides)")
        for r in resultats_texte[:3]:
            print(f"     {r[:100]}")
    else:
        print("  ❌ Aucun résultat — les requêtes sont peut-être bloquées")

    texte = "\n".join(resultats_texte) if resultats_texte else "Aucun résultat trouvé sur internet."
    return texte, liens


# ─── ÉTAPE 3 : Estimation finale basée sur les vrais prix ────────────────────

def estimer_avec_contexte(identification: dict, contexte_prix: str, contexte_utilisateur: str = "") -> dict | None:
    """Demande à DeepSeek d'estimer les prix en se basant sur les données réelles trouvées."""

    bloc_contexte = ""
    if contexte_utilisateur.strip():
        bloc_contexte = f"""
    Éléments de contexte fournis par l'utilisateur (priorité haute) :
    ---
    {contexte_utilisateur}
    ---
    Tiens ABSOLUMENT compte de ces informations pour affiner l'estimation.
"""

    prompt_estim = f"""
    Objet identifié : {identification.get('objet')}
    État apparent : {identification.get('etat')}
{bloc_contexte}
    Voici les résultats de recherche RÉELS trouvés sur internet aujourd'hui :
    ---
    {contexte_prix}
    ---

    En te basant sur ces données réelles et le contexte utilisateur, estime la valeur marchande de cet objet.
    Règles absolues :
    - Le prix_max ne peut JAMAIS dépasser le prix neuf actuel trouvé
    - Utilise les fourchettes observées dans les annonces ci-dessus
    - Si tu vois des prix spécifiques, base-toi dessus directement

    Réponds EXCLUSIVEMENT en JSON :
    {{
        "objet": "{identification.get('objet')}",
        "etat": "{identification.get('etat')}",
        "prix_neuf": 0.0,
        "prix_min": 0.0,
        "prix_median": 0.0,
        "prix_max": 0.0,
        "devise": "EUR",
        "explication": "Synthèse basée sur les annonces trouvées et le contexte (1 à 2 phrases)"
    }}
    """
    try:
        response = client.chat.completions.create(
            model="deepseek-chat",
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": "Tu es un expert en estimation de biens d'occasion. Tu te bases strictement sur les données fournies. Tu réponds en JSON."},
                {"role": "user", "content": prompt_estim}
            ],
            temperature=0
        )
        return json.loads(response.choices[0].message.content), response.usage
    except Exception as e:
        print(f"Erreur estimation : {e}")
        return None, None


# ─── MAIN ─────────────────────────────────────────────────────────────────────

def main():
    print("=== Estimateur de biens via DeepSeek + Internet ===\n")

    if len(sys.argv) > 1:
        chemin_image = sys.argv[1]
    else:
        chemin_image = input("Chemin local de l'image (ex: ./test/dro.jpeg) : ").strip()

    if not chemin_image or not os.path.exists(chemin_image):
        print(f"Erreur : fichier introuvable : {chemin_image}")
        return

    # Contexte utilisateur
    print("")
    contexte_utilisateur = input("Éléments de contexte pour aider l'analyse (optionnel, appuyez sur Entrée pour ignorer) :\n> ").strip()

    # Encodage de l'image
    with open(chemin_image, "rb") as f:
        image_data = base64.b64encode(f.read()).decode("utf-8")
    ext = os.path.splitext(chemin_image)[1].lower()
    mime = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}.get(ext, "image/jpeg")
    data_url = f"data:{mime};base64,{image_data}"

    # Étape 1
    print("📷 Étape 1 : Identification de l'objet...")
    identification, usage_id = identifier_objet(data_url, contexte_utilisateur)
    if not identification:
        print("Impossible d'identifier l'objet.")
        return
    print(f"   → {identification.get('objet')} ({identification.get('etat')})")
    cout_id = afficher_cout(usage_id, "Identification")

    # Étape 2
    print("\n🌐 Étape 2 : Recherche des prix sur internet...")
    contexte_prix, liens_sources = chercher_prix_en_ligne(
        identification.get("objet", "")
    )

    # Étape 3
    print("\n💰 Étape 3 : Calcul de l'estimation basée sur internet...")
    resultat, usage_estim = estimer_avec_contexte(identification, contexte_prix, contexte_utilisateur)
    cout_estim = afficher_cout(usage_estim, "Estimation")

    if resultat:
        devise = resultat.get("devise", "EUR")
        symbole = "€" if devise == "EUR" else devise

        print("\n" + "=" * 48)
        print(f"  Objet identifié : {resultat.get('objet', 'Inconnu')}")
        print(f"  État estimé     : {resultat.get('etat', 'Non précisé')}")
        print("-" * 48)
        print(f"  Prix NEUF réf.  : {resultat.get('prix_neuf', 'N/A')} {symbole}")
        print("-" * 48)
        print(f"  Prix Minimum    : {resultat.get('prix_min', 'N/A')} {symbole}")
        print(f"  Prix Médian     : {resultat.get('prix_median', 'N/A')} {symbole}")
        print(f"  Prix Maximum    : {resultat.get('prix_max', 'N/A')} {symbole}")
        print("-" * 48)
        print(f"  Analyse : {resultat.get('explication', '')}")
        print("=" * 48)

        # Sources
        # Liens sources
        if liens_sources:
            print("\n🔗 Sources consultées :")
            for i, lien in enumerate(liens_sources, 1):
                tag = "[Occasion]" if lien['type'] == "Occasion" else "[Neuf]   "
                titre = lien['titre'][:55] + "..." if len(lien['titre']) > 55 else lien['titre']
                print(f"  {i:2}. {tag} {titre}")
                print(f"       → {lien['url']}")

        # Total coût
        cout_total_usd = cout_id + cout_estim
        cout_total_eur = cout_total_usd * TAUX_EUR
        print(f"\n💳 Coût total session : ${cout_total_usd:.6f} (~{cout_total_eur*100:.4f}¢)")
        print()


if __name__ == "__main__":
    main()