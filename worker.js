/**
 * Cloudflare Worker — JAP /api/estimer
 * Déployer sur : workers.cloudflare.com
 * Variables d'env à configurer : DEEPSEEK_API_KEY
 */

const CATS_MAPPING = {
  mobilier:     ['meuble', 'table', 'chaise', 'armoire', 'canapé', 'lit', 'bureau', 'commode'],
  art:          ['tableau', 'peinture', 'sculpture', 'céramique', 'art', 'déco', 'vase'],
  bijoux:       ['bijou', 'bague', 'collier', 'bracelet', 'montre', 'pendentif', 'or', 'argent', 'diamant'],
  vaisselle:    ['vaisselle', 'assiette', 'verre', 'tasse', 'couverts', 'service'],
  livres:       ['livre', 'roman', 'encyclopédie', 'bande dessinée'],
  electronique: ['téléphone', 'ordinateur', 'tablette', 'drone', 'casque', 'console', 'appareil photo', 'caméra', 'tv', 'télévision'],
  vetements:    ['vêtement', 'manteau', 'robe', 'veste', 'chaussure', 'sac', 'maroquinerie'],
  vehicule:     ['voiture', 'moto', 'vélo', 'scooter', 'trottinette', 'bateau'],
  outil:        ['outil', 'perceuse', 'scie', 'marteau', 'jardinage', 'tondeuse'],
};

function detectCategorie(objet = '') {
  const low = objet.toLowerCase();
  for (const [cat, keywords] of Object.entries(CATS_MAPPING)) {
    if (keywords.some(k => low.includes(k))) return cat;
  }
  return 'autre';
}

async function deepseekChat(apiKey, messages, opts = {}) {
  const resp = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages,
      ...opts,
    }),
  });
  if (!resp.ok) throw new Error(`DeepSeek API ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return JSON.parse(data.choices[0].message.content);
}

async function duckduckgoSearch(query, maxResults = 5) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'JAP-App/1.0' } });
    const data = await resp.json();
    const results = [];
    for (const r of (data.RelatedTopics || [])) {
      if (r.Text && r.FirstURL) {
        results.push({ title: r.Text.slice(0, 80), body: r.Text, href: r.FirstURL });
        if (results.length >= maxResults) break;
      }
    }
    return results;
  } catch {
    return [];
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname !== '/api/estimer' || request.method !== 'POST') {
      return new Response('Not Found', { status: 404 });
    }

    try {
      const { photo, contexte } = await request.json();
      if (!photo) return Response.json({ error: 'Photo manquante' }, { status: 400, headers: corsHeaders });

      const apiKey = env.DEEPSEEK_API_KEY;
      if (!apiKey) return Response.json({ error: 'Clé API non configurée' }, { status: 500, headers: corsHeaders });

      // ── Étape 1 : Identification ──────────────────────────────────────────
      const blocContexte = contexte
        ? `\nIMPORTANT — contexte utilisateur (priorité maximale) : "${contexte}"\n`
        : '';

      const identification = await deepseekChat(apiKey, [
        { role: 'system', content: 'Tu identifies des objets sur des photos. Tu réponds toujours en JSON.' },
        { role: 'user', content: [
          { type: 'text', text: `Analyse cette image et identifie l'objet.${blocContexte}\nRéponds en JSON : {"objet":"Nom complet","marque":"Marque","modele":"Modèle exact","etat":"Neuf / Très bon état / Bon état / Usagé"}` },
          { type: 'image_url', image_url: { url: photo } }
        ]}
      ]);

      const objetComplet = identification.objet || contexte || 'objet inconnu';

      // ── Étape 2 : Recherche DuckDuckGo ────────────────────────────────────
      const [resOcc, resNeuf] = await Promise.all([
        duckduckgoSearch(`${objetComplet} occasion prix acheter`, 5),
        duckduckgoSearch(`${objetComplet} prix neuf`, 3),
      ]);
      const lignes = [
        ...resOcc.map(r => `[OCCASION] ${r.title} — ${r.body.slice(0, 200)}`),
        ...resNeuf.map(r => `[NEUF] ${r.title} — ${r.body.slice(0, 200)}`),
      ];
      const contexteWeb = lignes.join('\n') || 'Recherche internet indisponible.';

      // ── Étape 3 : Estimation ──────────────────────────────────────────────
      const estimation = await deepseekChat(apiKey, [
        { role: 'system', content: 'Expert estimation biens occasion. Réponds en JSON.' },
        { role: 'user', content: `Objet : ${objetComplet}\nÉtat : ${identification.etat}${contexte ? `\nContexte : ${contexte}` : ''}\n\nDonnées internet :\n---\n${contexteWeb}\n---\n\nRègles : prix_max < prix_neuf, base-toi sur les données réelles.\nRéponds en JSON : {"objet":"...","etat":"...","prix_neuf":0.0,"prix_min":0.0,"prix_median":0.0,"prix_max":0.0,"devise":"EUR","explication":"1-2 phrases"}` }
      ]);

      estimation.categorie = detectCategorie(objetComplet);

      return Response.json(estimation, { headers: corsHeaders });

    } catch (err) {
      return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
    }
  }
};
