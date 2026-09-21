/**
 * Cloudflare Worker — JAP /api/estimer
 * Secrets : wrangler secret put DEEPSEEK_API_KEY
 * Variables facultatives : DEEPSEEK_MODEL (défaut deepseek-flash), DEEPSEEK_BASE_URL
 */

const CATS_MAPPING = {
  mobilier: ['meuble', 'table', 'chaise', 'armoire', 'canapé', 'lit', 'bureau', 'commode', 'fauteuil', 'buffet'],
  art: ['tableau', 'peinture', 'sculpture', 'céramique', 'poterie', 'gravure', 'lithographie', 'déco', 'vase', 'statue'],
  bijoux: ['bijou', 'bague', 'collier', 'bracelet', 'montre', 'pendentif', 'broche', 'boucle', 'diamant'],
  vaisselle: ['vaisselle', 'assiette', 'verre', 'tasse', 'couverts', 'service', 'plat', 'carafe', 'soupière'],
  livres: ['livre', 'roman', 'encyclopédie', 'bande dessinée', 'bd ', 'dictionnaire'],
  electronique: ['téléphone', 'smartphone', 'ordinateur', 'tablette', 'drone', 'casque', 'console', 'appareil photo', 'caméra', 'télévision', 'téléviseur'],
  vetements: ['vêtement', 'manteau', 'robe', 'veste', 'chaussure', 'sac', 'maroquinerie', 'foulard'],
  vehicule: ['voiture', 'moto', 'vélo', 'scooter', 'trottinette', 'bateau'],
  outil: ['outil', 'perceuse', 'scie', 'marteau', 'jardinage', 'tondeuse', 'visseuse'],
};
function detectCategorie(objet = '') {
  const low = ' ' + String(objet).toLowerCase() + ' ';
  for (const [cat, keywords] of Object.entries(CATS_MAPPING)) {
    if (keywords.some(k => low.includes(k))) return cat;
  }
  return 'autre';
}

function extractJSON(text) {
  if (!text) return null;
  const tries = [text];
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a >= 0 && b > a) tries.push(text.slice(a, b + 1));
  for (const t of tries) { try { const v = JSON.parse(t); if (v && typeof v === 'object') return v; } catch { } }
  return null;
}

/** Même réglage que lib/deepseek.js : modèle vision, raisonnement désactivé, JSON forcé. */
async function deepseekJSON(env, messages, maxTokens = 800) {
  const base = env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
  let last = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL || 'deepseek-flash',
        temperature: attempt ? 0.4 : 0.2,
        max_tokens: maxTokens * (attempt + 1),
        thinking: { type: 'disabled' },
        response_format: { type: 'json_object' },
        messages,
      }),
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      const msg = { 401: 'Clé API refusée', 402: 'Solde DeepSeek insuffisant', 429: 'Trop de demandes, réessayez dans un instant', 503: 'Service DeepSeek surchargé' }[resp.status] || `DeepSeek ${resp.status}`;
      const e = new Error(msg); e.detail = t.slice(0, 300); throw e;
    }
    const data = await resp.json();
    last = data?.choices?.[0]?.message?.content || '';
    const parsed = extractJSON(last);
    if (parsed) return parsed;
  }
  throw new Error("Réponse de l'IA illisible");
}

async function duckduckgoSearch(query, maxResults = 5) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'JAP-App/1.0' } });
    const data = await resp.json();
    const results = [];
    const walk = arr => {
      for (const r of arr || []) {
        if (r.Topics) walk(r.Topics);
        else if (r.Text && r.FirstURL) results.push({ body: r.Text });
        if (results.length >= maxResults) return;
      }
    };
    walk(data.RelatedTopics);
    return results.slice(0, maxResults);
  } catch { return []; }
}

const n = v => { const x = parseFloat(v); return Number.isFinite(x) && x >= 0 ? Math.round(x) : 0; };
function normalize(est, objet, etat) {
  let [a, b, c] = [n(est.prix_min), n(est.prix_median), n(est.prix_max)].sort((x, y) => x - y);
  if (!b) b = Math.round((a + c) / 2);
  return {
    objet: String(est.objet || objet).slice(0, 140), etat: String(est.etat || etat || '').slice(0, 40),
    prix_neuf: n(est.prix_neuf), prix_min: a, prix_median: b, prix_max: c,
    devise: 'EUR', explication: String(est.explication || '').slice(0, 400),
  };
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (obj, status = 200) => Response.json(obj, { status, headers: corsHeaders });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
    if (url.pathname !== '/api/estimer' || request.method !== 'POST') return json({ error: 'Not Found' }, 404);

    try {
      if (!env.DEEPSEEK_API_KEY) return json({ error: 'Clé API non configurée' }, 500);
      const body = await request.json().catch(() => ({}));
      const { photo, contexte } = body;
      if (!photo || typeof photo !== 'string' || !photo.startsWith('data:image/')) return json({ error: 'Photo manquante ou invalide' }, 400);
      if (photo.length > 6_000_000) return json({ error: 'Photo trop lourde' }, 413);
      const ctx = String(contexte || '').slice(0, 300);

      // 1. Identification
      const id = await deepseekJSON(env, [
        { role: 'system', content: 'Tu identifies des objets sur des photos. Tu réponds toujours en JSON.' },
        { role: 'user', content: [
          { type: 'text', text: `Analyse cette image et identifie l'objet.${ctx ? `\nContexte donné par l'utilisateur (prioritaire) : ${JSON.stringify(ctx)}` : ''}\nRéponds en JSON : {"objet":"Nom complet","marque":"","modele":"","etat":"Neuf | Très bon état | Bon état | Usagé"}` },
          { type: 'image_url', image_url: { url: photo } },
        ] },
      ], 600);
      const objet = id.objet || ctx || 'objet inconnu';

      // 2. Recherche web (indicative)
      const [occ, neuf] = await Promise.all([
        duckduckgoSearch(`${objet} occasion prix`, 5),
        duckduckgoSearch(`${objet} prix neuf`, 3),
      ]);
      const web = [...occ.map(r => `[OCCASION] ${r.body.slice(0, 200)}`), ...neuf.map(r => `[NEUF] ${r.body.slice(0, 200)}`)].join('\n') || 'Aucune donnée trouvée.';

      // 3. Estimation
      const est = await deepseekJSON(env, [
        { role: 'system', content: "Expert en estimation de biens d'occasion en France. Réponds en JSON." },
        { role: 'user', content: `Objet : ${JSON.stringify(objet)}\nÉtat : ${JSON.stringify(id.etat || 'inconnu')}${ctx ? `\nContexte : ${JSON.stringify(ctx)}` : ''}\n\nDonnées internet :\n---\n${web}\n---\n\nRègles : valeur de revente d'occasion en euros, prix_min ≤ prix_median ≤ prix_max < prix_neuf.\nRéponds en JSON : {"objet":"","etat":"","prix_neuf":0,"prix_min":0,"prix_median":0,"prix_max":0,"devise":"EUR","explication":"1 à 2 phrases"}` },
      ], 800);

      const out = normalize(est, objet, id.etat);
      out.categorie = detectCategorie(objet);
      return json(out);
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  },
};
