/**
 * Serveur local JAP : sert l'application et l'API /api/estimer.
 * Même logique que worker.js (Cloudflare), mais via lib/deepseek.js.
 */
require('dotenv').config();
const express = require('express');
const path = require('path');
const { chatJSON } = require('./lib/deepseek');

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

async function duckduckgoSearch(query, maxResults = 5) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'JAP-App/1.0' }, signal: AbortSignal.timeout(6000) });
    const data = await resp.json();
    const results = [];
    const walk = arr => {
      for (const r of arr || []) {
        if (r.Topics) walk(r.Topics);
        else if (r.Text && r.FirstURL) results.push({ title: r.Text.slice(0, 80), body: r.Text });
        if (results.length >= maxResults) return;
      }
    };
    walk(data.RelatedTopics);
    return results.slice(0, maxResults);
  } catch (e) {
    console.warn('DuckDuckGo :', e.message);
    return [];
  }
}

const n = v => { const x = parseFloat(v); return Number.isFinite(x) && x >= 0 ? Math.round(x) : 0; };
/** Remet les prix dans un ordre cohérent : min ≤ médian ≤ max. */
function normalize(est, objet, etat) {
  let [a, b, c] = [n(est.prix_min), n(est.prix_median), n(est.prix_max)].sort((x, y) => x - y);
  if (!b) b = Math.round((a + c) / 2);
  return {
    objet: String(est.objet || objet).slice(0, 140),
    etat: String(est.etat || etat || '').slice(0, 40),
    prix_neuf: n(est.prix_neuf), prix_min: a, prix_median: b, prix_max: c,
    devise: 'EUR', explication: String(est.explication || '').slice(0, 400),
  };
}

const app = express();
app.use(express.json({ limit: '8mb' }));

// Ne servir QUE les fichiers de l'application (pas .env, idea/, test/, server.js…)
const PUBLIC = ['index.html', 'app.js', 'style.css'];
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/:file', (req, res, next) => PUBLIC.includes(req.params.file) ? res.sendFile(path.join(__dirname, req.params.file)) : next());

app.post('/api/estimer', async (req, res) => {
  try {
    const { photo, contexte } = req.body || {};
    if (!photo || typeof photo !== 'string' || !photo.startsWith('data:image/')) return res.status(400).json({ error: 'Photo manquante ou invalide' });
    const ctx = String(contexte || '').slice(0, 300);

    // 1. Identification
    const { data: id } = await chatJSON([
      { role: 'system', content: 'Tu identifies des objets sur des photos. Tu réponds toujours en JSON.' },
      { role: 'user', content: [
        { type: 'text', text: `Analyse cette image et identifie l'objet.${ctx ? `\nContexte donné par l'utilisateur (prioritaire) : ${JSON.stringify(ctx)}` : ''}\nRéponds en JSON : {"objet":"Nom complet","marque":"","modele":"","etat":"Neuf | Très bon état | Bon état | Usagé"}` },
        { type: 'image_url', image_url: { url: photo } },
      ] },
    ], { maxTokens: 600 });
    const objet = id.objet || ctx || 'objet inconnu';

    // 2. Recherche web (indicative)
    const [occ, neuf] = await Promise.all([
      duckduckgoSearch(`${objet} occasion prix`, 5),
      duckduckgoSearch(`${objet} prix neuf`, 3),
    ]);
    const web = [...occ.map(r => `[OCCASION] ${r.body.slice(0, 200)}`), ...neuf.map(r => `[NEUF] ${r.body.slice(0, 200)}`)].join('\n') || 'Aucune donnée trouvée.';

    // 3. Estimation
    const { data: est } = await chatJSON([
      { role: 'system', content: "Expert en estimation de biens d'occasion en France. Réponds en JSON." },
      { role: 'user', content: `Objet : ${JSON.stringify(objet)}\nÉtat : ${JSON.stringify(id.etat || 'inconnu')}${ctx ? `\nContexte : ${JSON.stringify(ctx)}` : ''}\n\nDonnées internet :\n---\n${web}\n---\n\nRègles : valeur de revente d'occasion en euros, prix_min ≤ prix_median ≤ prix_max < prix_neuf.\nRéponds en JSON : {"objet":"","etat":"","prix_neuf":0,"prix_min":0,"prix_median":0,"prix_max":0,"devise":"EUR","explication":"1 à 2 phrases"}` },
    ], { maxTokens: 800 });

    const out = normalize(est, objet, id.etat);
    out.categorie = detectCategorie(objet);
    res.json(out);
  } catch (err) {
    console.error('/api/estimer :', err);
    res.status(err.status && err.status < 600 ? err.status : 500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => console.log(`\x1b[32m✅ JAP → http://localhost:${PORT}\x1b[0m`));
