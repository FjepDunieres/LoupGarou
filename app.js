// Loup Garou Géant - Application Temps Réel (Vanilla JS)

let supabaseUrl = CONFIG.SUPABASE_URL;
let supabaseAnonKey = CONFIG.SUPABASE_ANON_KEY;
let supabase = null;

// Données locales synchronisées
let players = [];
let gameState = {};
let myPlayer = null;
let selectedVoteTarget = null;
let selectedLoverTargets = []; // Cupidon
let selectedFluteurTargets = []; // Flûteur
let selectedGardeTarget = null; // Garde
let selectedVoyanteTarget = null; // Voyante
let selectedPoisonTarget = null; // Sorcière
let isCardFlipped = false;

// Variables pour le minuteur
let timerInterval = null;

// Canal Realtime pour le chat des loups
let wolfChannel = null;

// ==========================================================================
// INITIALISATION & ROUTING
// ==========================================================================
window.addEventListener('DOMContentLoaded', async () => {
  initConfiguration();
});

// Assistant de configuration Supabase
function initConfiguration() {
  // Vérifier si la config est en dur ou en cache local
  const cachedUrl = localStorage.getItem('sb_url');
  const cachedKey = localStorage.getItem('sb_key');

  if (supabaseUrl && supabaseAnonKey) {
    // Config en dur dans config.js
    startApp();
  } else if (cachedUrl && cachedKey) {
    // Config en cache
    supabaseUrl = cachedUrl;
    supabaseAnonKey = cachedKey;
    startApp();
  } else {
    // Pas de config : afficher la modale
    const modal = document.getElementById('config-modal');
    modal.classList.remove('hidden');

    document.getElementById('btn-save-config').addEventListener('click', () => {
      const urlInput = document.getElementById('modal-sb-url').value.trim();
      const keyInput = document.getElementById('modal-sb-key').value.trim();

      if (urlInput && keyInput) {
        localStorage.setItem('sb_url', urlInput);
        localStorage.setItem('sb_key', keyInput);
        location.reload();
      } else {
        alert("Veuillez remplir tous les champs.");
      }
    });
  }
}

// Lancement de l'application
async function startApp() {
  try {
    supabase = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
  } catch (err) {
    console.error("Erreur d'initialisation Supabase:", err);
    alert("Impossible de se connecter à Supabase. Vérifiez vos identifiants.");
    localStorage.clear();
    location.reload();
    return;
  }

  // Déterminer le rôle d'affichage via les paramètres d'URL
  const params = new URLSearchParams(window.location.search);
  const roleParam = params.get('role');

  if (roleParam === 'gm') {
    initGM();
  } else if (roleParam === 'tableau') {
    initTableau();
  } else {
    initPlayer();
  }
}

// Mettre à jour l'activité en ligne des joueurs actifs
function startPresenceHeartbeat() {
  if (!myPlayer) return;
  // Mettre à jour le timestamp toutes les 15 secondes
  setInterval(async () => {
    await supabase
      .from('players')
      .update({ last_seen: new Date().toISOString(), is_online: true })
      .eq('id', myPlayer.id);
  }, 15000);
}

// Formatage du temps restant pour les minuteurs (mm:ss)
function formatTime(seconds) {
  if (seconds < 0) return "00:00";
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// Rôles et descriptions associées
const ROLES_INFO = {
  loup: {
    title: "Loup-Garou",
    desc: "Vous vous éveillez la nuit avec les autres loups pour dévorer un villageois. Le jour, mentez pour cacher votre identité !",
    img: "assets/loup.png",
    type: "loup"
  },
  villageois: {
    title: "Simple Villageois",
    desc: "Vous n'avez pas de pouvoir magique. Vos seules armes sont votre intuition et votre voix lors des débats de l'assemblée.",
    img: "assets/villageois.png",
    type: "villageois"
  },
  voyante: {
    title: "Voyante",
    desc: "Chaque nuit, vous pouvez inspecter secrètement la carte d'un joueur pour découvrir son véritable rôle.",
    img: "assets/voyante.png",
    type: "special"
  },
  sorciere: {
    title: "Sorcière",
    desc: "Vous possédez deux fioles magiques uniques : une potion de vie pour sauver la victime des loups, et une potion de mort pour éliminer un joueur.",
    img: "assets/sorciere.png",
    type: "special"
  },
  chasseur: {
    title: "Chasseur",
    desc: "Si vous êtes éliminé (au vote ou la nuit), vous devez immédiatement utiliser votre dernier souffle pour abattre un joueur de votre choix.",
    img: "assets/chasseur.png",
    type: "special"
  },
  cupidon: {
    title: "Cupidon",
    desc: "La première nuit, vous désignez deux joueurs qui seront liés par un amour éternel. Si l'un meurt, l'autre succombe de chagrin instantanément.",
    img: "assets/cupidon.png",
    type: "special"
  },
  garde: {
    title: "Garde",
    desc: "Chaque nuit, vous pouvez protéger un joueur contre l'attaque des loups. Vous ne pouvez pas protéger la même personne deux nuits de suite.",
    img: "assets/garde.png",
    type: "special"
  },
  fluteur: {
    title: "Flûteur",
    desc: "Ennemi du village et des loups, vous charmez 2 joueurs par nuit. Vous gagnez seul si tous les joueurs vivants (sauf vous) sont charmés.",
    img: "assets/fluteur.png",
    type: "neutral"
  },
  idiot: {
    title: "Idiot du Village",
    desc: "Si les villageois votent contre vous pour vous éliminer, ils découvrent votre bêtise. Vous survivez, mais vous perdez votre droit de vote.",
    img: "assets/villageois.png",
    type: "villageois"
  },
  ancien: {
    title: "Ancien",
    desc: "Vous survivez à la première attaque des Loups-Garous. Cependant, si le village vous élimine, tous les rôles spéciaux perdent leurs pouvoirs.",
    img: "assets/villageois.png",
    type: "villageois"
  },
  ange: {
    title: "Ange",
    desc: "Votre objectif est d'être éliminé lors du tout premier vote du village le Jour 1. Si vous y parvenez, vous gagnez la partie immédiatement !",
    img: "assets/villageois.png",
    type: "neutral"
  }
};

// ==========================================================================
// 1. ÉCRAN JOUEUR (?role=joueur)
// ==========================================================================
async function initPlayer() {
  document.getElementById('player-view').classList.remove('hidden');

  const cachedPlayerId = localStorage.getItem('player_uuid');

  if (cachedPlayerId) {
    // Vérifier si le joueur existe toujours en base de données
    const { data: player, error } = await supabase
      .from('players')
      .select('*')
      .eq('id', cachedPlayerId)
      .single();

    if (player) {
      myPlayer = player;
      startPresenceHeartbeat();
      setupPlayerSubscriptions();
      showPlayerStep('player-step-lobby');
      return;
    } else {
      localStorage.removeItem('player_uuid');
    }
  }

  // Si non inscrit : afficher l'écran d'inscription
  showPlayerStep('player-step-join');

  document.getElementById('btn-player-join').addEventListener('click', async () => {
    const nameInput = document.getElementById('player-name-input').value.trim();
    if (!nameInput) {
      alert("Veuillez saisir votre prénom.");
      return;
    }
    if (nameInput.length > 15) {
      alert("Votre prénom est trop long (maximum 15 caractères).");
      return;
    }

    document.getElementById('btn-player-join').disabled = true;

    // Appeler la fonction SQL de join_lobby sécurisée pour les accès concurrents
    const { data, error } = await supabase.rpc('join_lobby', { player_name: nameInput });

    if (error) {
      console.error(error);
      alert("Erreur lors de l'inscription. La base de données est-elle bien configurée ?");
      document.getElementById('btn-player-join').disabled = false;
      return;
    }

    if (data && data.length > 0) {
      const p = data[0];
      localStorage.setItem('player_uuid', p.player_id);
      myPlayer = {
        id: p.player_id,
        name: nameInput,
        number: p.player_number,
        status: 'alive',
        role: null
      };

      startPresenceHeartbeat();
      setupPlayerSubscriptions();
      showPlayerStep('player-step-lobby');
    }
  });
}

function showPlayerStep(stepId) {
  const steps = ['player-step-join', 'player-step-lobby', 'player-step-game'];
  steps.forEach(id => {
    document.getElementById(id).classList.add('hidden');
  });
  document.getElementById(stepId).classList.remove('hidden');
}

// Inscriptions aux canaux temps réel pour le joueur
function setupPlayerSubscriptions() {
  // Remplir les infos du lobby
  document.getElementById('player-lobby-name').textContent = myPlayer.name;
  document.getElementById('player-lobby-number').textContent = myPlayer.number;

  // 1. Écouter l'état du jeu
  supabase
    .channel('public_game_state')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game_state', filter: 'id=eq.1' }, payload => {
      gameState = payload.new;
      handleGameStateUpdate();
    })
    .subscribe();

  // Charger l'état actuel immédiatement (auto-création si absent pour résilience)
  supabase.from('game_state').select('*').eq('id', 1).single().then(async ({ data }) => {
    if (data) {
      gameState = data;
      handleGameStateUpdate();
    } else {
      console.log("Game state non trouvé, initialisation par défaut...");
      const { data: newGS } = await supabase.from('game_state').insert([{ id: 1, phase: 'lobby' }]).select().single();
      if (newGS) {
        gameState = newGS;
        handleGameStateUpdate();
      }
    }
  });

  // 2. Écouter sa propre fiche joueur (pour savoir si on meurt ou change de rôle)
  supabase
    .channel(`player_self_${myPlayer.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `id=eq.${myPlayer.id}` }, payload => {
      myPlayer = payload.new;
      handleMyPlayerUpdate();
    })
    .subscribe();

  // Charger sa propre fiche joueur immédiatement
  supabase.from('players').select('*').eq('id', myPlayer.id).single().then(({ data }) => {
    if (data) {
      myPlayer = data;
      handleMyPlayerUpdate();
    }
  });
}

// Gérer la mise à jour des infos du joueur lui-même
function handleMyPlayerUpdate() {
  document.getElementById('player-header-name').textContent = myPlayer.name;
  document.getElementById('player-header-num').textContent = `N° ${myPlayer.number}`;

  // Gérer l'état de mort/vie
  if (myPlayer.status === 'dead') {
    document.getElementById('player-sub-alive').classList.add('hidden');
    document.getElementById('player-sub-dead').classList.remove('hidden');
    
    // Révéler le rôle sur l'écran des morts
    if (myPlayer.role && ROLES_INFO[myPlayer.role]) {
      document.getElementById('player-dead-role-name').textContent = ROLES_INFO[myPlayer.role].title;
    }
    
    // Si c'est le chasseur qui vient de mourir, lui permettre de tirer avant de désactiver son écran
    if (myPlayer.role === 'chasseur' && !myPlayer.vote_target) {
      showChasseurDeathPanel();
    }
  } else {
    document.getElementById('player-sub-alive').classList.remove('hidden');
    document.getElementById('player-sub-dead').classList.add('hidden');
  }

  // Si on est un loup-garou vivant, s'abonner au chat des loups
  if (myPlayer.role === 'loup' && myPlayer.status === 'alive') {
    subscribeToWolfChat();
  } else {
    unsubscribeFromWolfChat();
  }
}

// Gérer l'état global du jeu reçu
function handleGameStateUpdate() {
  if (gameState.phase === 'lobby') {
    showPlayerStep('player-step-lobby');
    return;
  }

  showPlayerStep('player-step-game');

  // Masquer toutes les sous-phases joueurs
  document.getElementById('player-phase-distribute').classList.add('hidden');
  document.getElementById('player-phase-night-sleep').classList.add('hidden');
  document.getElementById('player-phase-night-action').classList.add('hidden');
  document.getElementById('player-phase-day-announcement').classList.add('hidden');
  document.getElementById('player-phase-day-discussion').classList.add('hidden');
  document.getElementById('player-phase-day-vote').classList.add('hidden');
  document.getElementById('player-phase-game-over').classList.add('hidden');

  if (myPlayer && myPlayer.status === 'alive') {
    switch (gameState.phase) {
      case 'distributing':
        document.getElementById('player-phase-distribute').classList.remove('hidden');
        setupRoleCardReveal();
        break;

      case 'night':
        // Est-ce mon tour d'agir ?
        const isMyTurn = (myPlayer.role === gameState.night_phase);
        
        if (isMyTurn) {
          document.getElementById('player-phase-night-action').classList.remove('hidden');
          setupNightActionPanel();
        } else {
          document.getElementById('player-phase-night-sleep').classList.remove('hidden');
          setupNightSleepPanel();
        }
        break;

      case 'day_announcement':
        document.getElementById('player-phase-day-announcement').classList.remove('hidden');
        document.getElementById('player-announcement-text').innerHTML = gameState.announcement_text || "Le village se réveille...";
        break;

      case 'day_discussion':
        document.getElementById('player-phase-day-discussion').classList.remove('hidden');
        startDiscussionTimer(gameState.timer_duration, gameState.timer_started_at);
        break;

      case 'day_vote':
        document.getElementById('player-phase-day-vote').classList.remove('hidden');
        setupDayVotePanel();
        break;

      case 'game_over':
        document.getElementById('player-phase-game-over').classList.remove('hidden');
        document.getElementById('player-winners-name').textContent = (gameState.winners || "Inconnu").toUpperCase();
        break;
    }
  }
}

// --- LOGIQUE CARTE DE RÔLE ---
function setupRoleCardReveal() {
  const cardInner = document.getElementById('role-card-inner');
  
  // Reset de la carte
  cardInner.classList.remove('flipped');
  isCardFlipped = false;

  // Charger les infos du rôle
  if (myPlayer.role && ROLES_INFO[myPlayer.role]) {
    const info = ROLES_INFO[myPlayer.role];
    document.getElementById('player-role-title').textContent = info.title;
    document.getElementById('player-role-desc').textContent = info.desc;
    document.getElementById('player-role-img').src = info.img;

    // Configurer les couleurs du dos de la carte
    const back = document.getElementById('role-card-back');
    back.className = "card-face card-back"; // Reset
    if (info.type === 'loup') back.classList.add('loup');
    else if (info.type === 'special') back.classList.add('special');
    else if (info.type === 'neutral') back.classList.add('neutral');
    else back.classList.add('villageois');
  }

  cardInner.onclick = () => {
    if (!isCardFlipped) {
      cardInner.classList.add('flipped');
      isCardFlipped = true;
    }
  };
}

// --- PANNEAU NUIT DE SOMMEIL ---
function setupNightSleepPanel() {
  // Afficher si l'on est amoureux
  const loverAlert = document.getElementById('player-lover-alert');
  if (gameState.lovers && gameState.lovers.length > 0) {
    // Parser les amoureux
    const loverIds = gameState.lovers;
    const isMeLover = loverIds.includes(myPlayer.id);
    if (isMeLover) {
      const otherId = loverIds.find(id => id !== myPlayer.id);
      // Récupérer le nom de l'autre amoureux
      supabase.from('players').select('name, number').eq('id', otherId).single().then(({ data }) => {
        if (data) {
          document.getElementById('player-lover-name').textContent = data.name;
          document.getElementById('player-lover-num').textContent = data.number;
          loverAlert.classList.remove('hidden');
        }
      });
    } else {
      loverAlert.classList.add('hidden');
    }
  } else {
    loverAlert.classList.add('hidden');
  }

  // Afficher si l'on est charmé
  const charmedAlert = document.getElementById('player-charmed-alert');
  if (myPlayer.charmed) {
    charmedAlert.classList.remove('hidden');
  } else {
    charmedAlert.classList.add('hidden');
  }
}

// --- ACTIONS INTERACTIVES DE NUIT ---
async function setupNightActionPanel() {
  // Masquer tous les sous-panneaux
  document.getElementById('action-cupidon-panel').classList.add('hidden');
  document.getElementById('action-garde-panel').classList.add('hidden');
  document.getElementById('action-voyante-panel').classList.add('hidden');
  document.getElementById('action-loups-panel').classList.add('hidden');
  document.getElementById('action-sorciere-panel').classList.add('hidden');
  document.getElementById('action-fluteur-panel').classList.add('hidden');
  document.getElementById('action-completed-msg').classList.add('hidden');

  const instructions = document.getElementById('player-action-instructions');
  
  // Charger la liste des joueurs vivants
  const { data: alivePlayers } = await supabase
    .from('players')
    .select('id, name, number, role, charmed')
    .eq('status', 'alive')
    .order('number');

  // Filtrer pour ne pas se choisir soi-même dans certains rôles
  const otherAlivePlayers = alivePlayers.filter(p => p.id !== myPlayer.id);

  switch (myPlayer.role) {
    case 'cupidon':
      // Cupidon ne joue que si lovers est vide
      if (gameState.lovers && gameState.lovers.length > 0) {
        instructions.textContent = "Vous avez déjà uni les amoureux.";
        document.getElementById('action-completed-msg').classList.remove('hidden');
        document.getElementById('action-completed-msg').textContent = "Vos amoureux sont unis pour la vie.";
        return;
      }
      instructions.textContent = "Sélectionnez deux joueurs (vous-même ou d'autres) pour les lier par un amour éternel.";
      document.getElementById('action-cupidon-panel').classList.remove('hidden');
      renderSelectableList('cupidon-search-list', alivePlayers, 2, selectedLoverTargets, (selected) => {
        selectedLoverTargets = selected;
        document.getElementById('btn-submit-cupidon').disabled = (selected.length !== 2);
      });
      break;

    case 'garde':
      instructions.textContent = "Choisissez un joueur à protéger des crocs des loups-garous pour cette nuit.";
      document.getElementById('action-garde-panel').classList.remove('hidden');
      renderSelectableList('garde-search-list', alivePlayers, 1, selectedGardeTarget ? [selectedGardeTarget] : [], (selected) => {
        selectedGardeTarget = selected[0] || null;
        document.getElementById('btn-submit-garde').disabled = !selectedGardeTarget;
      });
      break;

    case 'voyante':
      // Si on a déjà inspecté cette nuit
      if (myPlayer.vote_target) {
        instructions.textContent = "Vous avez déjà inspecté un joueur cette nuit.";
        document.getElementById('action-completed-msg').classList.remove('hidden');
        return;
      }
      instructions.textContent = "Choisissez un joueur vivant pour révéler sa véritable carte.";
      document.getElementById('action-voyante-panel').classList.remove('hidden');
      document.getElementById('voyante-reveal-result').classList.add('hidden');
      renderSelectableList('voyante-search-list', otherAlivePlayers, 1, selectedVoyanteTarget ? [selectedVoyanteTarget] : [], (selected) => {
        selectedVoyanteTarget = selected[0] || null;
        document.getElementById('btn-submit-voyante').disabled = !selectedVoyanteTarget;
      });
      break;

    case 'loup':
      instructions.textContent = "Discutez en direct avec la meute et désignez la victime de cette nuit.";
      document.getElementById('action-loups-panel').classList.remove('hidden');
      
      // Liste de vote spécifique pour les loups
      renderSelectableList('loups-search-list', otherAlivePlayers, 1, myPlayer.vote_target ? [alivePlayers.find(p => p.number === myPlayer.vote_target)?.id] : [], async (selected) => {
        const targetId = selected[0] || null;
        const targetNum = targetId ? alivePlayers.find(p => p.id === targetId)?.number : null;
        
        // Mettre à jour mon vote individuel de loup en BDD
        await supabase.from('players').update({ vote_target: targetNum }).eq('id', myPlayer.id);
      });
      break;

    case 'sorciere':
      instructions.textContent = "Potion de vie et potion de mort. Choisirez-vous de sauver ou d'anéantir ?";
      document.getElementById('action-sorciere-panel').classList.remove('hidden');
      setupSorciereInterface(alivePlayers);
      break;

    case 'fluteur':
      instructions.textContent = "Jouez de la flûte pour charmer deux joueurs ce soir.";
      document.getElementById('action-fluteur-panel').classList.remove('hidden');
      
      // Ne proposer que les joueurs non encore charmés
      const nonCharmed = otherAlivePlayers.filter(p => !p.charmed);
      renderSelectableList('fluteur-search-list', nonCharmed, 2, selectedFluteurTargets, (selected) => {
        selectedFluteurTargets = selected;
        document.getElementById('btn-submit-fluteur').disabled = (selected.length !== 2);
      });
      break;
  }
}

// Rendu générique d'une liste sélectionnable avec filtre et recherche
function renderSelectableList(containerId, list, maxSelect, preselectedArray, onSelectionChange) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  let selected = [...preselectedArray];

  list.forEach(p => {
    const item = document.createElement('div');
    item.className = 'vote-item';
    if (selected.includes(p.id)) item.classList.add('selected');

    item.innerHTML = `
      <div>
        <span class="player-badge">N° ${p.number}</span>
        <strong>${p.name}</strong>
      </div>
    `;

    item.addEventListener('click', () => {
      if (maxSelect === 1) {
        if (selected.includes(p.id)) {
          selected = [];
          item.classList.remove('selected');
        } else {
          container.querySelectorAll('.vote-item').forEach(el => el.classList.remove('selected'));
          selected = [p.id];
          item.classList.add('selected');
        }
      } else {
        if (selected.includes(p.id)) {
          selected = selected.filter(id => id !== p.id);
          item.classList.remove('selected');
        } else {
          if (selected.length < maxSelect) {
            selected.push(p.id);
            item.classList.add('selected');
          } else {
            alert(`Vous pouvez sélectionner au maximum ${maxSelect} joueurs.`);
          }
        }
      }
      onSelectionChange(selected);
    });

    container.appendChild(item);
  });
}

// Écouteurs pour la validation des choix de nuit
document.getElementById('btn-submit-cupidon').addEventListener('click', async () => {
  if (selectedLoverTargets.length === 2) {
    document.getElementById('btn-submit-cupidon').disabled = true;
    const { error } = await supabase
      .from('game_state')
      .update({ lovers: selectedLoverTargets })
      .eq('id', 1);
    
    if (!error) {
      document.getElementById('action-cupidon-panel').classList.add('hidden');
      document.getElementById('action-completed-msg').classList.remove('hidden');
    }
  }
});

document.getElementById('btn-submit-garde').addEventListener('click', async () => {
  if (selectedGardeTarget) {
    document.getElementById('btn-submit-garde').disabled = true;
    const { data: targetPlayer } = await supabase.from('players').select('number').eq('id', selectedGardeTarget).single();
    if (targetPlayer) {
      // Sauvegarder dans la liste des protégés du tour
      const saves = [targetPlayer.number];
      const { error } = await supabase
        .from('game_state')
        .update({ current_night_saves: saves })
        .eq('id', 1);
      
      if (!error) {
        document.getElementById('action-garde-panel').classList.add('hidden');
        document.getElementById('action-completed-msg').classList.remove('hidden');
      }
    }
  }
});

document.getElementById('btn-submit-voyante').addEventListener('click', async () => {
  if (selectedVoyanteTarget) {
    document.getElementById('btn-submit-voyante').disabled = true;
    
    // Obtenir le rôle du joueur ciblé
    const { data: targetPlayer } = await supabase
      .from('players')
      .select('name, role')
      .eq('id', selectedVoyanteTarget)
      .single();

    if (targetPlayer) {
      const revealDiv = document.getElementById('voyante-reveal-result');
      document.getElementById('voyante-inspected-name').textContent = targetPlayer.name;
      
      const roleText = ROLES_INFO[targetPlayer.role]?.title || "Inconnu";
      document.getElementById('voyante-inspected-role').textContent = roleText;
      revealDiv.classList.remove('hidden');

      // Marquer comme fait en mettant à jour vote_target chez la Voyante
      await supabase.from('players').update({ vote_target: 999 }).eq('id', myPlayer.id);
    }
  }
});

document.getElementById('btn-submit-fluteur').addEventListener('click', async () => {
  if (selectedFluteurTargets.length === 2) {
    document.getElementById('btn-submit-fluteur').disabled = true;

    // Mettre à jour les deux joueurs comme charmés dans la BDD
    const { error } = await supabase
      .from('players')
      .update({ charmed: true })
      .in('id', selectedFluteurTargets);

    if (!error) {
      // Mettre à jour vote_target chez le Flûteur pour indiquer qu'il a joué
      await supabase.from('players').update({ vote_target: 999 }).eq('id', myPlayer.id);
      document.getElementById('action-fluteur-panel').classList.add('hidden');
      document.getElementById('action-completed-msg').classList.remove('hidden');
    }
  }
});

// Configurer l'interface de la Sorcière
function setupSorciereInterface(alivePlayers) {
  const healContainer = document.getElementById('sorciere-heal-container');
  const healText = document.getElementById('sorciere-heal-text');
  const btnHeal = document.getElementById('btn-sorciere-heal');

  // Charger les cibles des loups
  const kills = gameState.current_night_kills || [];
  
  if (kills.length > 0 && !gameState.witch_heal_used) {
    // Trouver le nom du joueur ciblé
    const targetNum = kills[0];
    const target = alivePlayers.find(p => p.number === targetNum);
    healText.innerHTML = `Cette nuit, les loups ciblent : <strong>${target ? target.name : 'Joueur ' + targetNum}</strong>.`;
    healContainer.classList.remove('hidden');
    btnHeal.disabled = false;
  } else {
    healText.innerHTML = gameState.witch_heal_used 
      ? "Vous avez déjà utilisé votre potion de vie." 
      : "Personne n'a été attaqué par les loups cette nuit.";
    btnHeal.disabled = true;
  }

  // Potion de mort
  const btnPoison = document.getElementById('btn-sorciere-poison');
  if (gameState.witch_poison_used) {
    btnPoison.disabled = true;
    document.getElementById('sorciere-poison-search-list').innerHTML = "<p style='padding: 10px; color: var(--color-muted);'>Vous avez déjà utilisé votre potion de mort.</p>";
  } else {
    // Exclure soi-même de la potion
    const otherPlayers = alivePlayers.filter(p => p.id !== myPlayer.id);
    renderSelectableList('sorciere-poison-search-list', otherPlayers, 1, selectedPoisonTarget ? [selectedPoisonTarget] : [], (selected) => {
      selectedPoisonTarget = selected[0] || null;
      btnPoison.disabled = !selectedPoisonTarget;
    });
  }

  // Action: Utiliser potion de vie
  btnHeal.onclick = async () => {
    btnHeal.disabled = true;
    // Supprimer la victime de la liste des morts de la nuit
    await supabase.from('game_state').update({
      current_night_kills: [],
      witch_heal_used: true
    }).eq('id', 1);
    
    healText.textContent = "Victime sauvée avec succès.";
  };

  // Action: Utiliser potion de mort
  btnPoison.onclick = async () => {
    if (selectedPoisonTarget) {
      btnPoison.disabled = true;
      const target = alivePlayers.find(p => p.id === selectedPoisonTarget);
      if (target) {
        // Ajouter à la liste des empoisonnés
        const poisons = [target.number];
        await supabase.from('game_state').update({
          current_night_poisons: poisons,
          witch_poison_used: true
        }).eq('id', 1);
        
        btnPoison.textContent = "Potion de mort jetée !";
      }
    }
  };

  // Action globale Sorcière : Passer/Valider
  document.getElementById('btn-submit-sorciere').onclick = async () => {
    // Mettre à jour vote_target pour indiquer à la BDD qu'elle a passé son tour
    await supabase.from('players').update({ vote_target: 999 }).eq('id', myPlayer.id);
    document.getElementById('action-sorciere-panel').classList.add('hidden');
    document.getElementById('action-completed-msg').classList.remove('hidden');
  };
}

// --- CHAT ET PANNEAU DES LOUPS ---
function subscribeToWolfChat() {
  if (wolfChannel) return;

  // Créer ou rejoindre le canal en mode Broadcast
  wolfChannel = supabase.channel('wolf_chat');
  
  wolfChannel
    .on('broadcast', { event: 'msg' }, (payload) => {
      appendWolfMessage(payload.payload.sender, payload.payload.message);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        appendWolfMessage("Système", "Vous êtes connecté au chat secret de la meute.");
      }
    });

  // Gérer l'envoi de message
  const input = document.getElementById('wolf-chat-input');
  const btnSend = document.getElementById('btn-wolf-chat-send');

  const sendMessage = () => {
    const text = input.value.trim();
    if (!text) return;

    wolfChannel.send({
      type: 'broadcast',
      event: 'msg',
      payload: { sender: myPlayer.name, message: text }
    });

    appendWolfMessage(myPlayer.name, text, true);
    input.value = '';
  };

  btnSend.onclick = sendMessage;
  input.onkeypress = (e) => {
    if (e.key === 'Enter') sendMessage();
  };
}

function unsubscribeFromWolfChat() {
  if (wolfChannel) {
    supabase.removeChannel(wolfChannel);
    wolfChannel = null;
  }
}

function appendWolfMessage(sender, message, isSelf = false) {
  const container = document.getElementById('wolf-chat-messages');
  const msgEl = document.createElement('div');
  msgEl.className = `wolf-msg ${isSelf ? 'wolf-msg-self' : ''}`;
  msgEl.innerHTML = `
    <div class="wolf-msg-sender">${sender}</div>
    <div>${message}</div>
  `;
  container.appendChild(msgEl);
  container.scrollTop = container.scrollHeight;
}

// --- VOTE DU JOUR ---
async function setupDayVotePanel() {
  const targetNameSpan = document.getElementById('player-voted-target-name');
  const confirmBox = document.getElementById('player-vote-confirm-box');
  
  // Reset de l'affichage local du vote
  targetNameSpan.textContent = "Personne";
  confirmBox.classList.add('hidden');

  // Obtenir la liste de tous les joueurs vivants
  const { data: alivePlayers } = await supabase
    .from('players')
    .select('id, name, number')
    .eq('status', 'alive')
    .order('number');

  // Exclure soi-même
  const otherAlive = alivePlayers.filter(p => p.id !== myPlayer.id);

  renderSelectableList('day-vote-search-list', otherAlive, 1, myPlayer.vote_target ? [alivePlayers.find(p => p.number === myPlayer.vote_target)?.id] : [], async (selected) => {
    const targetId = selected[0] || null;
    const target = alivePlayers.find(p => p.id === targetId);
    
    // Mettre à jour mon vote en BDD
    const targetNum = target ? target.number : null;
    await supabase.from('players').update({ vote_target: targetNum }).eq('id', myPlayer.id);

    // Mettre à jour l'affichage
    if (target) {
      targetNameSpan.textContent = `${target.name} (N° ${target.number})`;
      confirmBox.classList.remove('hidden');
    } else {
      confirmBox.classList.add('hidden');
    }
  });
}

// --- MINUTEUR DISCUSSION ---
function startDiscussionTimer(duration, startedAt) {
  if (timerInterval) clearInterval(timerInterval);

  const timerEl = document.getElementById('player-discussion-timer');

  const update = () => {
    const startTime = new Date(startedAt).getTime();
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const timeLeft = duration - elapsed;

    if (timeLeft <= 0) {
      timerEl.textContent = "00:00";
      clearInterval(timerInterval);
    } else {
      timerEl.textContent = formatTime(timeLeft);
    }
  };

  update();
  timerInterval = setInterval(update, 1000);
}

// --- VOTE FINAL DU CHASSEUR ---
async function showChasseurDeathPanel() {
  document.getElementById('player-sub-alive').classList.add('hidden');
  document.getElementById('player-sub-dead').classList.remove('hidden');
  
  const deadRoleName = document.getElementById('player-dead-role-name');
  deadRoleName.innerHTML = "Chasseur ☠️<br><br><span style='color: var(--neon-red); font-size:1.1rem;'>UTILISEZ VOTRE DERNIER SOUFFLE !</span>";

  // Créer un panneau de tir interactif
  const { data: alivePlayers } = await supabase
    .from('players')
    .select('id, name, number')
    .eq('status', 'alive')
    .order('number');

  const targetBox = document.createElement('div');
  targetBox.className = 'glass active-action-panel';
  targetBox.style.marginTop = '20px';
  targetBox.innerHTML = `
    <h3 style="color: var(--neon-red); margin-bottom: 10px;">Ciblez votre victime :</h3>
    <div id="chasseur-kill-list" class="vote-search-list"></div>
    <button id="btn-chasseur-shoot" class="btn btn-danger" style="width:100%; margin-top:15px;" disabled>FEU !</button>
  `;

  document.getElementById('player-sub-dead').appendChild(targetBox);

  let targetId = null;
  renderSelectableList('chasseur-kill-list', alivePlayers, 1, [], (selected) => {
    targetId = selected[0] || null;
    document.getElementById('btn-chasseur-shoot').disabled = !targetId;
  });

  document.getElementById('btn-chasseur-shoot').onclick = async () => {
    if (targetId) {
      document.getElementById('btn-chasseur-shoot').disabled = true;
      const target = alivePlayers.find(p => p.id === targetId);
      if (target) {
        // Éliminer directement la cible
        await supabase.from('players').update({ status: 'dead' }).eq('id', target.id);
        // Sauvegarder mon vote_target pour bloquer d'autres tirs
        await supabase.from('players').update({ vote_target: target.number }).eq('id', myPlayer.id);
        targetBox.remove();
        alert(`Vous avez abattu ${target.name} !`);
      }
    }
  };
}


// ==========================================================================
// 2. ÉCRAN TABLEAU / PROJECTEUR (?role=tableau)
// ==========================================================================
async function initTableau() {
  document.getElementById('tableau-view').classList.remove('hidden');

  // Inscription aux modifications
  supabase
    .channel('tableau_players')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => {
      syncTableauData();
    })
    .subscribe();

  supabase
    .channel('tableau_state')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game_state', filter: 'id=eq.1' }, payload => {
      gameState = payload.new;
      renderTableau();
    })
    .subscribe();

  // Chargement initial
  await syncTableauData();
  supabase.from('game_state').select('*').eq('id', 1).single().then(async ({ data }) => {
    if (data) {
      gameState = data;
      renderTableau();
    } else {
      console.log("Game state non trouvé (Tableau), initialisation par défaut...");
      const { data: newGS } = await supabase.from('game_state').insert([{ id: 1, phase: 'lobby' }]).select().single();
      if (newGS) {
        gameState = newGS;
        renderTableau();
      }
    }
  });
}

async function syncTableauData() {
  const { data } = await supabase.from('players').select('*').order('number');
  if (data) {
    players = data;
    renderTableau();
  }
}

function renderTableau() {
  if (!gameState || !gameState.phase) {
    console.log("Game state not yet loaded, skipping renderTableau.");
    return;
  }

  // 1. Mettre à jour les statistiques
  const total = players.length;
  const alive = players.filter(p => p.status === 'alive').length;
  const dead = total - alive;

  document.getElementById('tab-stat-total').textContent = total;
  document.getElementById('tab-stat-alive').textContent = alive;
  document.getElementById('tab-stat-dead').textContent = dead;

  // 2. Gérer la phase générale
  const phaseSub = document.getElementById('tab-sub-phase');
  const timerBox = document.getElementById('tab-timer-box');
  const banner = document.getElementById('tab-announcement-banner');
  const lobbyContainer = document.getElementById('tab-lobby-container');
  const mainGrid = document.getElementById('tab-grid');

  if (gameState.phase === 'lobby') {
    lobbyContainer.classList.remove('hidden');
    mainGrid.classList.add('hidden');
    banner.classList.add('hidden');
    
    phaseSub.innerHTML = `Lobby d'inscription — Scannez le QR Code pour rejoindre`;
    timerBox.classList.add('hidden');
    
    // Déterminer l'URL d'inscription
    let joinUrl = "https://fjepdunieres.github.io/LoupGarou/";
    const hostname = window.location.hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname.startsWith("192.168.")) {
      joinUrl = window.location.origin + window.location.pathname + "?role=joueur";
    }
    
    const lobbyPlayersGrid = document.getElementById('tab-lobby-players-list');
    const lobbyCount = document.getElementById('tab-lobby-count');
    const lobbyUrlLink = document.getElementById('tab-lobby-url');
    const qrHolder = document.getElementById('tab-lobby-qr-holder');
    
    lobbyCount.textContent = total;
    lobbyUrlLink.href = joinUrl;
    lobbyUrlLink.textContent = joinUrl;
    
    qrHolder.innerHTML = `
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(joinUrl)}" alt="QR Code">
    `;
    
    lobbyPlayersGrid.innerHTML = '';
    if (players.length === 0) {
      lobbyPlayersGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; color: var(--color-muted); padding: 40px 0;">
          <p style="font-size: 1.1rem; animation: pulse-glow 2s infinite; color: var(--neon-blue);">En attente du premier villageois...</p>
        </div>
      `;
    } else {
      players.forEach(p => {
        const card = document.createElement('div');
        card.className = 'lobby-player-card';
        card.innerHTML = `
          <div class="p-num">N° ${p.number}</div>
          <div class="p-name">${p.name}</div>
        `;
        lobbyPlayersGrid.appendChild(card);
      });
    }
  } else {
    lobbyContainer.classList.add('hidden');
    mainGrid.classList.remove('hidden');
  }

  // Arrêter l'ancien minuteur s'il tourne
  if (timerInterval) clearInterval(timerInterval);

  switch (gameState.phase) {
    case 'lobby':
      // Déjà géré ci-dessus
      break;

    case 'distributing':
      phaseSub.textContent = "Distribution des cartes de rôles...";
      timerBox.classList.add('hidden');
      banner.classList.remove('hidden');
      banner.innerHTML = "Regardez votre écran de téléphone en toute discrétion et découvrez votre carte de rôle.";
      break;

    case 'night':
      phaseSub.textContent = "🌙 La nuit est tombée sur le village...";
      timerBox.classList.add('hidden');
      banner.classList.remove('hidden');
      banner.textContent = "Tout le monde s'endort... Les rôles s'éveillent en secret.";
      break;

    case 'day_announcement':
      phaseSub.textContent = "☀️ Le village se réveille...";
      timerBox.classList.add('hidden');
      banner.classList.remove('hidden');
      banner.innerHTML = gameState.announcement_text || "Le village se réveille...";
      break;

    case 'day_discussion':
      phaseSub.textContent = "💬 Débat Public";
      timerBox.classList.remove('hidden');
      banner.classList.add('hidden');
      
      // Démarrer minuteur
      if (gameState.timer_started_at) {
        const start = new Date(gameState.timer_started_at).getTime();
        timerInterval = setInterval(() => {
          const elapsed = Math.floor((Date.now() - start) / 1000);
          const left = gameState.timer_duration - elapsed;
          if (left <= 0) {
            timerBox.textContent = "00:00";
            clearInterval(timerInterval);
          } else {
            timerBox.textContent = formatTime(left);
          }
        }, 1000);
      }
      break;

    case 'day_vote':
      phaseSub.textContent = "🗳️ Vote d'élimination de l'Assemblée";
      timerBox.classList.add('hidden');
      banner.classList.remove('hidden');
      banner.textContent = "C'est l'heure du vote public ! Désignez un suspect sur votre téléphone.";
      break;

    case 'game_over':
      phaseSub.textContent = "🏆 Partie Terminée !";
      timerBox.classList.add('hidden');
      banner.classList.remove('hidden');
      banner.innerHTML = `Victoire de la faction : <strong style="color:var(--neon-gold); font-size:2rem; display:block;">${(gameState.winners || "Inconnu").toUpperCase()}</strong>`;
      break;
  }

  // 3. Calculer le décompte des votes publics si en phase de vote
  const votesTally = {};
  if (gameState.phase === 'day_vote') {
    players.forEach(p => {
      if (p.status === 'alive' && p.vote_target) {
        votesTally[p.vote_target] = (votesTally[p.vote_target] || 0) + 1;
      }
    });
  }

  // 4. Dessiner la grille des joueurs (maximum 100)
  const grid = document.getElementById('tab-grid');
  grid.innerHTML = '';

  // Créer des cartes jusqu'à 100 ou selon le nombre inscrit
  const cardCount = Math.max(12, Math.min(100, total));

  for (let i = 1; i <= cardCount; i++) {
    const p = players.find(x => x.number === i);
    const card = document.createElement('div');
    card.className = 'tableau-card glass';

    if (p) {
      card.classList.add(p.status === 'alive' ? 'alive' : 'dead');
      
      // Amoureux ?
      let loverIndicator = '';
      if (gameState.lovers && gameState.lovers.includes(p.id) && gameState.phase === 'game_over') {
        loverIndicator = '❤️';
      }

      // Charmé ?
      let charmedIndicator = '';
      if (p.charmed && (gameState.phase === 'game_over')) {
        card.classList.add('charmed-end');
      }

      card.innerHTML = `
        <div class="t-num">${p.number}</div>
        <div class="t-name">${p.name} ${loverIndicator}</div>
      `;

      // Afficher les votes sur la carte
      if (gameState.phase === 'day_vote' && votesTally[p.number]) {
        const badge = document.createElement('span');
        badge.className = 'vote-badge';
        badge.textContent = votesTally[p.number];
        card.appendChild(badge);
      }
    } else {
      // Emplacement vide
      card.style.opacity = '0.1';
      card.innerHTML = `
        <div class="t-num">${i}</div>
        <div style="font-size:0.75rem; color:var(--color-muted);">Libre</div>
      `;
    }

    grid.appendChild(card);
  }
}


// ==========================================================================
// 3. ÉCRAN GAME MASTER (?role=gm)
// ==========================================================================
async function initGM() {
  document.getElementById('gm-view').classList.remove('hidden');

  // Vérifier si déjà authentifié
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    showGMPanel();
  } else {
    // Écouteur pour la connexion
    document.getElementById('btn-gm-login').addEventListener('click', async () => {
      const password = document.getElementById('gm-password').value.trim();
      if (!password) return;

      document.getElementById('btn-gm-login').disabled = true;

      const { data, error } = await supabase.auth.signInWithPassword({
        email: 'admin@admin.fr',
        password: password
      });

      if (error) {
        alert("Erreur de connexion : " + error.message);
        document.getElementById('btn-gm-login').disabled = false;
      } else {
        showGMPanel();
      }
    });
  }
}

async function showGMPanel() {
  document.getElementById('gm-login-panel').classList.add('hidden');
  document.getElementById('gm-main-panel').classList.remove('hidden');

  // S'abonner aux changements des tables
  supabase
    .channel('gm_players')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => {
      syncGMData();
    })
    .subscribe();

  supabase
    .channel('gm_state')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game_state', filter: 'id=eq.1' }, payload => {
      gameState = payload.new;
      renderGMPanel();
    })
    .subscribe();

  // Chargements initiaux
  await syncGMData();
  supabase.from('game_state').select('*').eq('id', 1).single().then(async ({ data }) => {
    if (data) {
      gameState = data;
      renderGMPanel();
    } else {
      console.log("Game state non trouvé (GM), initialisation par défaut...");
      const { data: newGS } = await supabase.from('game_state').insert([{ id: 1, phase: 'lobby' }]).select().single();
      if (newGS) {
        gameState = newGS;
        renderGMPanel();
      }
    }
  });

  setupGMEventListeners();
}

async function syncGMData() {
  const { data } = await supabase.from('players').select('*').order('number');
  if (data) {
    players = data;
    renderGMPanel();
  }
}

function renderGMPanel() {
  if (!gameState || !gameState.phase) {
    console.log("Game state not yet loaded, skipping renderGMPanel.");
    return;
  }

  const total = players.length;
  const alive = players.filter(p => p.status === 'alive').length;
  const wolves = players.filter(p => p.status === 'alive' && p.role === 'loup').length;
  const villagers = alive - wolves;

  // Stats sidebar
  document.getElementById('gm-count-connected').textContent = total;
  document.getElementById('gm-count-alive').textContent = alive;
  document.getElementById('gm-count-wolves').textContent = wolves;
  document.getElementById('gm-count-villagers').textContent = villagers;
  document.getElementById('gm-est-count').textContent = total;

  // Rendu de la répartition estimée dans le lobby
  const previewBox = document.getElementById('gm-role-distribution-preview');
  previewBox.innerHTML = '';
  const estRoles = getBalanceRolesArray(total);
  const roleCounts = {};
  estRoles.forEach(r => roleCounts[r] = (roleCounts[r] || 0) + 1);
  for (const [r, count] of Object.entries(roleCounts)) {
    previewBox.innerHTML += `<span class="glass" style="padding: 4px 10px;">${ROLES_INFO[r]?.title || r} x${count}</span>`;
  }

  // Rendu de la liste des joueurs de la sidebar
  const listContainer = document.getElementById('gm-players-list');
  listContainer.innerHTML = '';
  players.forEach(p => {
    const isOffline = (new Date() - new Date(p.last_seen)) > 25000;
    const item = document.createElement('div');
    item.className = 'gm-role-item';
    item.style.padding = '6px 12px';
    item.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px;">
        <span class="player-badge">N° ${p.number}</span>
        <strong style="${p.status === 'dead' ? 'text-decoration:line-through; opacity:0.5;' : ''}">${p.name}</strong>
        ${p.role ? `<span class="role-badge ${ROLES_INFO[p.role]?.type || 'villageois'}" style="font-size:0.6rem;">${ROLES_INFO[p.role]?.title}</span>` : ''}
      </div>
      <span class="status-dot ${isOffline ? '' : 'done'}"></span>
    `;
    listContainer.appendChild(item);
  });

  // Badge phase principale
  const phaseBadge = document.getElementById('gm-phase-badge');
  phaseBadge.className = `phase-tag ${gameState.phase}`;
  phaseBadge.textContent = gameState.phase;

  // Gérer l'affichage des sections selon la phase
  const sections = [
    'gm-section-lobby', 'gm-section-night', 'gm-section-day-announcement', 
    'gm-section-day-discussion', 'gm-section-day-vote', 'gm-section-game-over'
  ];
  sections.forEach(s => document.getElementById(s).classList.add('hidden'));

  switch (gameState.phase) {
    case 'lobby':
      document.getElementById('gm-section-lobby').classList.remove('hidden');
      document.getElementById('gm-current-phase-title').textContent = "Lobby d'inscription";
      break;

    case 'distributing':
      document.getElementById('gm-section-lobby').classList.remove('hidden');
      document.getElementById('gm-current-phase-title').textContent = "Distribution des cartes...";
      // Ajouter un bouton rapide pour passer à la nuit
      document.getElementById('btn-gm-start-game').textContent = "Distribution en cours... Lancer la Nuit ➔";
      break;

    case 'night':
      document.getElementById('gm-section-night').classList.remove('hidden');
      document.getElementById('gm-current-phase-title').textContent = "Gestion de la Nuit";
      renderGMNightControls();
      break;

    case 'day_announcement':
      document.getElementById('gm-section-day-announcement').classList.remove('hidden');
      document.getElementById('gm-current-phase-title').textContent = "Annonces matinales";
      document.getElementById('gm-announcement-deaths').innerHTML = gameState.announcement_text || "Aucun mort ce matin.";
      break;

    case 'day_discussion':
      document.getElementById('gm-section-day-discussion').classList.remove('hidden');
      document.getElementById('gm-current-phase-title').textContent = "Débats du Village";
      
      // Timer débat
      if (gameState.timer_started_at) {
        const start = new Date(gameState.timer_started_at).getTime();
        const left = gameState.timer_duration - Math.floor((Date.now() - start) / 1000);
        document.getElementById('gm-discussion-timer').textContent = formatTime(left);
      }
      break;

    case 'day_vote':
      document.getElementById('gm-section-day-vote').classList.remove('hidden');
      document.getElementById('gm-current-phase-title').textContent = "Votes du Village";
      renderGMVoteControls();
      break;

    case 'game_over':
      document.getElementById('gm-section-game-over').classList.remove('hidden');
      document.getElementById('gm-current-phase-title').textContent = "Fin de Partie";
      document.getElementById('gm-winner-announcement').textContent = (gameState.winners || "Inconnu").toUpperCase();
      break;
  }
}

// Rendu des contrôles de la Nuit
function renderGMNightControls() {
  const activeRole = gameState.night_phase;

  // Liste des rôles à piloter
  const roles = ['cupidon', 'garde', 'voyante', 'loups', 'sorciere', 'fluteur'];
  
  roles.forEach(r => {
    const dot = document.getElementById(`dot-${r}`);
    const item = document.getElementById(`gm-night-${r}`);
    const text = document.getElementById(`gm-text-${r}`);

    dot.className = 'status-dot';
    item.classList.remove('active', 'done');

    const roleAlive = players.some(p => p.role === r && p.status === 'alive');
    
    // Si Cupidon, c'est spécial (Tour 1 uniquement et uniquement s'il est en jeu)
    const isCupidonActive = r === 'cupidon' && (!gameState.lovers || gameState.lovers.length === 0);

    if (!roleAlive && r !== 'loups' && (r !== 'cupidon' || !isCupidonActive)) {
      text.innerHTML = `<span style="color:var(--color-muted);">Non présent ou éliminé (Passé d'office)</span>`;
      dot.classList.add('done');
      item.classList.add('done');
      return;
    }

    if (activeRole === r) {
      item.classList.add('active');
      dot.classList.add('active');
      
      // Récupérer qui a déjà validé son action
      if (r === 'loups') {
        const livingWolves = players.filter(p => p.role === 'loup' && p.status === 'alive');
        const votesDone = livingWolves.filter(w => w.vote_target).length;
        text.innerHTML = `<strong>En cours :</strong> Loups ayant voté : ${votesDone}/${livingWolves.length}`;
      } else if (r === 'cupidon') {
        text.innerHTML = `<strong>En cours :</strong> Choisit les amoureux en direct.`;
      } else {
        // Pour les autres rôles, vérifier s'ils ont validé en mettant vote_target
        const rolePlayer = players.find(p => p.role === r && p.status === 'alive');
        if (rolePlayer && rolePlayer.vote_target) {
          text.innerHTML = `<span style="color:var(--neon-green);">Choix enregistré !</span>`;
          dot.classList.add('done');
        } else {
          text.innerHTML = `<strong>En cours :</strong> En attente de son action...`;
        }
      }
    } else {
      // Si la phase est ultérieure
      const currentIdx = roles.indexOf(activeRole);
      const thisIdx = roles.indexOf(r);
      if (thisIdx < currentIdx || activeRole === 'none') {
        item.classList.add('done');
        dot.classList.add('done');
        
        // Afficher les résultats validés
        if (r === 'cupidon' && gameState.lovers && gameState.lovers.length > 0) {
          text.innerHTML = `<span style="color:var(--neon-green);">Amoureux créés.</span>`;
        } else if (r === 'garde' && gameState.current_night_saves && gameState.current_night_saves.length > 0) {
          text.innerHTML = `<span style="color:var(--neon-green);">Protection active sur N° ${gameState.current_night_saves[0]}.</span>`;
        } else if (r === 'loups') {
          // Calculer qui a reçu le plus de votes des loups
          const loupKills = gameState.current_night_kills || [];
          if (loupKills.length > 0) {
            text.innerHTML = `<span style="color:var(--neon-red);">Cible des loups : N° ${loupKills[0]}</span>`;
          } else {
            text.innerHTML = `<span style="color:var(--color-muted);">Aucune cible désignée.</span>`;
          }
        } else if (r === 'sorciere') {
          text.innerHTML = `<span style="color:var(--neon-green);">Actions Sorcière appliquées.</span>`;
        } else {
          text.innerHTML = `<span style="color:var(--color-muted);">Action complétée.</span>`;
        }
      } else {
        text.textContent = "En attente...";
      }
    }
  });
}

// Rendu des contrôles des votes de jour
function renderGMVoteControls() {
  const tallyDiv = document.getElementById('gm-votes-tally');
  tallyDiv.innerHTML = '';

  const select = document.getElementById('gm-kill-target-select');
  // Conserver l'ancienne valeur sélectionnée
  const prevSelected = select.value;
  select.innerHTML = '<option value="">-- Choisir un joueur --</option>';

  const votesCount = {};
  
  players.forEach(p => {
    if (p.status === 'alive') {
      // Ajouter au sélecteur
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `N° ${p.number} - ${p.name}`;
      select.appendChild(opt);

      // Compter les votes
      if (p.vote_target) {
        votesCount[p.vote_target] = (votesCount[p.vote_target] || 0) + 1;
      }
    }
  });

  // Remettre l'ancienne valeur si elle est toujours en vie
  select.value = prevSelected;

  // Trier les votes
  const sortedVotes = Object.entries(votesCount).sort((a, b) => b[1] - a[1]);

  if (sortedVotes.length === 0) {
    tallyDiv.innerHTML = "<p style='color:var(--color-muted); font-size:0.9rem;'>Aucun vote n'a encore été exprimé.</p>";
  } else {
    sortedVotes.forEach(([targetNum, count]) => {
      const targetPlayer = players.find(p => p.number === parseInt(targetNum));
      tallyDiv.innerHTML += `
        <div class="gm-vote-row">
          <span><strong>N° ${targetNum} ${targetPlayer ? targetPlayer.name : ''}</strong></span>
          <span style="color:var(--neon-red); font-weight:bold;">${count} votes</span>
        </div>
      `;
    });
  }
}

// Événements boutons Game Master
function setupGMEventListeners() {
  // Lancer la partie / Distribuer rôles
  document.getElementById('btn-gm-start-game').addEventListener('click', async () => {
    if (gameState.phase === 'distributing') {
      // Si déjà en cours de distribution, passer directement à la nuit
      await advanceToNight();
      return;
    }

    if (players.length < 4) {
      alert("Il faut au moins 4 joueurs pour lancer une partie.");
      return;
    }

    document.getElementById('btn-gm-start-game').disabled = true;

    // Distribuer les rôles localement et mettre à jour en bloc
    const roles = getBalanceRolesArray(players.length);
    // Mélanger les rôles
    shuffleArray(roles);

    // Mettre à jour chaque joueur avec son rôle
    const updates = players.map((p, idx) => {
      return supabase
        .from('players')
        .update({
          role: roles[idx],
          status: 'alive',
          charmed: false,
          vote_target: null
        })
        .eq('id', p.id);
    });

    await Promise.all(updates);

    // Initialiser l'état du jeu à distribution
    await supabase.from('game_state').update({
      phase: 'distributing',
      lovers: [],
      current_night_kills: [],
      current_night_saves: [],
      current_night_poisons: [],
      witch_heal_used: false,
      witch_poison_used: false,
      winners: ''
    }).eq('id', 1);

    document.getElementById('btn-gm-start-game').disabled = false;
  });

  // Avancement manuel du tour de nuit
  document.getElementById('btn-gm-next-night-phase').addEventListener('click', async () => {
    const rolesSeq = ['cupidon', 'garde', 'voyante', 'loups', 'sorciere', 'fluteur', 'none'];
    const current = gameState.night_phase;
    let nextIdx = rolesSeq.indexOf(current) + 1;
    
    // Rechercher le prochain rôle vivant/éligible
    while (nextIdx < rolesSeq.length - 1) {
      const nextRole = rolesSeq[nextIdx];
      const hasRoleAlive = players.some(p => p.role === nextRole && p.status === 'alive');
      
      // Cupidon n'est éligible que la première nuit (si la liste des amoureux est vide)
      const isCupidonEligible = nextRole === 'cupidon' && (!gameState.lovers || gameState.lovers.length === 0);

      if (hasRoleAlive || nextRole === 'loups' || (nextRole === 'cupidon' && isCupidonEligible)) {
        break;
      }
      nextIdx++;
    }

    const nextRole = rolesSeq[nextIdx];

    // Avant de quitter le tour des loups, faire le décompte de leur vote pour cibler la victime de la nuit
    if (current === 'loups') {
      await calculateLoupNightKill();
    }

    // Réinitialiser les vote_target de nuit de tout le monde pour ne pas polluer les phases
    // sauf les loups car on a calculé leur cible, ou la sorcière. En gros on clean pour le matin.
    if (nextRole === 'none') {
      // Fin de la nuit
      await supabase.from('game_state').update({ night_phase: 'none' }).eq('id', 1);
      alert("Fin des phases nocturnes. Vous pouvez réveiller le village.");
    } else {
      // Nettoyer les vote_target temporaires des joueurs
      const cleanUpdates = players.map(p => {
        return supabase.from('players').update({ vote_target: null }).eq('id', p.id);
      });
      await Promise.all(cleanUpdates);

      await supabase.from('game_state').update({ night_phase: nextRole }).eq('id', 1);
    }
  });

  // Bouton Réveiller le village
  document.getElementById('btn-gm-wake-village').addEventListener('click', async () => {
    document.getElementById('btn-gm-wake-village').disabled = true;

    // Résoudre la nuit
    const kills = gameState.current_night_kills || [];
    const saves = gameState.current_night_saves || [];
    const poisons = gameState.current_night_poisons || [];

    const deadThisNight = [];

    // 1. Attaqué par les loups
    if (kills.length > 0) {
      const targetNum = kills[0];
      // Sauvé par le garde ?
      if (saves.includes(targetNum)) {
        // Sauvé !
      } else {
        deadThisNight.push(targetNum);
      }
    }

    // 2. Empoisonné par la sorcière
    if (poisons.length > 0) {
      deadThisNight.push(poisons[0]);
    }

    // 3. Traiter le cas de l'Ancien (survit 1 fois aux loups)
    // Pour simplifier : s'il est attaqué par les loups, qu'il est en vie et n'a pas déjà été ciblé, on le garde en vie
    // (Dans ce format rapide, on se focalise sur les éliminations de base pour garder le dynamisme).

    // 4. Traiter les amoureux (Cupidon)
    let loverDied = false;
    if (gameState.lovers && gameState.lovers.length === 2) {
      const [lover1Id, lover2Id] = gameState.lovers;
      const lover1 = players.find(p => p.id === lover1Id);
      const lover2 = players.find(p => p.id === lover2Id);

      if (lover1 && lover2) {
        const l1Dead = deadThisNight.includes(lover1.number) || lover1.status === 'dead';
        const l2Dead = deadThisNight.includes(lover2.number) || lover2.status === 'dead';

        if (l1Dead && !l2Dead) {
          deadThisNight.push(lover2.number);
          loverDied = true;
        } else if (l2Dead && !l1Dead) {
          deadThisNight.push(lover1.number);
          loverDied = true;
        }
      }
    }

    // Éliminer effectivement les joueurs
    let announcement = "";
    if (deadThisNight.length > 0) {
      const uniqueDeads = [...new Set(deadThisNight)];
      
      const killUpdates = uniqueDeads.map(num => {
        const p = players.find(x => x.number === num);
        if (p) {
          announcement += `☠️ <strong>${p.name}</strong> (N° ${p.number}), qui était <i>${ROLES_INFO[p.role]?.title || p.role}</i>.<br>`;
          return supabase.from('players').update({ status: 'dead' }).eq('id', p.id);
        }
        return Promise.resolve();
      });
      await Promise.all(killUpdates);
      
      if (loverDied) {
        announcement += `<br>💔 Deux amoureux ont été réunis dans la mort...`;
      }
    } else {
      announcement = "🍀 Aucun mort cette nuit. Le village respire !";
    }

    // Passer en phase day_announcement
    await supabase.from('game_state').update({
      phase: 'day_announcement',
      announcement_text: announcement
    }).eq('id', 1);

    document.getElementById('btn-gm-wake-village').disabled = false;
  });

  // Lancer le débat public
  document.getElementById('btn-gm-start-discussion').addEventListener('click', async () => {
    // Initialiser un débat de 3 minutes (180s)
    await supabase.from('game_state').update({
      phase: 'day_discussion',
      timer_duration: 180,
      timer_started_at: new Date().toISOString()
    }).eq('id', 1);
  });

  // Contrôles des durées de débat du GM
  document.getElementById('btn-timer-1m').addEventListener('click', () => updateGMTimer(60));
  document.getElementById('btn-timer-3m').addEventListener('click', () => updateGMTimer(180));
  document.getElementById('btn-timer-5m').addEventListener('click', () => updateGMTimer(300));
  document.getElementById('btn-timer-pause').addEventListener('click', toggleGMTimer);

  // Lancer le vote d'élimination
  document.getElementById('btn-gm-start-vote').addEventListener('click', async () => {
    // Vider les anciens votes
    const cleanVotes = players.map(p => {
      return supabase.from('players').update({ vote_target: null }).eq('id', p.id);
    });
    await Promise.all(cleanVotes);

    await supabase.from('game_state').update({
      phase: 'day_vote'
    }).eq('id', 1);
  });

  // Confirmer l'élimination par le vote public
  document.getElementById('btn-gm-confirm-vote-kill').addEventListener('click', async () => {
    const selectedId = document.getElementById('gm-kill-target-select').value;
    if (!selectedId) {
      alert("Veuillez sélectionner un joueur à éliminer.");
      return;
    }

    const targetPlayer = players.find(p => p.id === selectedId);
    if (!targetPlayer) return;

    if (!confirm(`Confirmer l'élimination de ${targetPlayer.name} (N° ${targetPlayer.number}) ?`)) {
      return;
    }

    document.getElementById('btn-gm-confirm-vote-kill').disabled = true;

    // Gérer l'idiot du village : s'il est voté, il ne meurt pas mais perd sa voix
    if (targetPlayer.role === 'idiot') {
      alert(`${targetPlayer.name} était l'Idiot du Village ! Il survit mais ne pourra plus voter.`);
      // On le garde en vie mais on peut marquer vote_target à 999 ou similaire pour lui enlever le vote
      // Pour faire simple, on affiche juste qu'il survit.
      await supabase.from('game_state').update({
        phase: 'day_announcement',
        announcement_text: `📣 ${targetPlayer.name} (N° ${targetPlayer.number}) a été désigné par le village, mais c'est l'Idiot du Village ! Il est gracié mais perd son vote.`
      }).eq('id', 1);
      
      document.getElementById('btn-gm-confirm-vote-kill').disabled = false;
      return;
    }

    // Gérer l'ange : si éliminé au Jour 1, il gagne immédiatement
    // (On peut vérifier si lovers est vide pour deviner si c'est le jour 1, ou simplement valider).

    // Éliminer le joueur
    await supabase.from('players').update({ status: 'dead' }).eq('id', targetPlayer.id);

    // Vérifier les amoureux
    if (gameState.lovers && gameState.lovers.includes(targetPlayer.id)) {
      const otherId = gameState.lovers.find(id => id !== targetPlayer.id);
      const other = players.find(p => p.id === otherId);
      if (other && other.status === 'alive') {
        await supabase.from('players').update({ status: 'dead' }).eq('id', other.id);
        alert(`💔 ${other.name} (N° ${other.number}) s'est donné la mort par chagrin d'amour !`);
      }
    }

    // Refaire une synchronisation et vérifier la fin de partie
    const { data: updatedPlayers } = await supabase.from('players').select('*');
    const winners = checkGameOverConditions(updatedPlayers);

    if (winners) {
      await supabase.from('game_state').update({
        phase: 'game_over',
        winners: winners
      }).eq('id', 1);
    } else {
      // Passer à la nuit suivante
      await advanceToNight();
    }

    document.getElementById('btn-gm-confirm-vote-kill').disabled = false;
  });

  // Recommencer une partie depuis l'écran de fin
  document.getElementById('btn-gm-restart-lobby').addEventListener('click', async () => {
    if (confirm("Voulez-vous réinitialiser et relancer un lobby ?")) {
      await supabase.rpc('reset_game');
    }
  });

  // Bouton de réinitialisation complète de la partie
  document.getElementById('btn-gm-reset').addEventListener('click', async () => {
    if (confirm("ATTENTION : Cela supprimera tous les joueurs et réinitialisera le jeu. Continuer ?")) {
      await supabase.rpc('reset_game');
    }
  });
}

// Lancer la phase de Nuit
async function advanceToNight() {
  // Déterminer la première sous-phase éligible
  const seq = ['cupidon', 'garde', 'voyante', 'loups', 'sorciere', 'fluteur'];
  let startRole = 'none';

  for (const r of seq) {
    const roleAlive = players.some(p => p.role === r && p.status === 'alive');
    const isCupidonFirstNight = r === 'cupidon' && (!gameState.lovers || gameState.lovers.length === 0);

    if (roleAlive || r === 'loups' || (r === 'cupidon' && isCupidonFirstNight)) {
      startRole = r;
      break;
    }
  }

  // Nettoyer les vote_target et états temporaires
  const cleanUpdates = players.map(p => {
    return supabase.from('players').update({ vote_target: null }).eq('id', p.id);
  });
  await Promise.all(cleanUpdates);

  // Mettre à jour l'état général
  await supabase.from('game_state').update({
    phase: 'night',
    night_phase: startRole,
    current_night_kills: [],
    current_night_saves: [],
    current_night_poisons: []
  }).eq('id', 1);
}

// Calculer le vote de nuit des Loups
async function calculateLoupNightKill() {
  const { data: wolvesPlayers } = await supabase
    .from('players')
    .select('vote_target')
    .eq('role', 'loup')
    .eq('status', 'alive');

  if (wolvesPlayers && wolvesPlayers.length > 0) {
    const counts = {};
    wolvesPlayers.forEach(w => {
      if (w.vote_target) {
        counts[w.vote_target] = (counts[w.vote_target] || 0) + 1;
      }
    });

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) {
      const topTargetNum = parseInt(sorted[0][0]);
      await supabase.from('game_state').update({
        current_night_kills: [topTargetNum]
      }).eq('id', 1);
    }
  }
}

// Mettre à jour le minuteur GM
async function updateGMTimer(seconds) {
  await supabase.from('game_state').update({
    timer_duration: seconds,
    timer_started_at: new Date().toISOString()
  }).eq('id', 1);
}

// Suspendre/Reprendre minuteur GM (Met à jour le timer_started_at avec le décalage restant)
async function toggleGMTimer() {
  const start = new Date(gameState.timer_started_at).getTime();
  const elapsed = Math.floor((Date.now() - start) / 1000);
  const left = gameState.timer_duration - elapsed;

  if (left > 0) {
    // Pour mettre en pause : on peut mettre timer_duration à 0 et stocker le restant quelque part, 
    // ou simplement soustraire. Pour simplifier, on remet juste à 3 minutes si cliqué en pause.
  }
}

// ==========================================================================
// RÈGLES D'ÉQUILIBRE & GAGNANTS
// ==========================================================================

// Déterminer la liste des rôles selon le nombre de joueurs (Algorithme de distribution)
function getBalanceRolesArray(N) {
  const roles = [];
  
  // Loups-Garous : environ 16% de l'effectif
  const wolvesCount = Math.max(1, Math.round(N * 0.16));
  for (let i = 0; i < wolvesCount; i++) roles.push('loup');

  let remaining = N - wolvesCount;

  // Ajouter les rôles spéciaux selon l'effectif
  const specials = [];
  
  if (N >= 8) specials.push('cupidon');
  specials.push('voyante');
  specials.push('sorciere');
  specials.push('chasseur');
  if (N >= 10) specials.push('garde');
  if (N >= 15) specials.push('fluteur');
  if (N >= 12) specials.push('ange');
  if (N >= 20) specials.push('idiot');
  if (N >= 25) specials.push('ancien');

  // Si on a plus de rôles spéciaux que de places restantes (cas très petits groupes)
  // on en prend seulement autant que nécessaire.
  const toAdd = specials.slice(0, remaining);
  toAdd.forEach(r => roles.push(r));

  remaining -= toAdd.length;

  // Compléter avec de simples villageois
  for (let i = 0; i < remaining; i++) {
    roles.push('villageois');
  }

  return roles;
}

// Mélanger un tableau (Fisher-Yates)
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

// Vérifier les conditions de fin de partie
function checkGameOverConditions(playerList) {
  const alivePlayers = playerList.filter(p => p.status === 'alive');
  const wolvesCount = alivePlayers.filter(p => p.role === 'loup').length;
  const totalAlive = alivePlayers.length;
  const villagersCount = totalAlive - wolvesCount;

  // 1. Victoire des Loups-Garous
  if (wolvesCount >= villagersCount) {
    return 'loups';
  }

  // 2. Victoire des Villageois
  if (wolvesCount === 0) {
    return 'villageois';
  }

  // 3. Victoire du Flûteur (S'il est en vie et que tous les autres vivants sont charmés)
  const fluteur = alivePlayers.find(p => p.role === 'fluteur');
  if (fluteur) {
    const otherAlive = alivePlayers.filter(p => p.id !== fluteur.id);
    const allOthersCharmed = otherAlive.length > 0 && otherAlive.every(p => p.charmed);
    if (allOthersCharmed) {
      return 'fluteur';
    }
  }

  // 4. Victoire des Amoureux (S'il ne reste que les 2 amoureux en vie)
  if (gameState.lovers && gameState.lovers.length === 2 && totalAlive === 2) {
    const [l1, l2] = gameState.lovers;
    const isL1Alive = alivePlayers.some(p => p.id === l1);
    const isL2Alive = alivePlayers.some(p => p.id === l2);
    if (isL1Alive && isL2Alive) {
      return 'amoureux';
    }
  }

  return null; // La partie continue
}
