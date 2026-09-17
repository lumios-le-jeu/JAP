require('dotenv').config();
const express = require('express');
const path = require('path');
const { OpenAI } = require('openai');

// Recherche DuckDuckGo via fetch natif Node.js
async function duckduckgoSearch(query, maxResults = 5) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'JAP-App/1.0' } });
    const data = await resp.json();
    const results = [];
    // Résultats relatifs
    for (const r of (data.RelatedTopics || [])) {
      if (r.Text && r.FirstURL) {
        results.push({ title: r.Text.slice(0, 80), body: r.Text, href: r.FirstURL });
        if (results.length >= maxResults) break;
      }
    }
    return results;
  } catch (e) {
    console.warn('DDG fetch error:', e.message);
    return [];
  }
}


const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname)));

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com',
});

// Catégories JAP pour classification automatique
const CATS_MAPPING = {
  mobilier:    ['meuble', 'table', 'chaise', 'armoire', 'canapé', 'lit', 'bureau', 'commode'],
  art:         ['tableau', 'peinture', 'sculpture', 'céramique', 'poterie', 'art', 'déco', 'vase'],
  bijoux:      ['bijou', 'bague', 'collier', 'bracelet', 'montre', 'pendentif', 'or', 'argent', 'diamant'],
  vaisselle:   ['vaisselle', 'assiette', 'verre', 'tasse', 'couverts', 'service'],
  livres:      ['livre', 'roman', 'encyclopédie', 'bande dessinée', 'bd'],
  electronique:['téléphone', 'ordinateur', 'tablette', 'drone', 'casque', 'console', 'appareil photo', 'caméra', 'tv', 'télévision'],
  vetements:   ['vêtement', 'manteau', 'robe', 'veste', 'chaussure', 'sac', 'maroquinerie'],
  vehicule:    ['voiture', 'moto', 'vélo', 'scooter', 'trottinette', 'bateau'],
  outil:       ['outil', 'perceuse', 'scie', 'marteau', 'jardinage', 'tondeuse'],
};

function detectCategorie(objet = '') {
  const low = objet.toLowerCase();
  for (const [cat, keywords] of Object.entries(CATS_MAPPING)) {
    if (keywords.some(k => low.includes(k))) return cat;
  }
  return 'autre';
}

// ─── ENDPOINT ESTIMER ────────────────────────────────────────────────────────
app.post('/api/estimer', async (req, res) => {
  try {
    const { photo, contexte } = req.body;
    if (!photo) return res.status(400).json({ error: 'Photo manquante' });

    // ── Étape 1 : Identification ──────────────────────────────────────────────
    const blocContexte = contexte
      ? `\nIMPORTANT — contexte utilisateur (priorité haute) : "${contexte}"\n`
      : '';

    const promptId = `Analyse cette image et identifie l'objet.${blocContexte}
Réponds EXCLUSIVEMENT en JSON :
{
  "objet": "Nom complet",
  "marque": "Marque",
  "modele": "Modèle exact",
  "etat": "Neuf / Très bon état / Bon état / Usagé"
}`;

    const respId = await client.chat.completions.create({
      model: 'deepseek-chat',
      response_format: { type: 'json_object' },
      temperature: 0,
      messages: [
        { role: 'system', content: 'Tu identifies des objets sur des photos. Tu réponds toujours en JSON.' },
        { role: 'user', content: [
          { type: 'text', text: promptId },
          { type: 'image_url', image_url: { url: photo } }
        ]}
      ],
    });
    const identification = JSON.parse(respId.choices[0].message.content);
    const objetComplet = identification.objet || contexte || 'objet inconnu';

    // ── Étape 2 : Recherche DuckDuckGo ────────────────────────────────────────
    const EXCLUS = ['bing.com/aclick', 'google.com/aclk', 'doubleclick.net'];
    let contexteWeb = '';
    try {
      const [resOcc, resNeuf] = await Promise.all([
        duckduckgoSearch(`${objetComplet} occasion prix acheter`, 5),
        duckduckgoSearch(`${objetComplet} prix neuf`, 3),
      ]);
      const lignes = [
        ...resOcc.map(r => `[OCCASION] ${r.title} — ${r.body.slice(0, 200)}`),
        ...resNeuf.map(r => `[NEUF] ${r.title} — ${r.body.slice(0, 200)}`),
      ];
      contexteWeb = lignes.join('\n') || 'Aucun résultat.';
    } catch (e) {
      console.warn('DuckDuckGo error:', e.message);
      contexteWeb = 'Recherche internet indisponible.';
    }

    // ── Étape 3 : Estimation ──────────────────────────────────────────────────
    const promptEstim = `Objet : ${objetComplet}
État : ${identification.etat}
${contexte ? `Contexte utilisateur : ${contexte}` : ''}

Données internet :
---
${contexteWeb}
---

Règles : prix_max < prix_neuf, base-toi sur les données réelles.
Réponds en JSON :
{
  "objet": "${objetComplet}",
  "etat": "${identification.etat}",
  "prix_neuf": 0.0,
  "prix_min": 0.0,
  "prix_median": 0.0,
  "prix_max": 0.0,
  "devise": "EUR",
  "explication": "1 à 2 phrases"
}`;

    const respEstim = await client.chat.completions.create({
      model: 'deepseek-chat',
      response_format: { type: 'json_object' },
      temperature: 0,
      messages: [
        { role: 'system', content: 'Expert estimation biens occasion. Réponds en JSON.' },
        { role: 'user', content: promptEstim }
      ],
    });
    const estimation = JSON.parse(respEstim.choices[0].message.content);

    // Détection catégorie automatique
    estimation.categorie = detectCategorie(objetComplet);

    res.json(estimation);

  } catch (err) {
    console.error('/api/estimer error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\x1b[32m✅ JAP server running → http://localhost:${PORT}\x1b[0m`);
});
