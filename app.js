/* ================================================================
   JAP — Le Jour d'Après | app.js V6
================================================================ */
'use strict';
console.log("%c JAP v.0.1 ", "background: #8b5cf6; color: white; padding: 4px; border-radius: 4px;", "Application Initialized");

/* ── STORE ───────────────────────────────────────────────────── */
const supabaseUrl = "https://ucydckuzsbbfflbnxkkl.supabase.co";
const supabaseKey = "sb_publishable_hbsg3nktIYOasu0Kld7Hpg_pp9zh9_C";
const supabaseClient = window.supabase ? window.supabase.createClient(supabaseUrl, supabaseKey) : null;

const Store = {
  _get(k,d=null){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d;}catch{return d;}},
  _set(k,v){localStorage.setItem(k,JSON.stringify(v));},
  async getJaps(){
    if(!supabaseClient) return this._get('jap_list',[]);
    const local = this._get('jap_list',[]);
    const ids = local.map(j=>j.id);
    if(ids.length === 0) return [];
    const { data } = await supabaseClient.from('japs').select('data').in('id', ids);
    if(data) {
      const remote = data.map(d=>d.data);
      this._set('jap_list', remote);
      return remote;
    }
    return local;
  },
  async saveJaps(j){this._set('jap_list',j);},
  async getJap(id){
    if(supabaseClient) {
      const { data } = await supabaseClient.from('japs').select('data').eq('id', id).single();
      if(data) return data.data;
    }
    return this._get('jap_list',[]).find(j=>j.id===id)||null;
  },
  async getJapByCode(code){
    if(supabaseClient) {
      const { data } = await supabaseClient.from('japs').select('data').eq('code', code).single();
      if(data) {
        // Also save it locally so getJaps() finds it
        const list = this._get('jap_list',[]);
        if(!list.find(x=>x.id===data.data.id)) { list.unshift(data.data); this._set('jap_list', list); }
        return data.data;
      }
    }
    return this._get('jap_list',[]).find(j=>j.code===code)||null;
  },
  async saveJap(jap){
    const list = this._get('jap_list',[]);
    const i = list.findIndex(j=>j.id===jap.id);
    if(i>=0) list[i]=jap; else list.unshift(jap);
    this._set('jap_list', list);
    
    if(supabaseClient) {
      await supabaseClient.from('japs').upsert({ id: jap.id, code: jap.code, data: jap });
    }
  },
  async deleteJap(id){
    this._set('jap_list', this._get('jap_list',[]).filter(j=>j.id!==id));
    if(supabaseClient) await supabaseClient.from('japs').delete().eq('id', id);
  },
  getUser(){return this._get('jap_user',{email:'', nom:''});},
  setUser(u){this._set('jap_user',u);},
};

/* ── UTILS ───────────────────────────────────────────────────── */
const uid = ()=>Math.random().toString(36).slice(2,10);
const esc = s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const fmt = n=>(parseFloat(n)||0).toLocaleString('fr-FR',{minimumFractionDigits:0,maximumFractionDigits:0})+' €';
const ini = e=>(String(e||'?').split('@')[0]).slice(0,2).toUpperCase();

const CATS=[{v:'mobilier',l:'Mobilier',e:'🛋️'},{v:'art',l:'Art / Déco',e:'🖼️'},{v:'bijoux',l:'Bijoux',e:'💎'},{v:'vaisselle',l:'Vaisselle',e:'🍽️'},{v:'livres',l:'Livres',e:'📚'},{v:'electronique',l:'Électronique',e:'💻'},{v:'vetements',l:'Vêtements',e:'👗'},{v:'vehicule',l:'Véhicule',e:'🚗'},{v:'outil',l:'Outils',e:'🔧'},{v:'autre',l:'Autre',e:'📦'}];
const catE=v=>(CATS.find(c=>c.v===v)||{e:'📦'}).e;
const catL=v=>(CATS.find(c=>c.v===v)||{l:'Autre'}).l;

const STATUTS={prep:{label:'Préparation',css:'status-prep'},inv:{label:'Inventaire',css:'status-inv'},souhaits:{label:'Listes de souhaits',css:'status-wish'},partage:{label:'Partage terminé',css:'status-done'}};

function toast(msg,type='success'){
  const el=document.createElement('div'); el.className=`toast toast-${type}`; el.textContent=msg;
  document.getElementById('toast-container').appendChild(el); setTimeout(()=>el.remove(),3100);
}

const Modal={
  open(html){
    document.getElementById('modal-content').innerHTML=html; document.getElementById('modal-overlay').classList.remove('hidden');
    document.getElementById('modal-overlay').onclick=e=>{if(e.target===document.getElementById('modal-overlay'))Modal.close();};
  },
  close(){document.getElementById('modal-overlay').classList.add('hidden');},
};

const Router={
  routes:{}, add(pat,fn){this.routes[pat]=fn;}, go(path){location.hash=path;},
  match(hash){
    const path=hash.replace(/^#/,'')||'/';
    for(const[pat,fn]of Object.entries(this.routes)){
      const keys=[]; const re=new RegExp('^'+pat.replace(/:([^/]+)/g,(_,k)=>{keys.push(k);return'([^/]+)';})+[].join('')+'$');
      const m=path.match(re); if(m){ const params={}; keys.forEach((k,i)=>{params[k]=decodeURIComponent(m[i+1]);}); return{fn,params}; }
    }
    return null;
  },
  async dispatch(){ Modal.close(); const r=this.match(location.hash||'#/'); const app=document.getElementById('app'); if(r){app.innerHTML='<div class="view"><div class="empty-state">Chargement...</div></div>'; await r.fn(r.params);}else{app.innerHTML='<div class="view"><div class="empty-state">Introuvable</div></div>';} },
  init(){window.addEventListener('hashchange',()=>this.dispatch());this.dispatch();},
};

/* ── HELPERS DROITS ──────────────────────────────────────────── */
function getTargetHeir(jap) {
  const user = Store.getUser();
  if(!user.email) return { type: 'autre', heir: null };
  const asHeir = (jap.herit||[]).find(h => h.email && h.email.toLowerCase() === user.email.toLowerCase());
  if (asHeir) return { type: 'heritier', heir: asHeir };
  const asEnf = (jap.herit||[]).find(h => h.enfants && h.enfants.some(e => e.contact && e.contact.toLowerCase() === user.email.toLowerCase()));
  if (asEnf) return { type: 'enfant', heir: asEnf };
  return { type: 'autre', heir: null };
}

/* ── VUE ACCUEIL ─────────────────────────────────────────────── */
async function renderWelcome(){
  const japs=await Store.getJaps(); const user=Store.getUser();
  const list=japs.length?japs.map(j=>{
    const s=STATUTS[j.statut]||STATUTS.prep;
    return `<div class='jap-item card-clickable' onclick='Router.go("/jap/${j.id}")'>
      <div class='jap-item-avatar'>${ini(j.defunt)}</div>
      <div class='jap-item-info'><div class='jap-item-name'>${esc(j.defunt)}</div><div class='jap-item-meta'>${(j.herit||[]).length} héritier(s)</div></div>
      <span class='jap-item-status ${s.css}'>${s.label}</span>
    </div>`;
  }).join(''):`<div class='empty-state'><div class='empty-state-icon'>⚖️</div><div class='empty-state-title'>Aucune succession</div></div>`;

  document.getElementById('app').innerHTML=`
    <div class='welcome-hero' style="padding-top:24px">
      ${user.email ? `<div style="text-align:right;font-size:12px;opacity:0.8;margin-bottom:12px">👤 Connecté : ${user.email} <a href="#" onclick="Store.setUser({});renderWelcome()" style="color:white;text-decoration:underline;margin-left:8px">Déconnexion</a></div>` : ''}
      <div class='welcome-logo'>JAP</div><div class='welcome-logo-sub'>Le Jour d'Après</div>
      <div class='welcome-tagline'>Le tricount de l'héritage — partagez en toute équité</div>
      <div class='welcome-actions'>
        <button class='btn btn-primary' onclick='Router.go("/jap/new")'>✨ Nouveau JAP</button>
        <button class='btn btn-ghost' onclick='showJoin()'>🔗 Rejoindre un JAP</button>
      </div>
    </div>
    <div class='view'>${list}</div>`;
}

function showJoin(){
  Modal.open(`<div class='modal-title'>Rejoindre un JAP</div>
    <div class="form-group"><label class="form-label">Code JAP</label><input id='join-code' class='form-input mb-8' placeholder='ex: JAP_ABCD' /></div>
    <div class="form-group"><label class="form-label">Votre Email d'identification</label><input id='join-email' class='form-input mb-16' type='email' placeholder='votre@email.com' value='${Store.getUser().email||""}' /></div>
    <button class='btn btn-primary' onclick='doJoin()'>Accéder</button>`);
}
async function doJoin(){
  const c=document.getElementById('join-code').value.trim().toUpperCase();
  const email=document.getElementById('join-email').value.trim().toLowerCase();
  const j=await Store.getJapByCode(c);
  if(!email) return toast("Email requis pour s'identifier", "warning");
  if(j){
    Store.setUser({email: email}); Modal.close(); Router.go('/jap/'+j.id);
  } else toast('Code Introuvable','error');
}

/* ── VUE NOUVEAU JAP ─────────────────────────────────────────── */
let _njStep=1, _nj={};
function renderNewJap(){ _nj={id:uid(),code:"JAP_"+uid().toUpperCase(),createur:{},admins:[],herit:[],biens:[],statut:"prep"}; _njStep=1; renderNewJapStep(); }
function renderNewJapStep(){
  const app=document.getElementById("app");
  const sHtml=`<div class='steps'>${["Créateur", "Succession","Héritiers","Fin"].map((s,i)=>{
    const n=i+1, cls=n<_njStep?"done":n===_njStep?"active":"";
    return `<div class='step ${cls}' style='font-size:11px'>${s}</div>`;
  }).join("")}</div>`;
  const top=`<div class='topbar'><button class='topbar-back' onclick='_njStep>1?(_njStep--,renderNewJapStep()):Router.go("/")'>←</button><div class='topbar-title'>Nouveau JAP</div></div>`;
  
  let body="";
  if(_njStep===1){
    body=`<div class='form-group'><label class='form-label'>Votre Nom</label><input id='nj-c-nom' class='form-input' /></div>
    <div class='form-group'><label class='form-label'>Votre Prénom</label><input id='nj-c-pre' class='form-input' /></div>
    <div class='form-group'><label class='form-label'>Votre Email</label><input id='nj-c-emi' type='email' class='form-input' value='${Store.getUser().email||""}' /></div>
    <div class='form-group'><label class='form-label'>Votre Téléphone</label><input id='nj-c-tel' class='form-input' /></div>
    <div class='form-group'><label class='form-label'>Votre Adresse</label><input id='nj-c-adr' class='form-input' /></div>
    <div class='form-group'><label class='form-label'>Votre lien avec le défunt</label>
      <select id='nj-c-lie' class='form-select'>
         <option value='heritier'>Héritier direct</option>
         <option value='enfant'>Enfant d'un héritier</option>
         <option value='autre'>Autre (Notaire, Ami, etc.)</option>
      </select>
    </div>
    <div class='text-small text-muted mb-16' id="nj-c-hint">En tant qu'héritier, vous serez automatiquement ajouté à la liste des héritiers.</div>
    <button class='btn btn-primary w-full' onclick='njS1()'>Suivant (Succession)</button>`;
  }else if(_njStep===2){
    body=`<div class='form-group'><label class='form-label'>Nom du défunt *</label><input id='nj-def' class='form-input' value='${esc(_nj.defunt||"")}' /></div>
    <div class='form-group'><label class='form-label'>Adresse du défunt</label><input id='nj-adr' class='form-input' value='${esc(_nj.adresse||"")}' /></div>
    <div class='form-group'><label class='form-label'>Notaire / Étude</label><input id='nj-not' class='form-input' placeholder="Maître Dupont..." value='${esc(_nj.notaire||"")}' /></div>
    <div class='form-group'><label class='form-label'>Seuil de soulte de confort (€)</label><input id='nj-sou' class='form-input' type='number' value='${_nj.seuil||200}' /></div>
    <button class='btn btn-primary mt-16 w-full' onclick='njS2()'>Continuer</button>`;
  }else if(_njStep===3){
    const list=(_nj.herit||[]).map((h,i)=>{
      const enfantsHtml = (h.enfants && h.enfants.length) ? `<div class='text-small text-muted'>Enfant(s): ${h.enfants.map(e=>esc(e.nom)+' ('+esc(e.contact)+')').join(', ')}</div>` : '';
      return `<div class='heir-chip' style='align-items:flex-start'>
      <div class='heir-chip-avatar mt-4'>${ini(h.nom)}</div>
      <div class='heir-chip-info flex-1'>
        <div class='fw-700'>${esc(h.nom)} <span class="text-small text-muted" style="font-weight:normal">(${h.parts} part${h.parts>1?'s':''})</span></div>
        <div class='text-small text-muted'>${esc(h.email)} | Rôle: ${h.role}</div>
        ${h.recus>0 ? `<div class='text-small text-gold'>Déjà reçu: ${fmt(h.recus)}</div>`:''}
        ${enfantsHtml}
      </div>
      <button class='btn btn-sm btn-danger mt-4' onclick='_nj.herit.splice(${i},1);renderNewJapStep()'>×</button>
    </div>`}).join("");
    
    let hint = "";
    if(_nj.createur.lien === 'enfant') {
       hint = `<div class='card mb-16' style="background:rgba(255,255,255,0.05);padding:12px;font-size:12px">💡 Puisque vous êtes "Enfant d'héritier", n'oubliez pas d'ajouter votre parent à la liste ci-dessous, et de renseigner <b>votre e-mail (${_nj.createur.email})</b> dans ses enfants !</div>`;
    }

    body=`${hint}<div id='h-list' class="mb-16">${list}</div>
    <button class='btn btn-ghost w-full mb-24' style='border:1px dashed var(--border)' onclick='showAddHModal()'>+ Ajouter un héritier</button>
    <button class='btn btn-primary w-full' onclick='_nj.herit.length?(_njStep=4,renderNewJapStep()):toast("Ajoutez au moins un héritier","error")'>Suivant</button>`;
  }else{
    body=`<div class='card text-center mb-16'><div style='font-size:24px;font-weight:700'>⚖️ ${esc(_nj.defunt)}</div><div class='text-muted mt-8'>${esc(_nj.notaire)}</div><div class='text-gold fw-700 mt-8'>${_nj.herit.length} héritiers configurés</div></div><button class='btn btn-primary w-full' onclick='finNJ()'>✅ Créer le JAP</button>`;
  }
  app.innerHTML=top+`<div class='view'>${sHtml}${body}</div>`;

  if(_njStep===1) {
    document.getElementById('nj-c-lie').addEventListener('change', function(e) {
      const hint = document.getElementById('nj-c-hint');
      if(e.target.value === 'heritier') hint.innerHTML = "En tant qu'héritier, vous serez automatiquement ajouté à la liste des héritiers.";
      else if(e.target.value === 'enfant') hint.innerHTML = "Vous serez lié au panier de votre parent héritier. Vous pourrez l'indiquer à l'étape Héritiers.";
      else hint.innerHTML = "Vous aurez un accès en consultation du JAP.";
    });
  }
}

function njS1(){
  const no=document.getElementById("nj-c-nom").value.trim();
  const pr=document.getElementById("nj-c-pre").value.trim();
  const em=document.getElementById("nj-c-emi").value.trim().toLowerCase();
  const ad=document.getElementById("nj-c-adr").value.trim();
  const te=document.getElementById("nj-c-tel").value.trim();
  const li=document.getElementById("nj-c-lie").value;
  if(!no || !pr || !em) return toast("Nom, Prénom et Email requis", "error");

  _nj.createur = {nom:no, prenom:pr, email:em, tel:te, adresse:ad, lien:li};
  _nj.admins = [em]; // creator is admin
  Store.setUser({email: em, nom: pr+' '+no});

  if(li === 'heritier') {
    if(!_nj.herit.find(h=>h.email===em)) {
       _nj.herit.push({id:uid(), nom: pr+' '+no, email: em, role:'ayant_droit', parts:1, recus:0, enfants:[]});
    }
  }
  _njStep=2; renderNewJapStep();
}
function njS2(){ _nj.defunt=document.getElementById("nj-def").value.trim(); _nj.adresse=document.getElementById("nj-adr").value.trim(); _nj.notaire=document.getElementById("nj-not").value.trim(); _nj.seuil=document.getElementById("nj-sou").value; if(!_nj.defunt)return toast("Nom défunt requis","error"); _njStep=3; renderNewJapStep(); }

/* ── MODALE HERITIER (CREATION & EDITION) ────────────────────── */
function showAddHModal() {
  Modal.open(`<div class='modal-title'>Nouvel Héritier</div>
    <div class='form-group'><label class="form-label" style="text-transform:uppercase">Nom Complet</label><input id="ha-nom" class="form-input" placeholder="Ex: Jean Leborgne" /></div>
    <div class='form-group'><label class="form-label" style="text-transform:uppercase">Email</label><input id="ha-email" class="form-input" placeholder="jean@aol.com" /></div>
    <div class='flex gap-8 mb-16'>
      <div class='form-group flex-1'><label class="form-label" style="text-transform:uppercase">Rôle</label><select id="ha-role" class="form-select"><option value="ayant_droit">Ayant droit</option><option value="décédé">Décédé</option><option value="expert">Expert valeur</option></select></div>
      <div class='form-group flex-1'><label class="form-label" style="text-transform:uppercase">Nb Parts</label><input id="ha-parts" class="form-input" type="number" step="0.5" value="1" /></div>
    </div>
    <div class='form-group'><label class="form-label" style="text-transform:uppercase">Biens déjà reçus (€)</label><input id="ha-rec" class="form-input" type="number" placeholder="0" value="0" /></div>
    
    <label class="form-label" style="text-transform:uppercase">Enfant(s) de l'héritier</label>
    <div id="ha-enfants-container" class="mb-8"></div>
    <button class="btn btn-ghost btn-sm w-full mb-16" style="border:1px dashed var(--border)" onclick="uiAddEnfant()">+ Ajouter un enfant</button>

    <button class="btn btn-primary w-full mt-8" onclick="saveH()">Ajouter l'héritier</button>
  `);
}

async function showEditHModal(japId, hId = null) {
  const j = await Store.getJap(japId);
  const h = hId ? j.herit.find(x => x.id === hId) : {nom:'', email:'', role:'ayant_droit', parts:1, recus:0, enfants:[]};
  
  const enfHtml = (h.enfants||[]).map(e => `
    <div class="flex gap-8 mb-8 align-center enfant-row">
      <input class="form-input" style="flex:1" placeholder="Nom/Prénom" value="${esc(e.nom)}" />
      <input class="form-input" style="flex:1" placeholder="Email ou Tél" value="${esc(e.contact)}" />
      <button class="btn btn-sm btn-danger" style="padding:4px 8px" onclick="this.parentElement.remove()">×</button>
    </div>
  `).join('');

  Modal.open(`<div class='modal-title'>${hId ? 'Modifier Héritier' : 'Nouvel Héritier'}</div>
    <div class='form-group'><label class="form-label" style="text-transform:uppercase">Nom Complet</label><input id="ha-nom" class="form-input" value="${esc(h.nom)}" /></div>
    <div class='form-group'><label class="form-label" style="text-transform:uppercase">Email</label><input id="ha-email" class="form-input" value="${esc(h.email)}" /></div>
    <div class='flex gap-8 mb-16'>
      <div class='form-group flex-1'><label class="form-label" style="text-transform:uppercase">Rôle</label>
        <select id="ha-role" class="form-select">
          <option value="ayant_droit" ${h.role==='ayant_droit'?'selected':''}>Ayant droit</option>
          <option value="décédé" ${h.role==='décédé'?'selected':''}>Décédé</option>
          <option value="expert" ${h.role==='expert'?'selected':''}>Expert valeur</option>
        </select>
      </div>
      <div class='form-group flex-1'><label class="form-label" style="text-transform:uppercase">Nb Parts</label><input id="ha-parts" class="form-input" type="number" step="0.5" value="${h.parts}" /></div>
    </div>
    <div class='form-group'><label class="form-label" style="text-transform:uppercase">Biens déjà reçus (€)</label><input id="ha-rec" class="form-input" type="number" value="${h.recus}" /></div>
    
    <label class="form-label" style="text-transform:uppercase">Enfant(s) de l'héritier</label>
    <div id="ha-enfants-container" class="mb-8">${enfHtml}</div>
    <button class="btn btn-ghost btn-sm w-full mb-16" style="border:1px dashed var(--border)" onclick="uiAddEnfant()">+ Ajouter un enfant</button>

    <button class="btn btn-primary w-full mt-8" onclick="saveEditH('${japId}', '${hId||''}')">Enregistrer</button>
  `);
}

async function uiAddEnfant() {
  const c = document.getElementById("ha-enfants-container");
  const div = document.createElement("div"); div.className = "flex gap-8 mb-8 align-center enfant-row";
  div.innerHTML = `<input class="form-input" style="flex:1" placeholder="Nom/Prénom" /><input class="form-input" style="flex:1" placeholder="Email ou Tél" /><button class="btn btn-sm btn-danger" style="padding:4px 8px" onclick="this.parentElement.remove()">×</button>`;
  c.appendChild(div);
}

async function saveH() {
  const nom = document.getElementById("ha-nom").value.trim();
  if(!nom) return toast("Nom requis", "error");
  const enfantsArr = [];
  document.querySelectorAll('.enfant-row').forEach(r => {
    const inputs = r.querySelectorAll('input');
    const n = inputs[0].value.trim(); const c = inputs[1].value.trim().toLowerCase();
    if(n || c) enfantsArr.push({nom: n, contact: c});
  });

  _nj.herit.push({ id: uid(), nom: nom, email: document.getElementById("ha-email").value.trim().toLowerCase(), role: document.getElementById("ha-role").value, parts: parseFloat(document.getElementById("ha-parts").value)||1, recus: parseFloat(document.getElementById("ha-rec").value)||0, enfants: enfantsArr });
  Modal.close(); renderNewJapStep();
}

async function saveEditH(japId, hId) {
  const nom = document.getElementById("ha-nom").value.trim();
  if(!nom) return toast("Nom requis", "error");
  const enfantsArr = [];
  document.querySelectorAll('.enfant-row').forEach(r => {
    const inputs = r.querySelectorAll('input');
    const n = inputs[0].value.trim(); const c = inputs[1].value.trim().toLowerCase();
    if(n || c) enfantsArr.push({nom: n, contact: c});
  });

  const j = await Store.getJap(japId);
  if (!j.herit) j.herit = [];
  
  const hData = { 
    id: hId || uid(), 
    nom: nom, 
    email: document.getElementById("ha-email").value.trim().toLowerCase(), 
    role: document.getElementById("ha-role").value, 
    parts: parseFloat(document.getElementById("ha-parts").value)||1, 
    recus: parseFloat(document.getElementById("ha-rec").value)||0, 
    enfants: enfantsArr 
  };

  if (hId) {
    const idx = j.herit.findIndex(x => x.id === hId);
    if (idx >= 0) {
      hData.souhaits = j.herit[idx].souhaits; // keep wishlist if exists
      j.herit[idx] = hData;
    }
  } else {
    j.herit.push(hData);
  }

  await Store.saveJap(j);
  Modal.close();
  toast(hId ? "Héritier modifié" : "Héritier ajouté");
  renderDashboard({id: japId});
}

async function finNJ(){ await Store.saveJap(_nj); toast("JAP créé !"); Router.go("/jap/"+_nj.id); }

/* ── VIEW DASHBOARD ──────────────────────────────────────────── */
async function editInfosModal(id) {
  const j=await Store.getJap(id);
  Modal.open(`<div class='modal-title'>Modifier la succession</div>
    <input id='ei-def' class='form-input mb-8' placeholder='Défunt' value='${esc(j.defunt)}' />
    <input id='ei-not' class='form-input mb-8' placeholder='Notaire' value='${esc(j.notaire)}' />
    <input id='ei-sou' class='form-input mb-16' type='number' placeholder='Seuil soulte' value='${j.seuil||200}' />
    <button class='btn btn-primary' onclick='saveInfos("${id}")'>Enregistrer</button>`);
}
async function saveInfos(id) {
  const j=await Store.getJap(id); j.defunt=document.getElementById('ei-def').value.trim(); j.notaire=document.getElementById('ei-not').value.trim(); j.seuil=document.getElementById('ei-sou').value;
  if(j.defunt) { await Store.saveJap(j); Modal.close(); toast('Sauvegardé'); renderDashboard({id}); }
}

async function mkAdmin(id, email) {
  const j = await Store.getJap(id);
  if(!j.admins) j.admins = [];
  if(!j.admins.includes(email.toLowerCase())) j.admins.push(email.toLowerCase());
  await Store.saveJap(j);
  toast("Promu Administrateur !");
  renderDashboard({id});
}

async function renderDashboard({id}){
  const j=await Store.getJap(id); if(!j)return Router.go("/");
  const user = Store.getUser();
  const isAdmin = (j.admins||[]).includes((user.email||"").toLowerCase());
  const userRole = getTargetHeir(j); // {type: 'heritier'|'enfant'|'autre', heir: Object|null}

  const s=STATUTS[j.statut]||STATUTS.prep;
  document.getElementById("app").innerHTML=`<div class='topbar'><button class='topbar-back' onclick='Router.go("/")'>←</button><div class='topbar-title'>Tableau de bord</div><span class='jap-item-status ${s.css}'>${s.label}</span></div>
  <div class='view'>
    <div class='card mb-16'>
      <div class='card-title' style='font-size:20px'>⚖️ ${esc(j.defunt)}</div>
      <div class='text-muted mt-8'>Notaire: ${esc(j.notaire||'Non renseigné')}</div>
      <div class='text-gold fw-700 mt-8 mb-8'>Seuil soulte: ${fmt(j.seuil||200)}</div>
      ${isAdmin && j.statut==="prep"?"<button class='btn btn-ghost btn-sm' onclick='editInfosModal(\""+id+"\")'>✏️ Modifier infos</button>":""}
    </div>
  <div class='card mb-24 card-clickable' onclick='navigator.clipboard.writeText("${j.code}");toast("Code Copié !")'><div class='flex align-center justify-between'><div><div class='text-muted text-small'>Code d'invitation</div><div class='fw-700' style='font-size:16px;letter-spacing:1px'>${j.code}</div></div><span style='font-size:22px'>📋</span></div></div>
  
  ${isAdmin ? `
  <div class='section-title'>Actions Administrateur</div>
  <div style='display:grid;gap:10px'>
    ${j.statut==="partage"?`<button class='btn btn-gold' onclick='toast("Lien de résultats copié ! 📋")'>💌 Partager le résultat aux héritiers</button>`:((j.biens||[]).length?`<button class='btn btn-gold' onclick='lancerS("${id}")'>💌 Envoyer invitations aux héritiers</button>`:"")}
    ${j.statut==="souhaits"?`<button class='btn btn-primary' onclick='Router.go("/jap/${id}/partage")'>🎲 Lancer l'Algorithme de Partage</button>`:""}
  </div>` : ""}
  
  <div class='section-title mt-24 mb-16'>Espace Personnel (${isAdmin ? 'ADMINISTRATEUR' : userRole.type.toUpperCase()})</div>
  <div style='display:grid;gap:10px'>
    <button class='btn btn-primary' onclick='Router.go("/jap/${id}/inv")'>📸 Consulter l'Inventaire (${(j.biens||[]).length})</button>
    ${(userRole.type==='heritier' || userRole.type==='enfant') && (j.statut==="souhaits"||j.statut==="prep") ? 
      `<button class='btn btn-ghost' style="border:1px solid var(--violet)" onclick='Router.go("/jap/${id}/wish")'>❤️ Panier de Souhaits ${userRole.type==='enfant' ? `(Parent: ${esc(userRole.heir.nom)})` : ''}</button>` 
      : ''}
    ${j.statut==="partage" ? `<button class='btn btn-primary' onclick='Router.go("/jap/${id}/partage")'>🏆 Consulter les résultats</button>` : ""}
  </div>
  
  <div class='section-title mt-24'>Membres & Héritiers</div>
  ${(j.herit||[]).map(h=>{
    const estAdmin = (j.admins||[]).includes((h.email||"").toLowerCase());
    return `<div class='heir-chip'><div class='heir-chip-avatar'>${ini(h.nom)}</div><div class='heir-chip-info'><div class='fw-700'>${esc(h.nom)} ${estAdmin?`<span style="color:var(--gold);font-size:12px;margin-left:4px">👑 Admin</span>`:''} <span class="text-small text-muted" style="font-weight:normal;margin-left:4px">(${h.parts||1} part)</span></div><div class='text-muted text-small'>Biens reçus: ${fmt(h.recus||0)} | ${h.role}</div></div><div style="display:flex;flex-direction:column;gap:4px">${isAdmin && !estAdmin ? `<button class="btn btn-sm btn-ghost" style="font-size:10px;padding:4px 8px;" onclick="mkAdmin('${id}', '${esc(h.email)}')">Mettre Admin</button>` : ''}${isAdmin ? `<button class="btn btn-sm btn-ghost" style="font-size:10px;padding:4px 8px;" onclick="showEditHModal('${id}', '${h.id}')">✏️ Modifier</button>` : ''}</div></div>`
  }).join("")}
  ${isAdmin ? `<button class="btn btn-ghost w-full mb-16" style="border:1px dashed var(--border)" onclick="showEditHModal('${id}')">+ Ajouter un héritier / membre</button>` : ''}
  
  ${isAdmin ? `<button class='btn btn-danger btn-sm mt-32 mb-24 w-full' onclick='if(confirm("Supprimer définitivement la succession ?")){await Store.deleteJap("${id}");Router.go("/");}'>🗑️ Supprimer cette succession</button>` : ""}
  </div>`;
}
async function lancerS(id){ const j=await Store.getJap(id); j.statut="souhaits"; await Store.saveJap(j); toast("Invitations envoyées !"); renderDashboard({id}); }

/* ── VIEW INVENTAIRE ─────────────────────────────────────────── */
let tmpPhotoUrl = null;

// Compresse une image Data URL vers max 800px et qualité 0.7
// Nécessaire sur mobile où les photos peuvent faire 3-10 Mo en base64
function compressImage(dataUrl, maxPx = 800, quality = 0.7) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxPx || h > maxPx) {
        if (w > h) { h = Math.round(h * maxPx / w); w = maxPx; }
        else { w = Math.round(w * maxPx / h); h = maxPx; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl); // fallback sans compression
    img.src = dataUrl;
  });
}

function handlePhotoUpload(input) {
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = async function(e) {
      const preview = document.getElementById('b-photo-preview');
      // Compression avant stockage (critique sur mobile)
      tmpPhotoUrl = await compressImage(e.target.result);
      preview.src = tmpPhotoUrl;
      preview.style.display = 'block';
    };
    reader.readAsDataURL(input.files[0]);
  }
}
function runAIEval() {
  if(!tmpPhotoUrl) return toast("📸 Ajoutez une photo d'abord pour l'IA", "error");
  const nom = (document.getElementById("b-n").value||'').trim();
  const btn = document.getElementById("ai-btn");
  btn.innerHTML = "<i>Analyse...</i>"; btn.disabled = true;
  btn.classList.replace("btn-gold", "btn-ghost");

  fetch('https://jap-api.etienneleborgne.workers.dev/api/estimer', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ photo: tmpPhotoUrl, contexte: nom })
  })
  .then(r => r.json())
  .then(data => {
    if (data.error) { toast('Erreur IA : ' + data.error, 'error'); return; }
    // Remplir le prix
    if (data.prix_median) document.getElementById("b-v").value = data.prix_median;
    // Remplir la catégorie automatiquement si trouvée
    if (data.categorie) {
      const sel = document.getElementById("b-c");
      for (let o of sel.options) { if (o.value === data.categorie) { sel.value = data.categorie; break; } }
    }
    // Remplir le nom si vide
    if (!nom && data.objet) document.getElementById("b-n").value = data.objet;
    toast(`🤖 IA : ${data.prix_median}€ (${data.etat})`);
    // Afficher le résumé IA
    const resume = document.getElementById('ai-resume');
    if (resume) resume.innerHTML = `<div style="font-size:11px;color:var(--text-muted);margin-top:4px">📊 Min: ${data.prix_min}€ | Méd: ${data.prix_median}€ | Max: ${data.prix_max}€<br>${data.explication||''}</div>`;
  })
  .catch(err => { toast('Erreur réseau : ' + err.message, 'error'); })
  .finally(() => {
    btn.innerHTML = "🤖 Estimer (IA)"; btn.disabled = false;
    btn.classList.replace("btn-ghost", "btn-gold");
  });
}

async function renderInventaire({id}){
  const j=await Store.getJap(id); const b=j.biens||[];
  const isAdmin = (j.admins||[]).includes(Store.getUser().email.toLowerCase());
  const valTotal = b.reduce((a, c) => a + (parseFloat(c.val)||0), 0);
  
  document.getElementById("app").innerHTML=`<div class='topbar'><button class='topbar-back' onclick='Router.go("/jap/${id}")'>←</button><div class='topbar-title'>Inventaire</div></div>
  <div class='view'>
  ${!isAdmin ? `<div class="card mb-16 text-small" style="background:rgba(255,255,255,0.05)">Seuls les administrateurs peuvent ajouter ou modifier l'inventaire.</div>` : ""}
  <div class="wishlist-total mb-16"><div><div class="wishlist-total-label">V. Totale des Biens</div></div><div class="wishlist-total-value">${fmt(valTotal)}</div></div>
  ${b.length ? b.map((x,i)=>{
    const imgHtml = x.photo ? `<img src="${x.photo}" style="width:50px;height:50px;border-radius:10px;object-fit:cover;flex-shrink:0;" />` : `<div class='bien-list-emoji'>${catE(x.cat)}</div>`;
    return `<div class='bien-list-item' style='gap:12px'>${imgHtml}<div class='bien-list-info'><b>${esc(x.nom)}</b><div class='text-muted text-small'>${catL(x.cat)}</div></div><div class="text-gold fw-700 mr-8">${fmt(x.val)}</div>${isAdmin ? `<button class='btn btn-sm btn-ghost' style='padding:6px;width:32px;height:32px' onclick='delB("${id}",${i})'>×</button>` : ''}</div>`;
  }).join("") : `<div class="empty-state"><div class="empty-state-icon">📸</div><div class="empty-state-title">Aucun bien</div></div>`}</div>${isAdmin ? `<button class='fab' onclick='showAddB("${id}")'>+</button>` : ''}`;
}
function showAddB(id){ 
  tmpPhotoUrl = null;
  Modal.open(`<div class='modal-title'>Ajouter un bien</div>
    <div class="mb-16">
      <img id="b-photo-preview" style="display:none;width:100%;height:180px;object-fit:cover;border-radius:12px;margin-bottom:12px;" />
      <div style="display:flex;gap:8px">
        <label class="btn btn-ghost" style="flex:1;text-align:center">
          📸 Prendre une photo
          <input type="file" accept="image/*" capture="environment" style="display:none" onchange="handlePhotoUpload(this)">
        </label>
        <label class="btn btn-ghost" style="flex:1;text-align:center">
          🖼️ Depuis l'album
          <input type="file" accept="image/*" style="display:none" onchange="handlePhotoUpload(this)">
        </label>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Nom / Détail de l'objet</label>
      <input id='b-n' class='form-input' placeholder='Ex: Montre Tissot, état neuf, boîte incluse' />
    </div>
    <div style="display:flex;gap:8px;align-items:flex-end;margin-bottom:4px">
      <div class="form-group" style="flex:1;margin-bottom:0">
        <label class="form-label">Prix estimé (€)</label>
        <input id='b-v' class='form-input' type='number' placeholder='Prix €' />
      </div>
      <button id="ai-btn" class="btn btn-gold btn-sm" style="white-space:nowrap; height:45px;" onclick="runAIEval()">🤖 Estimer (IA)</button>
    </div>
    <div id="ai-resume" class="mb-12"></div>
    <div class="form-group">
      <label class="form-label">Catégorie</label>
      <select id='b-c' class='form-select'>${CATS.map(c=>`<option value='${c.v}'>${c.e} ${c.l}</option>`).join("")}</select>
    </div>
    <button class='btn btn-primary w-full mt-8' onclick='saveB("${id}")'>✅ Ajouter</button>`); 
}
async function saveB(id){
  const btn = document.querySelector('#modal-content .btn-primary');
  if(btn) { btn.disabled = true; btn.innerHTML = '⏳ Enregistrement...'; }
  try {
    const j = await Store.getJap(id);
    const n = document.getElementById("b-n").value.trim();
    if(!n) { if(btn){btn.disabled=false;btn.innerHTML='✅ Ajouter';} return toast("Nom requis", "error"); }
    if(!j.biens) j.biens = [];
    j.biens.push({
      id: uid(),
      nom: n,
      cat: document.getElementById("b-c").value,
      val: parseFloat(document.getElementById("b-v").value) || 0,
      photo: tmpPhotoUrl
    });
    await Store.saveJap(j);
    Modal.close();
    toast("✅ Bien ajouté !");
    renderInventaire({id});
  } catch(err) {
    console.error('saveB error:', err);
    if(btn) { btn.disabled = false; btn.innerHTML = '✅ Ajouter'; }
    // Erreur fréquente sur mobile : localStorage plein (quota dépassé)
    if(err && err.name === 'QuotaExceededError') {
      toast('❌ Stockage plein ! Essayez sans photo ou supprimez des biens.', 'error');
    } else {
      toast('❌ Erreur lors de la sauvegarde : ' + (err.message||err), 'error');
    }
  }
}
async function delB(id,i){ const j=await Store.getJap(id); j.biens.splice(i,1); await Store.saveJap(j); renderInventaire({id}); }

/* ── VIEW SOUHAITS TRIABLE ───────────────────────────────────── */
// Cache en mémoire du JAP courant — évite un appel Supabase à chaque action
let _japCache = null;

async function renderSouhaits({id}, cachedJap = null){
  // cachedJap permet d'éviter un re-fetch Supabase après une modification
  // (évite la race condition de réplication qui faisait disparaître les items du panier)
  const j = cachedJap || await Store.getJap(id);
  _japCache = j; // mise en cache pour les actions suivantes (togW, moveW)
  const userRole = getTargetHeir(j);
  if (userRole.type === 'autre') {
    toast("Membres simples n'ont pas de liste de souhaits.", "warning");
    Router.go(`/jap/${id}`);
    return;
  }
  
  const h = userRole.heir;
  const isEnfant = (userRole.type === 'enfant');
  const s = h.souhaits||[]; // array of IDs
  const b = j.biens||[];
  
  // CALCULS SOULTE THEORIQUE
  const totalBiens = b.reduce((a,c)=>a+(parseFloat(c.val)||0),0);
  const totalRecus = (j.herit||[]).reduce((a,c)=>a+(parseFloat(c.recus)||0),0);
  const actifNet = totalBiens + totalRecus;
  const partsCumul = (j.herit||[]).reduce((a,c)=>a+(parseFloat(c.parts)||1),0);
  const valParPart = partsCumul>0 ? actifNet/partsCumul : 0;
  const myPartTheo = valParPart * (parseFloat(h.parts)||1);
  const wishVal = s.reduce((a, bid) => { const bien = b.find(x=>x.id===bid); return a+(bien?(parseFloat(bien.val)||0):0); }, 0);
  
  const diffTheo = (wishVal + (parseFloat(h.recus)||0)) - myPartTheo;
  let soulteColor = "var(--text-color)";
  let txtSoulte = `Valeur cible atteinte ✓`;
  if (diffTheo > (j.seuil||200)) { soulteColor = "#ef4444"; txtSoulte = `⚠️ Vous devrez verser une soulte estimée à ${fmt(diffTheo)}`; }
  else if (diffTheo < -(j.seuil||200)) { soulteColor = "var(--gold)"; txtSoulte = `Vous devriez recevoir une soulte de ${fmt(-diffTheo)}`; }

  const rankHtml = s.map((bid, i) => {
    const obj = b.find(x=>x.id===bid); if(!obj) return "";
    return `<div class='bien-list-item' style='gap:12px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05)'>
      <div style='font-size:12px;font-weight:700;color:var(--gold);width:16px;text-align:center'>${i+1}</div>
      ${obj.photo?`<img src="${obj.photo}" style="width:40px;height:40px;border-radius:8px;object-fit:cover" />`:`<div class='bien-list-emoji' style="width:40px;height:40px;">${catE(obj.cat)}</div>`}
      <div class='flex-1'><div style='font-weight:600;font-size:14px'>${esc(obj.nom)}</div><div class='text-muted text-small'>${fmt(obj.val)}</div></div>
      ${!isEnfant ? `<div style='display:flex;flex-direction:column;gap:4px'>
         ${i>0?`<button class='btn btn-ghost btn-sm' style='padding:2px 8px;font-size:10px' onclick='moveW("${id}","${h.id}",${i},-1)'>▲</button>`:`<div style='height:20px'></div>`}
         ${i<s.length-1?`<button class='btn btn-ghost btn-sm' style='padding:2px 8px;font-size:10px' onclick='moveW("${id}","${h.id}",${i},1)'>▼</button>`:`<div style='height:20px'></div>`}
      </div>` : `<div class="text-small text-muted" style="width:40px;text-align:center">Lock</div>`}
      <button class='btn btn-sm btn-ghost' style="color:var(--text-muted);font-size:18px" onclick='togW("${id}","${h.id}","${bid}")'>×</button>
    </div>`;
  }).join("");

  const availHtml = b.filter(x=>!s.includes(x.id)).map(x=>{
    return `<div class='bien-list-item card-clickable' onclick='togW("${id}","${h.id}","${x.id}")' style='gap:12px'>
      ${x.photo?`<img src="${x.photo}" style="width:40px;height:40px;border-radius:8px;object-fit:cover" />`:`<div class='bien-list-emoji' style="width:40px;height:40px;">${catE(x.cat)}</div>`}
      <div class='flex-1'><b>${esc(x.nom)}</b><br><span class="text-gold fw-700">${fmt(x.val)}</span></div>
      <div class="text-muted" style="font-size:20px">+</div>
    </div>`;
  }).join("");

  document.getElementById("app").innerHTML=`<div class='topbar'><button class='topbar-back' onclick='Router.go("/jap/${id}")'>←</button><div class='topbar-title'>${isEnfant ? `Panier (${esc(h.nom)})` : "Ma liste triée"}</div></div>
  <div class='view'>
    ${isEnfant ? `<div class="card mb-16" style="background:var(--violet);color:white;font-size:13px"><div class="fw-700">Vous agissez pour ${esc(h.nom)}</div><div>Vous pouvez ajouter/retirer des objets au panier, mais seul l'héritier peut modifier l'ordre des priorités.</div></div>` : ''}
    <div class="card mb-24">
      <div class="flex align-center justify-between mb-8">
        <span class="text-muted text-small">Part Théorique (${h.parts||1} part) :</span>
        <span class="fw-700">${fmt(myPartTheo)}</span>
      </div>
      <div class="flex align-center justify-between mb-8">
        <span class="text-muted text-small">Valeur du panier :</span>
        <span class="fw-700">${fmt(wishVal)}</span>
      </div>
      <div class="divider"></div>
      <div style="color:${soulteColor};font-weight:600;font-size:13px;text-align:center">${txtSoulte}</div>
    </div>
    
    <div class='section-title'>1. Choix du panier</div>
    <div class="mb-24">${s.length ? rankHtml : `<div class='empty-state text-small'>Sélectionnez des biens ci-dessous</div>`}</div>
    
    <div class='section-title'>2. Tous les biens disponibles</div>
    <div class="mb-24">${availHtml || `<div class='text-muted text-center text-small mt-8'>Tous les biens ont été sélectionnés.</div>`}</div>
    
    <button class='btn btn-primary w-full' onclick='Router.go("/jap/${id}")'>✅ Enregistrer ${isEnfant?'le panier':'ma liste'}</button>
  </div>`;
}

async function togW(id, hId, bid){ 
  // Utilise le cache mémoire pour éviter l'appel Supabase (qui bloquait 1-3s sur mobile)
  const j = _japCache || await Store.getJap(id);
  const h=j.herit.find(x=>x.id===hId); 
  if(!h.souhaits)h.souhaits=[]; const idx=h.souhaits.indexOf(bid); 
  if(idx>=0)h.souhaits.splice(idx,1); else h.souhaits.push(bid);
  // Affiche immédiatement (UX instantée)
  renderSouhaits({id}, j);
  // Sauvegarde en arrière-plan sans bloquer l'affichage
  Store.saveJap(j).catch(err => { console.error('togW save error:', err); toast('❌ Erreur sauvegarde', 'error'); });
}
async function moveW(id, hId, idx, dir){ 
  // Utilise le cache mémoire pour éviter l'appel Supabase (qui bloquait 1-3s sur mobile)
  const j = _japCache || await Store.getJap(id);
  const h=j.herit.find(x=>x.id===hId); 
  const s=h.souhaits; const n=idx+dir; if(n<0||n>=s.length)return; 
  [s[idx], s[n]]=[s[n], s[idx]];
  // Affiche immédiatement (UX instantée)
  renderSouhaits({id}, j);
  // Sauvegarde en arrière-plan sans bloquer l'affichage
  Store.saveJap(j).catch(err => { console.error('moveW save error:', err); toast('❌ Erreur sauvegarde', 'error'); });
}

/* ── VIEW PARTAGE & RESULTAT ─────────────────────────────────── */
async function renderPartage({id}){
  const j=await Store.getJap(id);
  if(j.statut==="partage") return showResult(j);
  document.getElementById("app").innerHTML=`<div class='topbar'><button class='topbar-back' onclick='Router.go("/jap/${id}")'>←</button><div class='topbar-title'>Algorithme JAP</div></div>
  <div class='view'><div class='lottery-box mb-24'><div class='lottery-emoji' style='font-size:64px;margin-bottom:16px'>🎲</div><div class='lottery-title' style='font-size:22px'>Lancer le Partage</div><p class='text-muted mt-8'>L'algorithme va attribuer équitablement les biens selon les souhaits, résoudre les conflits aléatoirement, et calculer automatiquement les soultes compensatoires.</p></div><button class='btn btn-primary w-full' style='font-size:18px;padding:20px' onclick='doP("${id}")'>Lancer la répartition ⚖️</button></div>`;
}

function calcSoultes(jap) {
  const partsCumul = jap.herit.reduce((a,c)=>a+(parseFloat(c.parts)||1),0);
  const totalBiens = jap.biens.reduce((a,c)=>a+(parseFloat(c.val)||0),0);
  const totalRecus = jap.herit.reduce((a,c)=>a+(parseFloat(c.recus)||0),0);
  const valParPart = partsCumul > 0 ? (totalBiens+totalRecus)/partsCumul : 0;

  jap.herit.forEach(h => {
    let recu = parseFloat(h.recus)||0;
    (h.souhaits||[]).forEach(bid => {
      const b = jap.biens.find(x=>x.id===bid);
      if(b) recu += (parseFloat(b.val)||0);
    });
    const partTheo = parseFloat(h.parts||1) * valParPart;
    h.soulte = recu - partTheo; 
  });
  return jap;
}

async function doP(id){ 
  let j=await Store.getJap(id); j.statut="partage"; j = calcSoultes(j); await Store.saveJap(j); toast("Répartition terminée !"); showResult(j); 
}

function showResult(j) {
  const app = document.getElementById("app");
  const totalBiens = j.biens.reduce((a,c)=>a+(parseFloat(c.val)||0),0);
  const totalRecus = j.herit.reduce((a,c)=>a+(parseFloat(c.recus)||0),0);
  
  let hCards = j.herit.map(h => {
    const s = h.soulte || 0;
    const thresh = j.seuil || 200;
    let sInfo = { text: "Partage équilibré ✓", class:"soulte-zero" };
    if (s > thresh) sInfo = { text: `Doit payer soulte: ${fmt(s)}`, class:"soulte-neg" };
    else if (s < -thresh) sInfo = { text: `Va recevoir: ${fmt(-s)}`, class:"soulte-pos" };

    let recuDyn = 0;
    const htmlBiens = (h.souhaits||[]).map(bid => {
       const b = j.biens.find(x=>x.id===bid);
       if(b) recuDyn += (parseFloat(b.val)||0);
       return b ? `<div class="result-bien-item"><span>${catE(b.cat)}</span><span class="flex-1">${esc(b.nom)}</span><strong class="text-gold">${fmt(b.val)}</strong></div>` : '';
    }).join("");

    return `<div class='heir-result-card mb-16'>
      <div class='heir-result-header'>
         <div class='heir-result-avatar'>${ini(h.nom)}</div>
         <div class="flex-1">
           <div class='fw-700' style="font-size:16px">${esc(h.nom)}</div>
           <div class='text-muted text-small'>Attribué: ${fmt(recuDyn)} | Déjà reçu: ${fmt(h.recus||0)}</div>
         </div>
         <div class='heir-result-soulte ${sInfo.class}' style="text-align:right">${sInfo.text}</div>
      </div>
      <div style="padding:0 16px 16px 16px;">
        <div class="divider mt-8 mb-8"></div>
        <div class="text-muted text-small fw-700 mb-8 uppercase">Biens attribués (${(h.souhaits||[]).length})</div>
        ${htmlBiens || '<div class="text-muted text-small">Aucun bien</div>'}
      </div>
    </div>`;
  }).join("");

  app.innerHTML=`<div class='topbar'><button class='topbar-back' onclick='Router.go("/jap/${j.id}")'>←</button><div class='topbar-title'>Résultats Officiels</div></div>
  <div class='view'>
    <div class="wishlist-total mb-24" style="background:var(--bg-dark)">
      <div><div class="wishlist-total-label">Actif Successoral Net</div></div>
      <div class="wishlist-total-value">${fmt(totalBiens + totalRecus)}</div>
    </div>
    ${hCards}
    <button class="btn btn-ghost w-full mt-16" onclick="window.print()">📥 Télécharger Protocole (PDF)</button>
  </div>`;
}

/* ── INIT ────────────────────────────────────────────────────── */
Router.add("/",renderWelcome);
Router.add("/jap/new",renderNewJap);
Router.add("/jap/:id",renderDashboard);
Router.add("/jap/:id/inv",renderInventaire);
Router.add("/jap/:id/wish",renderSouhaits);
Router.add("/jap/:id/partage",renderPartage);
Router.init();
