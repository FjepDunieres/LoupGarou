// Loup Garou Géant - Application Temps Réel (Vanilla JS)

let supabaseUrl = CONFIG.SUPABASE_URL;
let supabaseAnonKey = CONFIG.SUPABASE_ANON_KEY;
let supabaseClient = null;

// Données locales synchronisées
let players = [];
let gameState = {};
let myPlayer = null;
let selectedVoteTargets = []; // Votes de jour (jusqu'à 3)
let selectedLoverTargets = []; // Cupidon
let selectedFluteurTargets = []; // Flûteur
let selectedGardeTarget = null; // Garde
let selectedVoyanteTarget = null; // Voyante
let selectedPoisonTarget = null; // Sorcière
let selectedMayorTarget = null; // Élection du Maire
let selectedMayorTiebreakTargets = []; // Pour trancher en tant que Maire
let isCardFlipped = false;
let lastTableauPhase = null;

// Configuration de la partie
let configWolvesCount = 2;
let configNightTimerVal = 20; // 20s par défaut
let configDayTimerVal = 180; // 3m par défaut
let configVoteTimerVal = 45; // 45s par défaut
let configMayorTimerVal = 45; // 45s par défaut
let nightTurnTimeout = null; // Pour le countdown nocturne automatique
let globalAutoPilotInterval = null; // Interval d'orchestration automatique
let spectatorChannel = null;

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
    supabaseClient = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
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
    await supabaseClient
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
    const { data: player, error } = await supabaseClient
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
    if (navigator.vibrate) navigator.vibrate(30);
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
    const { data, error } = await supabaseClient.rpc('join_lobby', { player_name: nameInput });

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
  const el = document.getElementById(stepId);
  el.classList.remove('hidden');
  el.classList.remove('fade-in');
  void el.offsetWidth;
  el.classList.add('fade-in');
}

// Inscriptions aux canaux temps réel pour le joueur
function setupPlayerSubscriptions() {
  // Remplir les infos du lobby
  document.getElementById('player-lobby-name').textContent = myPlayer.name;
  document.getElementById('player-lobby-number').textContent = myPlayer.number;

  // 1. Écouter l'état du jeu
  supabaseClient
    .channel('public_game_state')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game_state', filter: 'id=eq.1' }, payload => {
      gameState = payload.new;
      handleGameStateUpdate();
    })
    .subscribe();

  // Charger l'état actuel immédiatement (auto-création si absent pour résilience)
  supabaseClient.from('game_state').select('*').eq('id', 1).single().then(async ({ data }) => {
    if (data) {
      gameState = data;
      handleGameStateUpdate();
    } else {
      console.log("Game state non trouvé, initialisation par défaut...");
      const { data: newGS } = await supabaseClient.from('game_state').insert([{ id: 1, phase: 'lobby' }]).select().single();
      if (newGS) {
        gameState = newGS;
        handleGameStateUpdate();
      }
    }
  });

  // 2. Écouter sa propre fiche joueur (pour savoir si on meurt ou change de rôle)
  supabaseClient
    .channel(`player_self_${myPlayer.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `id=eq.${myPlayer.id}` }, payload => {
      if (payload.eventType === 'DELETE' || !payload.new) {
        localStorage.removeItem('player_uuid');
        location.reload();
        return;
      }
      myPlayer = payload.new;
      handleMyPlayerUpdate();
    })
    .subscribe();

  // Charger sa propre fiche joueur immédiatement
  supabaseClient.from('players').select('*').eq('id', myPlayer.id).single().then(({ data }) => {
    if (data) {
      myPlayer = data;
      handleMyPlayerUpdate();
    } else {
      localStorage.removeItem('player_uuid');
      location.reload();
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
      document.getElementById('player-dead-role-name').textContent = myPlayer.role === 'chasseur' ? 'Chasseur ☠️' : ROLES_INFO[myPlayer.role].title;
    }
    
    // Rendre le mode spectre
    renderSpectatorMode();

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
    if (gameState.is_auto_mode) {
      const containerEl = document.getElementById('player-lobby-timer-container');
      const statusEl = document.getElementById('player-lobby-status');
      if (statusEl) statusEl.textContent = "⏳ Mode automatique actif. La partie va commencer sous peu...";
      
      if (gameState.timer_duration > 0 && gameState.timer_started_at) {
        startPlayerLobbyTimer(gameState.timer_duration, gameState.timer_started_at);
      } else {
        if (playerLobbyTimerInterval) {
          clearInterval(playerLobbyTimerInterval);
          playerLobbyTimerInterval = null;
        }
        if (containerEl) containerEl.classList.add('hidden');
      }
    } else {
      if (playerLobbyTimerInterval) {
        clearInterval(playerLobbyTimerInterval);
        playerLobbyTimerInterval = null;
      }
      const containerEl = document.getElementById('player-lobby-timer-container');
      if (containerEl) containerEl.classList.add('hidden');
      const statusEl = document.getElementById('player-lobby-status');
      if (statusEl) statusEl.textContent = "⏳ En attente du lancement par le Game Master...";
    }
    return;
  }

  showPlayerStep('player-step-game');

  // Masquer toutes les sous-phases joueurs
  const phases = [
    'player-phase-distribute', 'player-phase-night-sleep', 'player-phase-night-action',
    'player-phase-day-announcement', 'player-phase-day-discussion', 'player-phase-day-vote',
    'player-phase-game-over', 'player-phase-day-mayor', 'player-phase-mayor-tiebreak'
  ];
  phases.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });

  if (myPlayer && myPlayer.status === 'dead') {
    renderSpectatorMode();
    return;
  }

  if (myPlayer && myPlayer.status === 'alive') {
    let activePhaseId = null;
    switch (gameState.phase) {
      case 'distributing':
        activePhaseId = 'player-phase-distribute';
        setupRoleCardReveal();
        break;

      case 'day_mayor_election':
        activePhaseId = 'player-phase-day-mayor';
        setupMayorElectionPanel();
        break;

      case 'day_vote_tiebreak':
        if (myPlayer.is_mayor) {
          activePhaseId = 'player-phase-mayor-tiebreak';
          setupMayorTiebreakPanel();
        } else {
          activePhaseId = 'player-phase-day-discussion';
          const timerEl = document.getElementById('player-discussion-timer');
          if (timerEl) {
            timerEl.textContent = "⚖️ Égalité";
            timerEl.classList.remove('timer-normal', 'timer-warning', 'timer-critical');
          }
          const instructionEl = document.querySelector('#player-phase-day-discussion p:last-of-type');
          if (instructionEl) instructionEl.textContent = "Le Maire est en train de trancher le vote...";
        }
        break;

      case 'night':
        // Est-ce mon tour d'agir ?
        const isMyTurn = (myPlayer.role === gameState.night_phase);
        
        if (isMyTurn) {
          activePhaseId = 'player-phase-night-action';
          setupNightActionPanel();
        } else {
          activePhaseId = 'player-phase-night-sleep';
          setupNightSleepPanel();
        }
        break;

      case 'day_announcement':
        activePhaseId = 'player-phase-day-announcement';
        document.getElementById('player-announcement-text').innerHTML = gameState.announcement_text || "Le village se réveille...";
        break;

      case 'day_discussion':
        activePhaseId = 'player-phase-day-discussion';
        // Remettre le texte d'instruction d'origine pour la discussion
        const instEl = document.querySelector('#player-phase-day-discussion p:last-of-type');
        if (instEl) instEl.textContent = "Le vote d'élimination débutera dès que le minuteur expirera.";
        startDiscussionTimer(gameState.timer_duration, gameState.timer_started_at);
        break;

      case 'day_vote':
        activePhaseId = 'player-phase-day-vote';
        setupDayVotePanel();
        break;

      case 'game_over':
        activePhaseId = 'player-phase-game-over';
        document.getElementById('player-winners-name').textContent = (gameState.winners || "Inconnu").toUpperCase();
        break;
    }

    if (activePhaseId) {
      const activeEl = document.getElementById(activePhaseId);
      activeEl.classList.remove('hidden');
      if (gameState.phase !== activeEl.dataset.lastPhase) {
        activeEl.dataset.lastPhase = gameState.phase;
        activeEl.classList.remove('fade-in');
        void activeEl.offsetWidth; // Reflow
        activeEl.classList.add('fade-in');
      }
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
      if (navigator.vibrate) navigator.vibrate(80);
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
      supabaseClient.from('players').select('name, number').eq('id', otherId).single().then(({ data }) => {
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
  // Gérer le minuteur de tour nocturne
  const timerContainer = document.getElementById('player-night-timer-container');
  const timerVal = document.getElementById('player-night-timer');
  
  if (gameState.timer_duration > 0 && gameState.timer_started_at) {
    timerContainer.classList.remove('hidden');
    if (timerInterval) clearInterval(timerInterval);
    const start = new Date(gameState.timer_started_at).getTime();
    
    const updateNightTimer = () => {
      const elapsed = Math.floor((Date.now() - start) / 1000);
      const left = gameState.timer_duration - elapsed;
      if (left <= 0) {
        timerVal.textContent = "0s";
        clearInterval(timerInterval);
      } else {
        timerVal.textContent = `${left}s`;
      }
    };
    updateNightTimer();
    timerInterval = setInterval(updateNightTimer, 1000);
  } else {
    timerContainer.classList.add('hidden');
  }

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
  const { data: alivePlayers } = await supabaseClient
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
      instructions.textContent = "Discutez en direct avec la meute et désignez de 0 à 3 suspect(s) à dévorer.";
      document.getElementById('action-loups-panel').classList.remove('hidden');
      
      const preselectedLoupIds = [];
      if (myPlayer.vote_target) {
        const nums = myPlayer.vote_target.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
        nums.forEach(num => {
          const p = alivePlayers.find(x => x.number === num);
          if (p) preselectedLoupIds.push(p.id);
        });
      }
      
      // Liste de vote spécifique pour les loups (jusqu'à 3)
      renderSelectableList('loups-search-list', otherAlivePlayers, 3, preselectedLoupIds, async (selected) => {
        const selectedNums = selected.map(id => alivePlayers.find(p => p.id === id)?.number).filter(n => n !== undefined);
        const voteStr = selectedNums.join(',');
        await supabaseClient.from('players').update({ vote_target: voteStr }).eq('id', myPlayer.id);
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
      if (navigator.vibrate) navigator.vibrate(20);
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
    if (navigator.vibrate) navigator.vibrate([40, 30, 40]);
    document.getElementById('btn-submit-cupidon').disabled = true;
    
    // Enregistrer l'événement de Cupidon dans l'historique
    const lover1 = players.find(p => p.id === selectedLoverTargets[0]);
    const lover2 = players.find(p => p.id === selectedLoverTargets[1]);
    if (lover1 && lover2) {
      await addHistoryEvent('night', `💘 Cupidon a lié ${lover1.name} (N° ${lover1.number}) et ${lover2.name} (N° ${lover2.number}) par les liens sacrés de l'amour.`);
    }

    const { error } = await supabaseClient
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
    if (navigator.vibrate) navigator.vibrate(40);
    document.getElementById('btn-submit-garde').disabled = true;
    const { data: targetPlayer } = await supabaseClient.from('players').select('name, number').eq('id', selectedGardeTarget).single();
    if (targetPlayer) {
      // Log de protection
      await addHistoryEvent('night', `🛡️ Le Garde a protégé ${targetPlayer.name} (N° ${targetPlayer.number}).`);

      // Sauvegarder dans la liste des protégés du tour
      const saves = [targetPlayer.number];
      const { error } = await supabaseClient
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
    if (navigator.vibrate) navigator.vibrate(40);
    document.getElementById('btn-submit-voyante').disabled = true;
    
    // Obtenir le rôle du joueur ciblé
    const { data: targetPlayer } = await supabaseClient
      .from('players')
      .select('name, role, number')
      .eq('id', selectedVoyanteTarget)
      .single();

    if (targetPlayer) {
      // Log de Voyante
      await addHistoryEvent('night', `🔮 La Voyante a inspecté le rôle de ${targetPlayer.name} (N° ${targetPlayer.number}).`);

      const revealDiv = document.getElementById('voyante-reveal-result');
      document.getElementById('voyante-inspected-name').textContent = targetPlayer.name;
      
      const roleText = ROLES_INFO[targetPlayer.role]?.title || "Inconnu";
      document.getElementById('voyante-inspected-role').textContent = roleText;
      revealDiv.classList.remove('hidden');

      // Marquer comme fait en mettant à jour vote_target chez la Voyante
      await supabaseClient.from('players').update({ vote_target: 999 }).eq('id', myPlayer.id);
    }
  }
});

document.getElementById('btn-submit-fluteur').addEventListener('click', async () => {
  if (selectedFluteurTargets.length === 2) {
    if (navigator.vibrate) navigator.vibrate(40);
    document.getElementById('btn-submit-fluteur').disabled = true;

    // Log de Flûteur
    const targetPlayers = players.filter(p => selectedFluteurTargets.includes(p.id));
    const names = targetPlayers.map(p => `${p.name} (N° ${p.number})`).join(' et ');
    await addHistoryEvent('night', `🎶 Le Flûteur a charmé ${names}.`);

    // Mettre à jour les deux joueurs comme charmés dans la BDD
    const { error } = await supabaseClient
      .from('players')
      .update({ charmed: true })
      .in('id', selectedFluteurTargets);

    if (!error) {
      // Mettre à jour vote_target chez le Flûteur pour indiquer qu'il a joué
      await supabaseClient.from('players').update({ vote_target: 999 }).eq('id', myPlayer.id);
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
    // Log de potion de vie
    await addHistoryEvent('night', `🧪 La Sorcière a utilisé sa potion de vie pour ressusciter la victime des Loups-Garous.`);

    // Supprimer la victime de la liste des morts de la nuit
    await supabaseClient.from('game_state').update({
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
        // Log de potion de mort
        await addHistoryEvent('night', `🧪 La Sorcière a empoisonné ${target.name} (N° ${target.number}).`);

        // Ajouter à la liste des empoisonnés
        const poisons = [target.number];
        await supabaseClient.from('game_state').update({
          current_night_poisons: poisons,
          witch_poison_used: true
        }).eq('id', 1);
        
        btnPoison.textContent = "Potion de mort jetée !";
      }
    }
  };

  // Action globale Sorcière : Passer/Valider
  document.getElementById('btn-submit-sorciere').onclick = async () => {
    if (navigator.vibrate) navigator.vibrate(40);
    // Mettre à jour vote_target pour indiquer à la BDD qu'elle a passé son tour
    await supabaseClient.from('players').update({ vote_target: 999 }).eq('id', myPlayer.id);
    document.getElementById('action-sorciere-panel').classList.add('hidden');
    document.getElementById('action-completed-msg').classList.remove('hidden');
  };
}

// --- CHAT ET PANNEAU DES LOUPS ---
function subscribeToWolfChat() {
  if (wolfChannel) return;

  // Créer ou rejoindre le canal en mode Broadcast
  wolfChannel = supabaseClient.channel('wolf_chat');
  
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
    supabaseClient.removeChannel(wolfChannel);
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
  const { data: alivePlayers } = await supabaseClient
    .from('players')
    .select('id, name, number')
    .eq('status', 'alive')
    .order('number');

  // Exclure soi-même
  const otherAlive = alivePlayers.filter(p => p.id !== myPlayer.id);

  // Parser les votes existants
  const preselectedIds = [];
  if (myPlayer.vote_target) {
    const preselectedNums = myPlayer.vote_target.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
    preselectedNums.forEach(num => {
      const p = alivePlayers.find(x => x.number === num);
      if (p) preselectedIds.push(p.id);
    });
  }

  // Voter pour maximum 3 suspects
  renderSelectableList('day-vote-search-list', otherAlive, 3, preselectedIds, async (selected) => {
    const selectedPlayers = selected.map(id => alivePlayers.find(p => p.id === id)).filter(p => p);
    const selectedNums = selectedPlayers.map(p => p.number);
    const voteStr = selectedNums.join(',');
    
    await supabaseClient.from('players').update({ vote_target: voteStr }).eq('id', myPlayer.id);

    // Mettre à jour l'affichage
    if (selectedPlayers.length > 0) {
      targetNameSpan.textContent = selectedPlayers.map(p => `${p.name} (N° ${p.number})`).join(', ');
      confirmBox.classList.remove('hidden');
    } else {
      targetNameSpan.textContent = "Personne";
      confirmBox.classList.add('hidden');
    }
  });
}

// --- ÉLECTION DU MAIRE ---
async function setupMayorElectionPanel() {
  const targetNameSpan = document.getElementById('player-mayor-target-name');
  const confirmBox = document.getElementById('player-mayor-confirm-box');
  
  targetNameSpan.textContent = "Personne";
  confirmBox.classList.add('hidden');

  const { data: alivePlayers } = await supabaseClient
    .from('players')
    .select('id, name, number')
    .eq('status', 'alive')
    .order('number');

  const preselected = [];
  if (myPlayer.vote_target) {
    const num = parseInt(myPlayer.vote_target);
    const found = alivePlayers.find(p => p.number === num);
    if (found) preselected.push(found.id);
  }

  // En élection de maire, on vote pour 1 personne (y compris soi-même)
  renderSelectableList('day-mayor-search-list', alivePlayers, 1, preselected, async (selected) => {
    const targetId = selected[0] || null;
    const target = alivePlayers.find(p => p.id === targetId);
    
    const targetNum = target ? target.number.toString() : null;
    await supabaseClient.from('players').update({ vote_target: targetNum }).eq('id', myPlayer.id);

    if (target) {
      targetNameSpan.textContent = `${target.name} (N° ${target.number})`;
      confirmBox.classList.remove('hidden');
    } else {
      confirmBox.classList.add('hidden');
    }
  });
}

// --- TRANCHAGE DU VOTE PAR LE MAIRE ---
async function setupMayorTiebreakPanel() {
  const submitBtn = document.getElementById('btn-submit-mayor-tiebreak');
  submitBtn.disabled = true;

  const parts = (gameState.announcement_text || "").split(':');
  const spotsLeft = parseInt(parts[0]) || 1;
  const tiedNums = parts[1] ? parts[1].split(',').map(n => parseInt(n)) : [];

  const { data: alivePlayers } = await supabaseClient
    .from('players')
    .select('id, name, number')
    .eq('status', 'alive')
    .in('number', tiedNums)
    .order('number');

  const instructions = document.getElementById('mayor-tiebreak-instructions');
  if (instructions) {
    instructions.innerHTML = `Vous devez désigner exactement <strong>${spotsLeft}</strong> joueur(s) à éliminer parmi les égalités ci-dessous :`;
  }

  selectedMayorTiebreakTargets = [];

  renderSelectableList('mayor-tiebreak-search-list', alivePlayers, spotsLeft, [], (selected) => {
    selectedMayorTiebreakTargets = selected;
    submitBtn.disabled = (selected.length !== spotsLeft);
  });

  submitBtn.onclick = async () => {
    submitBtn.disabled = true;
    const chosenPlayers = selectedMayorTiebreakTargets.map(id => alivePlayers.find(p => p.id === id)).filter(p => p);
    
    // Log d'arbitrage du maire dans l'historique
    const names = chosenPlayers.map(p => `${p.name} (N° ${p.number})`).join(', ');
    await addHistoryEvent('death', `⚖️ ARBITRAGE DU MAIRE : Le maire a tranché l'égalité et a éliminé ${names}.`);

    // Éliminer les joueurs choisis
    const updates = chosenPlayers.map(p => {
      return supabaseClient.from('players').update({ status: 'dead' }).eq('id', p.id);
    });
    await Promise.all(updates);

    // Signaler au GM que la décision a été prise
    await supabaseClient.from('game_state').update({
      announcement_text: 'resolved'
    }).eq('id', 1);
  };
}

// --- MINUTEUR DISCUSSION ---
function startDiscussionTimer(duration, startedAt) {
  if (timerInterval) clearInterval(timerInterval);

  const timerEl = document.getElementById('player-discussion-timer');

  const update = () => {
    const startTime = new Date(startedAt).getTime();
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const timeLeft = duration - elapsed;

    // Apply colors dynamically
    timerEl.classList.remove('timer-normal', 'timer-warning', 'timer-critical');
    if (timeLeft > 60) {
      timerEl.classList.add('timer-normal');
    } else if (timeLeft > 15) {
      timerEl.classList.add('timer-warning');
    } else {
      timerEl.classList.add('timer-critical');
    }

    if (timeLeft <= 0) {
      timerEl.textContent = "00:00";
      timerEl.classList.remove('timer-critical');
      clearInterval(timerInterval);
    } else {
      timerEl.textContent = formatTime(timeLeft);
    }
  };

  update();
  timerInterval = setInterval(update, 1000);
}

// --- MINUTEUR LOBBY JOUEUR (MODE AUTO) ---
let playerLobbyTimerInterval = null;
function startPlayerLobbyTimer(duration, startedAt) {
  if (playerLobbyTimerInterval) clearInterval(playerLobbyTimerInterval);

  const timerEl = document.getElementById('player-lobby-timer');
  const containerEl = document.getElementById('player-lobby-timer-container');
  const statusEl = document.getElementById('player-lobby-status');

  if (!timerEl || !containerEl) return;

  containerEl.classList.remove('hidden');
  if (statusEl) statusEl.textContent = "⏳ Mode automatique actif. En attente du départ...";

  const update = () => {
    const startTime = new Date(startedAt).getTime();
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const timeLeft = duration - elapsed;

    if (timeLeft <= 0) {
      timerEl.textContent = "Lancement...";
      clearInterval(playerLobbyTimerInterval);
    } else {
      timerEl.textContent = formatTime(timeLeft);
    }
  };

  update();
  playerLobbyTimerInterval = setInterval(update, 1000);
}

// --- MINUTEUR LOBBY TABLEAU (MODE AUTO) ---
let tabLobbyTimerInterval = null;
function startTabLobbyTimer(duration, startedAt) {
  if (tabLobbyTimerInterval) clearInterval(tabLobbyTimerInterval);

  const timerEl = document.getElementById('tab-lobby-timer');
  const containerEl = document.getElementById('tab-lobby-timer-container');

  if (!timerEl || !containerEl) return;

  containerEl.classList.remove('hidden');

  const update = () => {
    const startTime = new Date(startedAt).getTime();
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const timeLeft = duration - elapsed;

    if (timeLeft <= 0) {
      timerEl.textContent = "Lancement...";
      clearInterval(tabLobbyTimerInterval);
    } else {
      timerEl.textContent = formatTime(timeLeft);
    }
  };

  update();
  tabLobbyTimerInterval = setInterval(update, 1000);
}

// --- LOGIQUE D'HISTORIQUE DE JEU ---
let localHistory = [];
async function addHistoryEvent(type, text) {
  if (gameState && gameState.game_history) {
    localHistory = Array.isArray(gameState.game_history) ? gameState.game_history : [];
  } else {
    localHistory = [];
  }

  const newEvent = {
    id: Date.now() + Math.random().toString(36).substr(2, 4),
    type: type, // 'setup', 'night', 'day', 'death', 'vote', 'info'
    text: text,
    time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  };

  localHistory.push(newEvent);
  console.log(`[Game-History] [${type.toUpperCase()}] ${text}`);

  const { error } = await supabaseClient.from('game_state').update({
    game_history: localHistory
  }).eq('id', 1);

  if (error) {
    console.error("Erreur d'écriture de l'historique:", error);
  }
}

// --- TEXTE DE VICTOIRE POUR L'HISTORIQUE ---
function getVictoryText(winners) {
  if (winners === 'loups') {
    return "🏆 PARTIE TERMINÉE : Victoire de la meute des Loups-Garous ! 🐺";
  } else if (winners === 'villageois') {
    return "🏆 PARTIE TERMINÉE : Victoire du village ! Les loups ont été éliminés. 🏡";
  } else if (winners === 'fluteur') {
    return "🏆 PARTIE TERMINÉE : Victoire du Flûteur ! Tout le village est sous son charme. 🎶";
  } else if (winners === 'amoureux') {
    return "🏆 PARTIE TERMINÉE : Victoire des Amoureux ! L'amour a triomphé. 💖";
  }
  return `🏆 PARTIE TERMINÉE : Victoire de la faction ${winners}.`;
}

// --- CALCUL DES STATISTIQUES DE DEBRIEFING ---
function calculateEndGameStats(allPlayers, history) {
  const stats = {
    survivor: "Aucun",
    target: "Aucun",
    sniper: "Aucun"
  };

  if (!allPlayers || allPlayers.length === 0) return stats;

  // 1. Le Survivant Ultime (Simple Villageois resté en vie le plus longtemps)
  const simpleVillageois = allPlayers.filter(p => p.role === 'villageois');
  if (simpleVillageois.length > 0) {
    const aliveVillageois = simpleVillageois.filter(p => p.status === 'alive');
    if (aliveVillageois.length > 0) {
      stats.survivor = aliveVillageois[Math.floor(Math.random() * aliveVillageois.length)].name;
    } else {
      // Rechercher dans l'historique le dernier Simple Villageois à être mort
      let lastDeadName = null;
      if (Array.isArray(history)) {
        for (let i = history.length - 1; i >= 0; i--) {
          const event = history[i];
          if (event.type === 'death') {
            const found = simpleVillageois.find(v => event.text.includes(v.name));
            if (found) {
              lastDeadName = found.name;
              break;
            }
          }
        }
      }
      stats.survivor = lastDeadName || simpleVillageois[Math.floor(Math.random() * simpleVillageois.length)].name;
    }
  } else {
    // Si pas de simple villageois configuré, repli sur un rôle du village en vie
    const aliveVillage = allPlayers.filter(p => p.status === 'alive' && p.role !== 'loup' && p.role !== 'fluteur');
    if (aliveVillage.length > 0) {
      stats.survivor = aliveVillage[Math.floor(Math.random() * aliveVillage.length)].name;
    }
  }

  // 2. La Cible Facile (mentionné le plus de fois dans les attaques ou votes dans l'historique)
  // On recherche par (N° X) pour éviter les collisions de prénoms (ex: Max et Maxime)
  const nameMentions = {};
  allPlayers.forEach(p => {
    nameMentions[p.name] = 0;
  });

  if (Array.isArray(history)) {
    history.forEach(event => {
      allPlayers.forEach(p => {
        const targetStr = `(N° ${p.number})`;
        if (event.text.includes(targetStr)) {
          if (event.text.includes("attaqué") || event.text.includes("protégé") || event.text.includes("inspecté") || event.text.includes("éliminé") || event.text.includes("abattre")) {
            nameMentions[p.name]++;
          }
        }
      });
    });
  }

  const sortedMentions = Object.entries(nameMentions).sort((a, b) => b[1] - a[1]);
  if (sortedMentions.length > 0 && sortedMentions[0][1] > 0) {
    stats.target = `${sortedMentions[0][0]} (${sortedMentions[0][1]} fois ciblé)`;
  } else {
    stats.target = "Aucun joueur ciblé";
  }

  // 3. Le Sniper (Loup-Garou le plus efficace / resté debout le plus longtemps)
  const wolves = allPlayers.filter(p => p.role === 'loup');
  if (wolves.length > 0) {
    const aliveWolves = wolves.filter(p => p.status === 'alive');
    if (aliveWolves.length > 0) {
      stats.sniper = aliveWolves[Math.floor(Math.random() * aliveWolves.length)].name;
    } else {
      // Trouver le dernier loup mort dans l'historique
      let lastDeadWolfName = null;
      if (Array.isArray(history)) {
        for (let i = history.length - 1; i >= 0; i--) {
          const event = history[i];
          if (event.type === 'death') {
            const found = wolves.find(w => event.text.includes(w.name));
            if (found) {
              lastDeadWolfName = found.name;
              break;
            }
          }
        }
      }
      stats.sniper = lastDeadWolfName || wolves[Math.floor(Math.random() * wolves.length)].name;
    }
  } else {
    stats.sniper = "Aucun loup dans la partie";
  }

  return stats;
}

// --- VOTE FINAL DU CHASSEUR ---
async function showChasseurDeathPanel() {
  document.getElementById('player-sub-alive').classList.add('hidden');
  document.getElementById('player-sub-dead').classList.remove('hidden');
  
  const deadRoleName = document.getElementById('player-dead-role-name');
  deadRoleName.innerHTML = "Chasseur ☠️<br><br><span style='color: var(--neon-red); font-size:1.1rem;'>UTILISEZ VOTRE DERNIER SOUFFLE !</span>";

  // Créer un panneau de tir interactif
  const { data: alivePlayers } = await supabaseClient
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
        // Log de tir du chasseur dans l'historique
        await addHistoryEvent('death', `🏹 TIR DU CHASSEUR : Le Chasseur ${myPlayer.name} (N° ${myPlayer.number}) a utilisé son dernier souffle pour abattre ${target.name} (N° ${target.number}).`);

        // Éliminer directement la cible
        await supabaseClient.from('players').update({ status: 'dead' }).eq('id', target.id);
        // Sauvegarder mon vote_target pour bloquer d'autres tirs
        await supabaseClient.from('players').update({ vote_target: target.number }).eq('id', myPlayer.id);
        targetBox.remove();
        alert(`Vous avez abattu ${target.name} !`);
      }
    }
  };
}

// --- MODE SPECTATEUR POUR LES MORTS ---
function subscribeSpectatorPlayers() {
  if (spectatorChannel) return;
  spectatorChannel = supabaseClient
    .channel('spectator_players')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, async () => {
      const { data } = await supabaseClient.from('players').select('*').order('number');
      if (data) {
        players = data;
        renderSpectatorMode();
      }
    })
    .subscribe();
}

async function renderSpectatorMode() {
  subscribeSpectatorPlayers();

  const specPhase = document.getElementById('spec-phase');
  const specAlive = document.getElementById('spec-alive');
  const specTimerContainer = document.getElementById('spec-timer-container');
  const specTimer = document.getElementById('spec-timer');
  const specVotesContainer = document.getElementById('spec-votes-container');
  const specVotesList = document.getElementById('spec-votes-list');
  const specPlayersList = document.getElementById('spec-players-list');

  if (!specPhase) return;

  // Charger la liste complète des joueurs si elle est vide
  if (players.length === 0) {
    const { data } = await supabaseClient.from('players').select('*').order('number');
    if (data) players = data;
  }

  // 1. Phase et statut de vie
  specPhase.textContent = gameState.phase || 'Lobby';
  const aliveCount = players.filter(p => p.status === 'alive').length;
  specAlive.textContent = `${aliveCount} / ${players.length}`;

  // 2. Minuteur débat / élection / tiebreak
  if (['day_discussion', 'day_mayor_election', 'day_vote_tiebreak'].includes(gameState.phase) && gameState.timer_started_at) {
    specTimerContainer.classList.remove('hidden');
    const start = new Date(gameState.timer_started_at).getTime();
    const elapsed = Math.floor((Date.now() - start) / 1000);
    const left = gameState.timer_duration - elapsed;
    specTimer.textContent = formatTime(Math.max(0, left));

    specTimer.classList.remove('timer-normal', 'timer-warning', 'timer-critical');
    if (left > 60) specTimer.classList.add('timer-normal');
    else if (left > 15) specTimer.classList.add('timer-warning');
    else specTimer.classList.add('timer-critical');
  } else {
    specTimerContainer.classList.add('hidden');
  }

  // 3. Tendance des votes (temps réel)
  if (gameState.phase === 'day_vote') {
    specVotesContainer.classList.remove('hidden');
    specVotesList.innerHTML = '';

    const votesTally = {};
    players.forEach(p => {
      if (p.status === 'alive' && p.vote_target) {
        const targets = p.vote_target.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
        targets.forEach(t => {
          votesTally[t] = (votesTally[t] || 0) + 1;
        });
      }
    });

    const sorted = Object.entries(votesTally).sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) {
      specVotesList.innerHTML = '<div style="color:var(--color-muted); font-size:0.75rem; text-align:center;">Aucun vote pour le moment...</div>';
    } else {
      sorted.forEach(([targetNum, count]) => {
        const target = players.find(p => p.number === parseInt(targetNum));
        specVotesList.innerHTML += `
          <div style="display:flex; justify-content:space-between; padding:2px 0; border-bottom:1px solid rgba(255,255,255,0.02);">
            <span>N° ${targetNum} ${target ? target.name : ''}</span>
            <span style="color:var(--neon-red); font-weight:bold;">${count} votes</span>
          </div>
        `;
      });
    }
  } else {
    specVotesContainer.classList.add('hidden');
  }

  // 4. Liste mémorial avec rôles révélés
  specPlayersList.innerHTML = '';
  players.forEach(p => {
    const item = document.createElement('div');
    item.className = `memorial-item ${p.status === 'dead' ? 'dead' : ''}`;
    item.style.fontSize = '0.75rem';
    item.style.padding = '5px 8px';
    item.style.display = 'flex';
    item.style.justifyContent = 'space-between';
    item.style.alignItems = 'center';
    item.style.background = 'rgba(255,255,255,0.02)';
    item.style.borderRadius = '6px';
    item.style.border = '1px solid rgba(255,255,255,0.03)';

    let roleText = '';
    if (p.status === 'dead') {
      roleText = `<span class="memorial-role" style="color:var(--neon-red); text-decoration:line-through; font-weight:800; font-size:0.7rem;">☠️ ${ROLES_INFO[p.role]?.title || p.role}</span>`;
    } else {
      roleText = `<span style="color:var(--neon-green); font-weight:bold; font-size:0.7rem;">🟢 En vie</span>`;
    }

    const mayorIndicator = p.is_mayor ? '<span style="color:var(--neon-gold); margin-left:4px;">👑</span>' : '';
    item.innerHTML = `
      <span>N° ${p.number} <strong>${p.name}</strong>${mayorIndicator}</span>
      <span>${roleText}</span>
    `;
    specPlayersList.appendChild(item);
  });
}

// ==========================================================================
// 2. ÉCRAN TABLEAU / PROJECTEUR (?role=tableau)
// ==========================================================================
async function initTableau() {
  document.getElementById('tableau-view').classList.remove('hidden');

  // Inscription aux modifications
  supabaseClient
    .channel('tableau_players')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => {
      syncTableauData();
    })
    .subscribe();

  supabaseClient
    .channel('tableau_state')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game_state', filter: 'id=eq.1' }, payload => {
      gameState = payload.new;
      renderTableau();
    })
    .subscribe();

  // Chargement initial
  await syncTableauData();
  supabaseClient.from('game_state').select('*').eq('id', 1).single().then(async ({ data }) => {
    if (data) {
      gameState = data;
      renderTableau();
    } else {
      console.log("Game state non trouvé (Tableau), initialisation par défaut...");
      const { data: newGS } = await supabaseClient.from('game_state').insert([{ id: 1, phase: 'lobby' }]).select().single();
      if (newGS) {
        gameState = newGS;
        renderTableau();
      }
    }
  });
}

async function syncTableauData() {
  const { data } = await supabaseClient.from('players').select('*').order('number');
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

  // Phase transition visual trigger
  if (lastTableauPhase !== gameState.phase) {
    lastTableauPhase = gameState.phase;
    if (gameState.phase === 'lobby') {
      const container = document.getElementById('tab-lobby-container');
      if (container) {
        container.classList.remove('fade-in');
        void container.offsetWidth;
        container.classList.add('fade-in');
      }
    } else {
      const grid = document.getElementById('tab-grid');
      if (grid) {
        grid.classList.remove('fade-in');
        void grid.offsetWidth;
        grid.classList.add('fade-in');
      }
    }
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

    if (gameState.is_auto_mode && gameState.timer_duration > 0 && gameState.timer_started_at) {
      startTabLobbyTimer(gameState.timer_duration, gameState.timer_started_at);
    } else {
      if (tabLobbyTimerInterval) {
        clearInterval(tabLobbyTimerInterval);
        tabLobbyTimerInterval = null;
      }
      const tabLobbyTimerContainer = document.getElementById('tab-lobby-timer-container');
      if (tabLobbyTimerContainer) tabLobbyTimerContainer.classList.add('hidden');
    }
    
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
    const debriefContainer = document.getElementById('tab-debrief-container');
    
    if (gameState.phase === 'game_over') {
      mainGrid.classList.add('hidden');
      if (debriefContainer) {
        debriefContainer.classList.remove('hidden');
        
        // Calculer et afficher les distinctions de fin de partie
        const stats = calculateEndGameStats(players, gameState.game_history);
        document.getElementById('tab-trophy-survivor').textContent = stats.survivor;
        document.getElementById('tab-trophy-target').textContent = stats.target;
        document.getElementById('tab-trophy-sniper').textContent = stats.sniper;
        
        // Rendre la chronologie des événements
        const historyList = document.getElementById('tab-history-list');
        if (historyList) {
          historyList.innerHTML = '';
          const history = Array.isArray(gameState.game_history) ? gameState.game_history : [];
          if (history.length === 0) {
            historyList.innerHTML = `<div style="color: var(--color-muted); text-align: center; padding: 20px;">Aucun événement enregistré.</div>`;
          } else {
            history.forEach(event => {
              const item = document.createElement('div');
              item.style.padding = '10px 15px';
              item.style.borderRadius = '6px';
              item.style.marginBottom = '8px';
              item.style.fontSize = '0.95rem';
              item.style.display = 'flex';
              item.style.justifyContent = 'space-between';
              item.style.alignItems = 'center';
              
              // Styliser selon le type
              let bg = 'rgba(255,255,255,0.03)';
              let border = '1px solid rgba(255,255,255,0.1)';
              let color = '#fff';
              
              if (event.type === 'setup') {
                bg = 'rgba(0, 245, 212, 0.05)';
                border = '1px solid rgba(0, 245, 212, 0.2)';
                color = 'var(--neon-blue)';
              } else if (event.type === 'night_start') {
                bg = 'rgba(157, 78, 221, 0.08)';
                border = '1px solid rgba(157, 78, 221, 0.3)';
                color = '#b583ff';
              } else if (event.type === 'night') {
                bg = 'rgba(157, 78, 221, 0.03)';
                border = '1px solid rgba(157, 78, 221, 0.15)';
              } else if (event.type === 'death') {
                bg = 'rgba(255, 0, 85, 0.08)';
                border = '1px solid rgba(255, 0, 85, 0.3)';
                color = 'var(--neon-red)';
              } else if (event.type === 'vote') {
                bg = 'rgba(255, 215, 0, 0.05)';
                border = '1px solid rgba(255, 215, 0, 0.2)';
                color = 'var(--neon-gold)';
              }
              
              item.style.backgroundColor = bg;
              item.style.border = border;
              item.style.color = color;
              
              item.innerHTML = `
                <span>${event.text}</span>
                <span style="font-size: 0.8rem; color: var(--color-muted);">${event.time}</span>
              `;
              historyList.appendChild(item);
            });
            // Défiler automatiquement vers le bas
            historyList.scrollTop = historyList.scrollHeight;
          }
        }
      }
    } else {
      mainGrid.classList.remove('hidden');
      if (debriefContainer) debriefContainer.classList.add('hidden');
    }

    if (tabLobbyTimerInterval) {
      clearInterval(tabLobbyTimerInterval);
      tabLobbyTimerInterval = null;
    }
    const tabLobbyTimerContainer = document.getElementById('tab-lobby-timer-container');
    if (tabLobbyTimerContainer) tabLobbyTimerContainer.classList.add('hidden');
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

    case 'day_mayor_election':
      phaseSub.textContent = "👑 Élection du Maire";
      timerBox.classList.remove('hidden');
      banner.classList.add('hidden');
      if (gameState.timer_started_at) {
        const start = new Date(gameState.timer_started_at).getTime();
        const updateTabTimer = () => {
          const elapsed = Math.floor((Date.now() - start) / 1000);
          const left = gameState.timer_duration - elapsed;

          timerBox.classList.remove('timer-normal', 'timer-warning', 'timer-critical');
          if (left > 60) timerBox.classList.add('timer-normal');
          else if (left > 15) timerBox.classList.add('timer-warning');
          else timerBox.classList.add('timer-critical');

          if (left <= 0) {
            timerBox.textContent = "00:00";
            clearInterval(timerInterval);
          } else {
            timerBox.textContent = formatTime(left);
          }
        };
        updateTabTimer();
        timerInterval = setInterval(updateTabTimer, 1000);
      }
      break;

    case 'day_vote_tiebreak':
      phaseSub.textContent = "⚖️ Égalité - Arbitrage du Maire";
      timerBox.classList.remove('hidden');
      banner.classList.add('hidden');
      if (gameState.timer_started_at) {
        const start = new Date(gameState.timer_started_at).getTime();
        const updateTabTimer = () => {
          const elapsed = Math.floor((Date.now() - start) / 1000);
          const left = gameState.timer_duration - elapsed;

          timerBox.classList.remove('timer-normal', 'timer-warning', 'timer-critical');
          if (left > 60) timerBox.classList.add('timer-normal');
          else if (left > 15) timerBox.classList.add('timer-warning');
          else timerBox.classList.add('timer-critical');

          if (left <= 0) {
            timerBox.textContent = "00:00";
            clearInterval(timerInterval);
          } else {
            timerBox.textContent = formatTime(left);
          }
        };
        updateTabTimer();
        timerInterval = setInterval(updateTabTimer, 1000);
      }
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
        const updateTabTimer = () => {
          const elapsed = Math.floor((Date.now() - start) / 1000);
          const left = gameState.timer_duration - elapsed;

          timerBox.classList.remove('timer-normal', 'timer-warning', 'timer-critical');
          if (left > 60) {
            timerBox.classList.add('timer-normal');
          } else if (left > 15) {
            timerBox.classList.add('timer-warning');
          } else {
            timerBox.classList.add('timer-critical');
          }

          if (left <= 0) {
            timerBox.textContent = "00:00";
            timerBox.classList.remove('timer-critical');
            clearInterval(timerInterval);
          } else {
            timerBox.textContent = formatTime(left);
          }
        };
        updateTabTimer();
        timerInterval = setInterval(updateTabTimer, 1000);
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
        const targets = p.vote_target.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
        targets.forEach(t => {
          votesTally[t] = (votesTally[t] || 0) + 1;
        });
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
      if (p.is_mayor) {
        card.classList.add('mayor');
      }
      
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
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    showGMPanel();
  } else {
    // Écouteur pour la connexion
    document.getElementById('btn-gm-login').addEventListener('click', async () => {
      const password = document.getElementById('gm-password').value.trim();
      if (!password) return;

      document.getElementById('btn-gm-login').disabled = true;

      const { data, error } = await supabaseClient.auth.signInWithPassword({
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

function loadGMConfigs() {
  const wolves = localStorage.getItem('cfg_wolves');
  if (wolves) {
    configWolvesCount = parseInt(wolves);
    const wolvesVal = document.getElementById('config-wolves-val');
    if (wolvesVal) wolvesVal.textContent = configWolvesCount;
  }
  const night = localStorage.getItem('cfg_night_timer');
  if (night) {
    configNightTimerVal = parseInt(night);
    const el = document.getElementById('config-night-timer');
    if (el) el.value = configNightTimerVal;
  }
  const day = localStorage.getItem('cfg_day_timer');
  if (day) {
    configDayTimerVal = parseInt(day);
    const el = document.getElementById('config-day-timer');
    if (el) el.value = configDayTimerVal;
  }
  const vote = localStorage.getItem('cfg_vote_timer');
  if (vote) {
    configVoteTimerVal = parseInt(vote);
    const el = document.getElementById('config-vote-timer');
    if (el) el.value = configVoteTimerVal;
  }
  const mayor = localStorage.getItem('cfg_mayor_timer');
  if (mayor) {
    configMayorTimerVal = parseInt(mayor);
    const el = document.getElementById('config-mayor-timer');
    if (el) el.value = configMayorTimerVal;
  }
  const autoGame = localStorage.getItem('cfg_auto_game');
  if (autoGame === 'true') {
    const el = document.getElementById('gm-auto-game');
    if (el) el.checked = true;
    const simAuto = document.getElementById('sim-auto-pilot');
    if (simAuto) {
      simAuto.checked = true;
      simAuto.disabled = true;
    }
  }
}

async function showGMPanel() {
  loadGMConfigs();
  document.getElementById('gm-login-panel').classList.add('hidden');
  document.getElementById('gm-main-panel').classList.remove('hidden');

  // S'abonner aux changements des tables
  supabaseClient
    .channel('gm_players')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => {
      syncGMData();
    })
    .subscribe();

  supabaseClient
    .channel('gm_state')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game_state', filter: 'id=eq.1' }, payload => {
      gameState = payload.new;
      renderGMPanel();
    })
    .subscribe();

  // Chargements initiaux
  await syncGMData();
  supabaseClient.from('game_state').select('*').eq('id', 1).single().then(async ({ data }) => {
    if (data) {
      gameState = data;
      renderGMPanel();
    } else {
      console.log("Game state non trouvé (GM), initialisation par défaut...");
      const { data: newGS } = await supabaseClient.from('game_state').insert([{ id: 1, phase: 'lobby' }]).select().single();
      if (newGS) {
        gameState = newGS;
        renderGMPanel();
      }
    }
  });

  setupGMEventListeners();
  setupSimulator();
  runGlobalAutoPilot();
}

async function syncGMData() {
  const { data } = await supabaseClient.from('players').select('*').order('number');
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

  // Synchroniser le bouton automatique avec l'état réel de la base
  const autoGameCheckbox = document.getElementById('gm-auto-game');
  const autoGameBtn = document.getElementById('btn-gm-toggle-auto');
  if (autoGameCheckbox && autoGameBtn) {
    const isAuto = !!gameState.is_auto_mode;
    if (autoGameCheckbox.checked !== isAuto) {
      autoGameCheckbox.checked = isAuto;
      localStorage.setItem('cfg_auto_game', isAuto);
      
      const simAuto = document.getElementById('sim-auto-pilot');
      if (simAuto) {
        if (isAuto) {
          simAuto.checked = true;
          simAuto.disabled = true;
        } else {
          simAuto.disabled = false;
        }
      }
    }
    
    // Mettre à jour l'apparence du bouton
    if (isAuto) {
      autoGameBtn.textContent = "DÉSACTIVER LE MODE AUTOMATIQUE";
      autoGameBtn.className = "btn btn-accent";
      autoGameBtn.style.boxShadow = "0 0 15px rgba(0, 245, 212, 0.4)";
      autoGameBtn.style.borderColor = "var(--neon-green)";
      const panel = document.getElementById('gm-auto-panel');
      if (panel) panel.style.borderColor = "rgba(0, 245, 212, 0.6)";
    } else {
      autoGameBtn.textContent = "ACTIVER LE MODE AUTOMATIQUE";
      autoGameBtn.className = "btn btn-secondary";
      autoGameBtn.style.boxShadow = "none";
      autoGameBtn.style.borderColor = "rgba(255,255,255,0.15)";
      const panel = document.getElementById('gm-auto-panel');
      if (panel) panel.style.borderColor = "rgba(0, 210, 255, 0.25)";
    }
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
  
  // Construire l'aperçu dynamique basé sur la config actuelle
  const estRoles = [];
  for (let i = 0; i < configWolvesCount; i++) estRoles.push('loup');
  
  const specialRoleMapping = {
    'chk-role-voyante': 'voyante',
    'chk-role-sorciere': 'sorciere',
    'chk-role-chasseur': 'chasseur',
    'chk-role-cupidon': 'cupidon',
    'chk-role-garde': 'garde',
    'chk-role-fluteur': 'fluteur',
    'chk-role-ange': 'ange',
    'chk-role-idiot': 'idiot',
    'chk-role-ancien': 'ancien'
  };
  
  for (const [chkId, roleKey] of Object.entries(specialRoleMapping)) {
    const chk = document.getElementById(chkId);
    if (chk && chk.checked) {
      estRoles.push(roleKey);
    }
  }
  
  const reqCount = estRoles.length;
  if (reqCount <= total) {
    for (let i = 0; i < (total - reqCount); i++) {
      estRoles.push('villageois');
    }
  }
  
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
      <div style="display:flex; align-items:center; gap:8px;">
        <span class="status-dot ${isOffline ? '' : 'done'}"></span>
        <button class="btn-delete-player" data-id="${p.id}" style="background:none; border:none; color:var(--neon-red); cursor:pointer; font-size:0.95rem; padding:2px 4px; line-height:1;" title="Supprimer ce joueur">❌</button>
      </div>
    `;
    listContainer.appendChild(item);
  });

  // Écouteurs de clic pour supprimer individuellement un joueur
  listContainer.querySelectorAll('.btn-delete-player').forEach(btn => {
    btn.addEventListener('click', async () => {
      const playerId = btn.dataset.id;
      const playerObj = players.find(x => x.id === playerId);
      if (playerObj) {
        if (confirm(`Voulez-vous vraiment supprimer le joueur ${playerObj.name} (N° ${playerObj.number}) ?`)) {
          await deletePlayerAndShift(playerObj);
        }
      }
    });
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

  let activeSectionId = null;
  switch (gameState.phase) {
    case 'lobby':
      activeSectionId = 'gm-section-lobby';
      document.getElementById('gm-current-phase-title').textContent = "Lobby d'inscription";
      break;

    case 'distributing':
      activeSectionId = 'gm-section-lobby';
      document.getElementById('gm-current-phase-title').textContent = "Distribution des cartes...";
      document.getElementById('btn-gm-start-game').textContent = "Distribution en cours... Lancer la Nuit ➔";
      break;

    case 'day_mayor_election':
      activeSectionId = 'gm-section-day-discussion';
      document.getElementById('gm-current-phase-title').textContent = "Élection du Maire";
      if (gameState.timer_started_at) {
        const start = new Date(gameState.timer_started_at).getTime();
        const left = gameState.timer_duration - Math.floor((Date.now() - start) / 1000);
        const timerEl = document.getElementById('gm-discussion-timer');
        if (timerEl) {
          timerEl.textContent = formatTime(left);
          timerEl.classList.remove('timer-normal', 'timer-warning', 'timer-critical');
          if (left > 60) timerEl.classList.add('timer-normal');
          else if (left > 15) timerEl.classList.add('timer-warning');
          else timerEl.classList.add('timer-critical');
        }
      }
      break;

    case 'day_vote_tiebreak':
      activeSectionId = 'gm-section-day-vote';
      document.getElementById('gm-current-phase-title').textContent = "Arbitrage du Maire (Égalité)";
      renderGMVoteControls();
      break;

    case 'night':
      activeSectionId = 'gm-section-night';
      document.getElementById('gm-current-phase-title').textContent = "Gestion de la Nuit";
      renderGMNightControls();
      break;

    case 'day_announcement':
      activeSectionId = 'gm-section-day-announcement';
      document.getElementById('gm-current-phase-title').textContent = "Annonces matinales";
      document.getElementById('gm-announcement-deaths').innerHTML = gameState.announcement_text || "Aucun mort ce matin.";
      break;

    case 'day_discussion':
      activeSectionId = 'gm-section-day-discussion';
      document.getElementById('gm-current-phase-title').textContent = "Débats du Village";
      
      // Timer débat
      if (gameState.timer_started_at) {
        const start = new Date(gameState.timer_started_at).getTime();
        const left = gameState.timer_duration - Math.floor((Date.now() - start) / 1000);
        const timerEl = document.getElementById('gm-discussion-timer');
        if (timerEl) {
          timerEl.textContent = formatTime(left);
          timerEl.classList.remove('timer-normal', 'timer-warning', 'timer-critical');
          if (left > 60) timerEl.classList.add('timer-normal');
          else if (left > 15) timerEl.classList.add('timer-warning');
          else timerEl.classList.add('timer-critical');
        }
      }
      break;

    case 'day_vote':
      activeSectionId = 'gm-section-day-vote';
      document.getElementById('gm-current-phase-title').textContent = "Votes du Village";
      renderGMVoteControls();
      break;

    case 'game_over':
      activeSectionId = 'gm-section-game-over';
      document.getElementById('gm-current-phase-title').textContent = "Fin de Partie";
      document.getElementById('gm-winner-announcement').textContent = (gameState.winners || "Inconnu").toUpperCase();
      break;
  }

  if (activeSectionId) {
    const activeEl = document.getElementById(activeSectionId);
    activeEl.classList.remove('hidden');
    if (gameState.phase !== activeEl.dataset.lastPhase) {
      activeEl.dataset.lastPhase = gameState.phase;
      activeEl.classList.remove('fade-in');
      void activeEl.offsetWidth; // Reflow
      activeEl.classList.add('fade-in');
    }
  }
  
  // Lancer l'auto-pilotage si minuteur de nuit configuré
  if (gameState.phase === 'night' && gameState.night_phase !== 'none' && configNightTimerVal > 0) {
    manageNightAutoPilot();
  } else {
    if (nightTurnTimeout) {
      clearTimeout(nightTurnTimeout);
      nightTurnTimeout = null;
    }
  }

  // Mettre à jour l'état du simulateur
  updateSimulatorState();
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

      // Compter les votes (qui peuvent être multiples séparés par des virgules)
      if (p.vote_target) {
        const targets = p.vote_target.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
        targets.forEach(t => {
          votesCount[t] = (votesCount[t] || 0) + 1;
        });
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

// Réinitialisation douce de la partie (Garder les joueurs)
async function softResetGame() {
  const updates = players.map(p => {
    return supabaseClient
      .from('players')
      .update({
        role: null,
        status: 'alive',
        charmed: false,
        vote_target: null,
        is_mayor: false
      })
      .eq('id', p.id);
  });
  await Promise.all(updates);

  await supabaseClient
    .from('game_state')
    .update({
      phase: 'lobby',
      night_phase: 'none',
      timer_duration: 0,
      timer_started_at: null,
      announcement_text: '',
      lovers: [],
      current_night_kills: [],
      current_night_saves: [],
      current_night_poisons: [],
      witch_heal_used: false,
      witch_poison_used: false,
      winners: ''
    })
    .eq('id', 1);
}

// Supprimer un joueur et décaler les numéros des suivants
async function deletePlayerAndShift(player) {
  const num = player.number;
  const id = player.id;

  const { error: deleteError } = await supabaseClient.from('players').delete().eq('id', id);
  if (deleteError) {
    console.error("Erreur suppression joueur:", deleteError);
    alert("Impossible de supprimer le joueur.");
    return;
  }

  // Sélectionner les joueurs restants avec un numéro supérieur
  const { data: subsequent, error: selectError } = await supabaseClient
    .from('players')
    .select('id, number')
    .gt('number', num);

  if (selectError) {
    console.log("Erreur selection joueurs suivants:", selectError);
    return;
  }

  if (subsequent && subsequent.length > 0) {
    const updates = subsequent.map(p => {
      return supabaseClient
        .from('players')
        .update({ number: p.number - 1 })
        .eq('id', p.id);
    });
    await Promise.all(updates);
  }
}

// Mettre à jour la phase de nuit en base de données avec minuteurs
async function setNightPhase(role) {
  const duration = configNightTimerVal;
  const startedAt = duration > 0 ? new Date().toISOString() : null;

  const cleanUpdates = players.map(p => {
    return supabaseClient.from('players').update({ vote_target: null }).eq('id', p.id);
  });
  await Promise.all(cleanUpdates);

  await supabaseClient.from('game_state').update({
    night_phase: role,
    timer_duration: duration,
    timer_started_at: startedAt
  }).eq('id', 1);
}

// Passer à l'étape de nuit suivante
async function advanceNightStep() {
  if (nightTurnTimeout) clearTimeout(nightTurnTimeout);

  const rolesSeq = ['cupidon', 'garde', 'voyante', 'loups', 'sorciere', 'fluteur', 'none'];
  const current = gameState.night_phase;
  let nextIdx = rolesSeq.indexOf(current) + 1;

  while (nextIdx < rolesSeq.length - 1) {
    const nextRole = rolesSeq[nextIdx];
    const hasRoleAlive = players.some(p => p.role === nextRole && p.status === 'alive');
    const isCupidonEligible = nextRole === 'cupidon' && (!gameState.lovers || gameState.lovers.length === 0);

    if (hasRoleAlive || nextRole === 'loups' || (nextRole === 'cupidon' && isCupidonEligible)) {
      break;
    }
    nextIdx++;
  }

  const nextRole = rolesSeq[nextIdx];

  if (current === 'loups') {
    await calculateLoupNightKill();
  }

  if (nextRole === 'none') {
    await supabaseClient.from('game_state').update({ night_phase: 'none', timer_duration: 0, timer_started_at: null }).eq('id', 1);
    if (gameState && !gameState.is_auto_mode) {
      alert("Fin des phases nocturnes. Vous pouvez réveiller le village.");
    }
  } else {
    await setNightPhase(nextRole);
  }
}

// Gérer l'auto-pilotage de la nuit côté GM
function manageNightAutoPilot() {
  if (nightTurnTimeout) return;

  const role = gameState.night_phase;
  const duration = gameState.timer_duration;
  const startedAt = gameState.timer_started_at;
  if (!startedAt || duration <= 0) return;

  const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  const left = duration - elapsed;

  // 1. Expiration du timer
  if (left <= 0) {
    console.log(`[Auto-Pilot] Temps nocturne expiré pour ${role}. Passage automatique.`);
    advanceNightStep();
    return;
  }

  // 2. Cible ou action déjà validée
  let actionCompleted = false;
  if (role === 'loups') {
    const livingWolves = players.filter(p => p.role === 'loup' && p.status === 'alive');
    const votesDone = livingWolves.filter(w => w.vote_target).length;
    if (livingWolves.length > 0 && votesDone === livingWolves.length) {
      actionCompleted = true;
    }
  } else if (role === 'cupidon') {
    if (gameState.lovers && gameState.lovers.length === 2) {
      actionCompleted = true;
    }
  } else if (role === 'garde') {
    if (gameState.current_night_saves && gameState.current_night_saves.length > 0) {
      actionCompleted = true;
    }
  } else {
    const activePlayer = players.find(p => p.role === role && p.status === 'alive');
    if (activePlayer && activePlayer.vote_target === 999) {
      actionCompleted = true;
    }
  }

  if (actionCompleted) {
    console.log(`[Auto-Pilot] Action nocturne validée pour ${role}. Transition dans 2.5s.`);
    const delay = 2000 + Math.random() * 1000;
    nightTurnTimeout = setTimeout(() => {
      nightTurnTimeout = null;
      advanceNightStep();
    }, delay);
    return;
  }

  nightTurnTimeout = setTimeout(() => {
    nightTurnTimeout = null;
    manageNightAutoPilot();
  }, 1000);
}

// Événements boutons Game Master
function setupGMEventListeners() {
  // Configurer les boutons de modification de loups dans le Lobby
  const wolvesVal = document.getElementById('config-wolves-val');
  if (wolvesVal) {
    document.getElementById('btn-config-wolves-minus').addEventListener('click', () => {
      if (configWolvesCount > 1) {
        configWolvesCount--;
        wolvesVal.textContent = configWolvesCount;
        localStorage.setItem('cfg_wolves', configWolvesCount);
        syncGMData();
      }
    });
    document.getElementById('btn-config-wolves-plus').addEventListener('click', () => {
      if (configWolvesCount < 10) {
        configWolvesCount++;
        wolvesVal.textContent = configWolvesCount;
        localStorage.setItem('cfg_wolves', configWolvesCount);
        syncGMData();
      }
    });
  }

  // Écouter les changements des checkboxes
  const checkboxes = [
    'chk-role-voyante', 'chk-role-sorciere', 'chk-role-chasseur',
    'chk-role-cupidon', 'chk-role-garde', 'chk-role-fluteur',
    'chk-role-ange', 'chk-role-idiot', 'chk-role-ancien'
  ];
  checkboxes.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => {
        syncGMData();
      });
    }
  });

  // Écouter le changement des minuteurs
  const nightTimerSelect = document.getElementById('config-night-timer');
  if (nightTimerSelect) {
    nightTimerSelect.addEventListener('change', () => {
      configNightTimerVal = parseInt(nightTimerSelect.value);
      localStorage.setItem('cfg_night_timer', configNightTimerVal);
    });
  }
  const dayTimerSelect = document.getElementById('config-day-timer');
  if (dayTimerSelect) {
    dayTimerSelect.addEventListener('change', () => {
      configDayTimerVal = parseInt(dayTimerSelect.value);
      localStorage.setItem('cfg_day_timer', configDayTimerVal);
    });
  }
  const voteTimerSelect = document.getElementById('config-vote-timer');
  if (voteTimerSelect) {
    voteTimerSelect.addEventListener('change', () => {
      configVoteTimerVal = parseInt(voteTimerSelect.value);
      localStorage.setItem('cfg_vote_timer', configVoteTimerVal);
    });
  }
  const mayorTimerSelect = document.getElementById('config-mayor-timer');
  if (mayorTimerSelect) {
    mayorTimerSelect.addEventListener('change', () => {
      configMayorTimerVal = parseInt(mayorTimerSelect.value);
      localStorage.setItem('cfg_mayor_timer', configMayorTimerVal);
    });
  }

  // Bouton de bascule du Mode Automatique
  const autoGameBtn = document.getElementById('btn-gm-toggle-auto');
  const autoGameCheckbox = document.getElementById('gm-auto-game');
  if (autoGameBtn && autoGameCheckbox) {
    // Fonction helper pour mettre à jour l'apparence visuelle du bouton et du panneau
    const updateAutoUI = (isAuto) => {
      autoGameCheckbox.checked = isAuto;
      if (isAuto) {
        autoGameBtn.textContent = "DÉSACTIVER LE MODE AUTOMATIQUE";
        autoGameBtn.className = "btn btn-accent";
        autoGameBtn.style.boxShadow = "0 0 15px rgba(0, 245, 212, 0.4)";
        autoGameBtn.style.borderColor = "var(--neon-green)";
        const panel = document.getElementById('gm-auto-panel');
        if (panel) panel.style.borderColor = "rgba(0, 245, 212, 0.6)";
      } else {
        autoGameBtn.textContent = "ACTIVER LE MODE AUTOMATIQUE";
        autoGameBtn.className = "btn btn-secondary";
        autoGameBtn.style.boxShadow = "none";
        autoGameBtn.style.borderColor = "rgba(255,255,255,0.15)";
        const panel = document.getElementById('gm-auto-panel');
        if (panel) panel.style.borderColor = "rgba(0, 210, 255, 0.25)";
      }
    };

    // Initialisation au chargement
    setTimeout(() => {
      updateAutoUI(autoGameCheckbox.checked);
    }, 100);

    autoGameBtn.addEventListener('click', async () => {
      const isAuto = !autoGameCheckbox.checked;
      updateAutoUI(isAuto);
      
      localStorage.setItem('cfg_auto_game', isAuto);
      
      const simAuto = document.getElementById('sim-auto-pilot');
      if (simAuto) {
        if (isAuto) {
          simAuto.checked = true;
          simAuto.disabled = true;
        } else {
          simAuto.disabled = false;
        }
      }
      
      // Activer/Désactiver le minuteur du lobby en base
      const updateData = { is_auto_mode: isAuto };
      if (gameState && gameState.phase === 'lobby') {
        if (isAuto) {
          updateData.timer_duration = 600; // 10 minutes
          updateData.timer_started_at = new Date().toISOString();
        } else {
          updateData.timer_duration = 0;
          updateData.timer_started_at = null;
        }
      }

      console.log("[Auto-Game] Mise à jour en base...", updateData);
      const { error } = await supabaseClient.from('game_state').update(updateData).eq('id', 1);
      if (error) {
        console.error("Erreur de base de données (mode automatique):", error);
        alert("⚠️ IMPOSSIBLE D'ACTIVER LE MODE AUTOMATIQUE\n\n" +
              "Avez-vous bien exécuté la requête SQL de migration dans Supabase ?\n" +
              "Pour corriger cela, allez dans le SQL Editor de Supabase et exécutez la commande suivante :\n\n" +
              "ALTER TABLE game_state ADD COLUMN IF NOT EXISTS is_auto_mode BOOLEAN DEFAULT FALSE;\n\n" +
              "Détail de l'erreur : " + error.message);
        
        // Annuler visuellement
        updateAutoUI(!isAuto);
        if (simAuto) simAuto.disabled = false;
      }
    });
  }

  // Lancer la partie / Distribuer rôles
  document.getElementById('btn-gm-start-game').addEventListener('click', async () => {
    if (gameState.phase === 'distributing') {
      // Si déjà en cours de distribution, passer directement à la nuit
      await advanceToNight();
      return;
    }

    document.getElementById('btn-gm-start-game').disabled = true;
    await distributeRolesAndStartGame(false);
    document.getElementById('btn-gm-start-game').disabled = false;
  });

  // Avancement manuel/automatique du tour de nuit
  document.getElementById('btn-gm-next-night-phase').addEventListener('click', async () => {
    await advanceNightStep();
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
          return supabaseClient.from('players').update({ status: 'dead' }).eq('id', p.id);
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
    await supabaseClient.from('game_state').update({
      phase: 'day_announcement',
      announcement_text: announcement
    }).eq('id', 1);

    document.getElementById('btn-gm-wake-village').disabled = false;
  });

  // Lancer le débat public
  document.getElementById('btn-gm-start-discussion').addEventListener('click', async () => {
    // Initialiser un débat de 3 minutes (180s)
    await supabaseClient.from('game_state').update({
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
      return supabaseClient.from('players').update({ vote_target: null }).eq('id', p.id);
    });
    await Promise.all(cleanVotes);

    await supabaseClient.from('game_state').update({
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
      
      // Log de l'Idiot du Village
      await addHistoryEvent('info', `📣 GRÂCE DE L'IDIOT : ${targetPlayer.name} (N° ${targetPlayer.number}) a été désigné par le village, mais c'est l'Idiot du Village ! Il est gracié.`);

      await supabaseClient.from('game_state').update({
        phase: 'day_announcement',
        announcement_text: `📣 ${targetPlayer.name} (N° ${targetPlayer.number}) a été désigné par le village, mais c'est l'Idiot du Village ! Il est gracié mais perd son vote.`
      }).eq('id', 1);
      
      document.getElementById('btn-gm-confirm-vote-kill').disabled = false;
      return;
    }

    // Gérer l'ange : si éliminé au Jour 1, il gagne immédiatement
    // (On peut vérifier si lovers est vide pour deviner si c'est le jour 1, ou simplement valider).

    // Éliminer le joueur et log
    await addHistoryEvent('death', `🗳️ VOTE DU VILLAGE : ${targetPlayer.name} (N° ${targetPlayer.number}) a été éliminé par le village. Rôle : ${ROLES_INFO[targetPlayer.role]?.title || targetPlayer.role}.`);
    await supabaseClient.from('players').update({ status: 'dead' }).eq('id', targetPlayer.id);

    // Vérifier les amoureux
    if (gameState.lovers && gameState.lovers.includes(targetPlayer.id)) {
      const otherId = gameState.lovers.find(id => id !== targetPlayer.id);
      const other = players.find(p => p.id === otherId);
      if (other && other.status === 'alive') {
        // Log de mort par chagrin d'amour
        await addHistoryEvent('death', `💔 MORT DE CHAGRIN : ${other.name} (N° ${other.number}) a succombé de chagrin.`);
        await supabaseClient.from('players').update({ status: 'dead' }).eq('id', other.id);
        alert(`💔 ${other.name} (N° ${other.number}) s'est donné la mort par chagrin d'amour !`);
      }
    }

    // Refaire une synchronisation et vérifier la fin de partie
    const { data: updatedPlayers } = await supabaseClient.from('players').select('*');
    const winners = checkGameOverConditions(updatedPlayers);

    if (winners) {
      const victoryText = getVictoryText(winners);
      await addHistoryEvent('info', victoryText);

      await supabaseClient.from('game_state').update({
        phase: 'game_over',
        winners: winners
      }).eq('id', 1);
    } else {
      // Passer à la nuit suivante
      await advanceToNight();
    }

    document.getElementById('btn-gm-confirm-vote-kill').disabled = false;
  });

  // Recommencer une partie depuis l'écran de fin (Garder les joueurs)
  document.getElementById('btn-gm-restart-lobby').addEventListener('click', async () => {
    if (confirm("Recommencer une partie en conservant tous les joueurs actuels ?")) {
      await softResetGame();
    }
  });

  // Fonction de réinitialisation robuste directe
  async function executeResetGameDirect() {
    let rpcSuccess = false;
    try {
      const { error } = await supabaseClient.rpc('reset_game');
      if (!error) {
        rpcSuccess = true;
      } else {
        console.warn("L'appel RPC reset_game a renvoyé une erreur:", error);
      }
    } catch (e) {
      console.warn("L'appel RPC reset_game a échoué avec une exception:", e);
    }

    if (!rpcSuccess) {
      console.log("Tentative de réinitialisation via requêtes directes...");
      const { error: deleteError } = await supabaseClient.from('players').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (deleteError) {
        console.error("Échec de la suppression directe des joueurs:", deleteError);
        alert("Erreur lors de la suppression des joueurs : " + deleteError.message + "\nVeuillez vérifier que vous avez bien exécuté le script SQL dans Supabase (notamment la désactivation RLS).");
        return;
      }
      
      const { error: updateError } = await supabaseClient.from('game_state').update({
        phase: 'lobby',
        night_phase: 'none',
        timer_duration: 0,
        timer_started_at: null,
        announcement_text: '',
        lovers: [],
        witch_heal_used: false,
        witch_poison_used: false,
        current_night_kills: [],
        current_night_saves: [],
        current_night_poisons: [],
        winners: ''
      }).eq('id', 1);
      
      if (updateError) {
        console.error("Échec de la mise à jour directe de game_state:", updateError);
        alert("Erreur lors de la mise à jour de l'état : " + updateError.message);
        return;
      }
    }
    
    // Succès ! Recharger localement la page du GM pour nettoyer les states locaux
    location.reload();
  }

  // Vider le salon depuis l'écran de fin (Supprimer les joueurs)
  document.getElementById('btn-gm-clear-players').addEventListener('click', async () => {
    if (confirm("Voulez-vous réinitialiser complètement le jeu et supprimer tous les joueurs ?")) {
      await executeResetGameDirect();
    }
  });

  // Recommencer une partie depuis la sidebar (Garder les joueurs)
  document.getElementById('btn-gm-restart-lobby-sidebar').addEventListener('click', async () => {
    if (confirm("Recommencer une partie en conservant tous les joueurs actuels ?")) {
      await softResetGame();
    }
  });

  // Bouton de réinitialisation complète de la partie (Supprimer les joueurs)
  document.getElementById('btn-gm-reset').addEventListener('click', async () => {
    if (confirm("ATTENTION : Cela supprimera tous les joueurs et réinitialisera le jeu. Continuer ?")) {
      await executeResetGameDirect();
    }
  });

  // Bouton d'extension de temps (+30s)
  const addTimeBtn = document.getElementById('btn-gm-add-time');
  if (addTimeBtn) {
    addTimeBtn.addEventListener('click', async () => {
      if (gameState.timer_duration > 0 && gameState.timer_started_at) {
        const newDuration = gameState.timer_duration + 30;
        await supabaseClient.from('game_state').update({
          timer_duration: newDuration
        }).eq('id', 1);
        if (navigator.vibrate) navigator.vibrate(30);
      }
    });
  }
}

// ==========================================================================
// SIMULATEUR DE BOTS DE TEST (Game Master)
// ==========================================================================
let lastSimulatedPhase = null;
let lastSimulatedSubPhase = null;
let isSimulating = false;

const BOT_NAMES = [
  "Pierre", "Sophie", "Thomas", "Marie", "Nicolas", "Julien", "Camille", "Lucas", "Chloé", "Antoine",
  "Mathieu", "Léa", "Alexandre", "Hugo", "Emma", "Manon", "Maxime", "Célia", "Valentin", "Pauline",
  "Clément", "Élodie", "Arthur", "Laura", "Quentin", "Romain", "Sarah", "Guillaume", "Julie", "Bastien",
  "Florian", "Audrey", "Maxence", "Justine", "Emile", "Aline", "Marc", "Alice", "Rémi", "Clara"
];

function setupSimulator() {
  const generateBtn = document.getElementById('btn-sim-generate');
  const triggerBtn = document.getElementById('btn-sim-trigger-actions');
  
  if (!generateBtn || !triggerBtn) return;
  
  generateBtn.addEventListener('click', async () => {
    const input = document.getElementById('sim-bot-count');
    const count = parseInt(input.value) || 12;
    generateBtn.disabled = true;
    await generateBots(count);
    generateBtn.disabled = false;
    await syncGMData();
  });
  
  triggerBtn.addEventListener('click', async () => {
    triggerBtn.disabled = true;
    await simulateCurrentPhaseActions();
    triggerBtn.disabled = false;
    await syncGMData();
  });
}

function calculateDynamicWolves(playerCount) {
  // Déterminer un nombre de loups de base (environ 15% à 18% des joueurs)
  let baseWolves = 1;
  if (playerCount >= 45) {
    baseWolves = 7;
  } else if (playerCount >= 35) {
    baseWolves = 6;
  } else if (playerCount >= 28) {
    baseWolves = 5;
  } else if (playerCount >= 18) {
    baseWolves = 4;
  } else if (playerCount >= 12) {
    baseWolves = 3;
  } else if (playerCount >= 8) {
    baseWolves = 2;
  } else {
    baseWolves = 1;
  }

  // Ajouter un petit aléatoire (-1, 0, ou +1)
  const rand = Math.random();
  let adjustment = 0;
  if (rand < 0.2) {
    adjustment = -1; // 20% de chances d'avoir un loup de moins
  } else if (rand > 0.8) {
    adjustment = 1;  // 20% de chances d'avoir un loup de plus
  }

  let finalWolves = baseWolves + adjustment;

  // Sécuriser les limites pour que le jeu reste jouable
  const minWolves = 1;
  const maxWolves = Math.floor(playerCount / 3); // Pas plus d'un tiers de loups
  finalWolves = Math.max(minWolves, Math.min(finalWolves, maxWolves));

  console.log(`[Auto-Wolves] Joueurs: ${playerCount}, Loups de base: ${baseWolves}, Aléatoire: ${adjustment}, Loups finaux: ${finalWolves}`);
  return finalWolves;
}

async function distributeRolesAndStartGame(isAuto = false) {
  if (players.length < 4) {
    if (!isAuto) alert("Il faut au moins 4 joueurs pour lancer une partie.");
    return false;
  }

  // Distribuer les rôles selon la configuration du GM (ou calcul dynamique en mode automatique)
  let wolvesCount = configWolvesCount;
  if (isAuto || (gameState && gameState.is_auto_mode)) {
    wolvesCount = calculateDynamicWolves(players.length);
  }

  const customRoles = [];
  for (let i = 0; i < wolvesCount; i++) {
    customRoles.push('loup');
  }

  const specialRoleMapping = {
    'chk-role-voyante': 'voyante',
    'chk-role-sorciere': 'sorciere',
    'chk-role-chasseur': 'chasseur',
    'chk-role-cupidon': 'cupidon',
    'chk-role-garde': 'garde',
    'chk-role-fluteur': 'fluteur',
    'chk-role-ange': 'ange',
    'chk-role-idiot': 'idiot',
    'chk-role-ancien': 'ancien'
  };

  for (const [chkId, roleKey] of Object.entries(specialRoleMapping)) {
    const chk = document.getElementById(chkId);
    if (chk && chk.checked) {
      customRoles.push(roleKey);
    }
  }

  if (customRoles.length > players.length) {
    if (!isAuto) alert(`Erreur : Le nombre de rôles configurés (${customRoles.length}) dépasse le nombre de joueurs inscrits (${players.length}).`);
    return false;
  }

  const villagersCount = players.length - customRoles.length;
  for (let i = 0; i < villagersCount; i++) {
    customRoles.push('villageois');
  }

  // Mélanger les rôles
  shuffleArray(customRoles);

  // Mettre à jour chaque joueur avec son rôle
  const updates = players.map((p, idx) => {
    return supabaseClient
      .from('players')
      .update({
        role: customRoles[idx],
        status: 'alive',
        charmed: false,
        vote_target: null,
        is_mayor: false
      })
      .eq('id', p.id);
  });

  await Promise.all(updates);

  // Initialiser l'état du jeu à distribution avec minuteur de 10s
  await supabaseClient.from('game_state').update({
    phase: 'distributing',
    lovers: [],
    current_night_kills: [],
    current_night_saves: [],
    current_night_poisons: [],
    witch_heal_used: false,
    witch_poison_used: false,
    winners: '',
    timer_duration: 10,
    timer_started_at: new Date().toISOString()
  }).eq('id', 1);

  // Enregistrer le début de la partie dans l'historique
  localHistory = [];
  await addHistoryEvent('setup', `La partie commence avec ${players.length} joueurs. Rôles distribués (${wolvesCount} Loups-Garous).`);

  return true;
}

async function autoLaunchGame() {
  console.log("[Auto-Pilot] Démarrage automatique du lobby...");
  
  // 1. Récupérer les joueurs les plus récents depuis la base de données
  const { data: latestPlayers, error } = await supabaseClient
    .from('players')
    .select('*')
    .order('number');
    
  if (error || !latestPlayers) {
    console.error("Erreur lors de la récupération des joueurs:", error);
    // Reporter d'une minute en cas d'erreur réseau
    await supabaseClient.from('game_state').update({
      timer_duration: 60,
      timer_started_at: new Date().toISOString()
    }).eq('id', 1);
    return;
  }
  
  // Filtrer les vrais joueurs
  const realPlayers = latestPlayers.filter(p => !p.name.startsWith('[Bot]'));
  
  if (realPlayers.length === 0) {
    console.log("[Auto-Pilot] Aucun joueur réel inscrit. Report de la session de 10 minutes.");
    // Report de 10 minutes (600s)
    await supabaseClient.from('game_state').update({
      timer_duration: 600,
      timer_started_at: new Date().toISOString()
    }).eq('id', 1);
    return;
  }
  
  // 2. Compléter à 50 joueurs avec des bots
  const botsNeeded = 50 - latestPlayers.length;
  if (botsNeeded > 0) {
    console.log(`[Auto-Pilot] Complétion du lobby avec ${botsNeeded} bots pour atteindre 50 joueurs.`);
    await generateBots(botsNeeded);
    // Attendre 2s pour que les sockets realtime mettent à jour la liste locale
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  // 3. Lancer la partie en distribuant les rôles
  const success = await distributeRolesAndStartGame(true);
  if (!success) {
    console.error("[Auto-Pilot] Échec du lancement automatique.");
    // Reporter d'une minute en cas d'échec
    await supabaseClient.from('game_state').update({
      timer_duration: 60,
      timer_started_at: new Date().toISOString()
    }).eq('id', 1);
  }
}

async function generateBots(count) {
  const statusEl = document.getElementById('sim-status-text');
  if (!statusEl) return;
  
  statusEl.textContent = "Génération des bots...";
  
  const names = [...BOT_NAMES];
  shuffleArray(names);
  
  for (let i = 0; i < count; i++) {
    const name = `[Bot] ${names[i % names.length]}${Math.floor(i / names.length) > 0 ? ' ' + Math.floor(i / names.length) : ''}`;
    statusEl.textContent = `Création de ${name} (${i + 1}/${count})...`;
    const { data, error } = await supabaseClient.rpc('join_lobby', { player_name: name });
    if (error) {
      console.error("Erreur lors de la création du bot:", error);
    }
  }
  
  statusEl.textContent = `${count} bots créés avec succès.`;
}

function updateSimulatorState() {
  const triggerBtn = document.getElementById('btn-sim-trigger-actions');
  const statusText = document.getElementById('sim-status-text');
  
  if (!triggerBtn || !statusText) return;
  
  const hasBots = players.some(p => p.name.startsWith('[Bot]'));
  if (!hasBots) {
    triggerBtn.disabled = true;
    statusText.textContent = "Aucun bot dans la partie.";
    return;
  }
  
  let needsAction = false;
  let actionDesc = "";
  
  if (gameState.phase === 'night' && gameState.night_phase !== 'none') {
    needsAction = true;
    actionDesc = `Action de nuit : ${ROLES_INFO[gameState.night_phase]?.title || gameState.night_phase}`;
  } else if (gameState.phase === 'day_vote') {
    needsAction = true;
    actionDesc = "Vote public du jour";
  }
  
  if (needsAction) {
    triggerBtn.disabled = false;
    statusText.textContent = `En attente : ${actionDesc}`;
    
    const autoPilot = document.getElementById('sim-auto-pilot').checked;
    const alreadySimulated = (lastSimulatedPhase === gameState.phase && lastSimulatedSubPhase === gameState.night_phase);
    
    if (autoPilot && !alreadySimulated && !isSimulating) {
      isSimulating = true;
      statusText.textContent = `Simulation auto dans 2s...`;
      
      const phaseAtSchedule = gameState.phase;
      const subPhaseAtSchedule = gameState.night_phase;
      
      setTimeout(async () => {
        if (gameState.phase === phaseAtSchedule && gameState.night_phase === subPhaseAtSchedule) {
          await simulateCurrentPhaseActions();
          await syncGMData();
        }
        isSimulating = false;
      }, 2000);
    }
  } else {
    triggerBtn.disabled = true;
    statusText.textContent = "Aucune action requise.";
  }
}

async function simulateCurrentPhaseActions() {
  const statusText = document.getElementById('sim-status-text');
  if (statusText) statusText.textContent = "Simulation des actions en cours...";
  
  lastSimulatedPhase = gameState.phase;
  lastSimulatedSubPhase = gameState.night_phase;
  
  const botPlayers = players.filter(p => p.name.startsWith('[Bot]') && p.status === 'alive');
  const allAlive = players.filter(p => p.status === 'alive');
  
  if (botPlayers.length === 0) {
    if (statusText) statusText.textContent = "Aucun bot vivant à simuler.";
    return;
  }
  
  if (gameState.phase === 'night') {
    const role = gameState.night_phase;
    
    if (role === 'loups') {
      const botWolves = botPlayers.filter(p => p.role === 'loup');
      if (botWolves.length > 0) {
        const targets = allAlive.filter(p => p.role !== 'loup');
        if (targets.length > 0) {
          const updates = botWolves.map(wolf => {
            const numVotes = Math.floor(Math.random() * 4); // 0 to 3 votes
            const shuffled = [...targets];
            shuffleArray(shuffled);
            const chosen = shuffled.slice(0, Math.min(numVotes, shuffled.length));
            const voteStr = chosen.map(p => p.number).join(',');
            return supabaseClient.from('players').update({ vote_target: voteStr }).eq('id', wolf.id);
          });
          await Promise.all(updates);
          if (statusText) statusText.textContent = "Les loups bots ont voté pour leurs cibles (0 à 3 votes par bot).";
        }
      }
    } else if (role === 'cupidon') {
      const cupidonBot = botPlayers.find(p => p.role === 'cupidon');
      if (cupidonBot && (!gameState.lovers || gameState.lovers.length === 0)) {
        if (allAlive.length >= 2) {
          const shuffled = [...allAlive];
          shuffleArray(shuffled);
          const lovers = [shuffled[0].id, shuffled[1].id];
          
          await addHistoryEvent('night', `💘 Cupidon a lié ${shuffled[0].name} (N° ${shuffled[0].number}) et ${shuffled[1].name} (N° ${shuffled[1].number}) par les liens sacrés de l'amour.`);

          await supabaseClient.from('game_state').update({ lovers }).eq('id', 1);
          if (statusText) statusText.textContent = "Cupidon bot a lié les amoureux.";
        }
      }
    } else if (role === 'garde') {
      const gardeBot = botPlayers.find(p => p.role === 'garde');
      if (gardeBot) {
        const target = allAlive[Math.floor(Math.random() * allAlive.length)];
        
        await addHistoryEvent('night', `🛡️ Le Garde a protégé ${target.name} (N° ${target.number}).`);

        await supabaseClient.from('game_state').update({ current_night_saves: [target.number] }).eq('id', 1);
        await supabaseClient.from('players').update({ vote_target: 999 }).eq('id', gardeBot.id);
        if (statusText) statusText.textContent = `Garde bot a protégé N° ${target.number}.`;
      }
    } else if (role === 'voyante') {
      const voyanteBot = botPlayers.find(p => p.role === 'voyante');
      if (voyanteBot && !voyanteBot.vote_target) {
        const targets = allAlive.filter(p => p.id !== voyanteBot.id);
        if (targets.length > 0) {
          const target = targets[Math.floor(Math.random() * targets.length)];
          
          await addHistoryEvent('night', `🔮 La Voyante a inspecté le rôle de ${target.name} (N° ${target.number}).`);

          await supabaseClient.from('players').update({ vote_target: 999 }).eq('id', voyanteBot.id);
          if (statusText) statusText.textContent = `Voyante bot a inspecté N° ${target.number}.`;
        }
      }
    } else if (role === 'sorciere') {
      const sorciereBot = botPlayers.find(p => p.role === 'sorciere');
      if (sorciereBot) {
        const kills = gameState.current_night_kills || [];
        let healUsed = gameState.witch_heal_used;
        let poisonUsed = gameState.witch_poison_used;
        
        let newKills = [...kills];
        let newPoisons = [];
        
        if (kills.length > 0 && !healUsed && Math.random() < 0.5) {
          newKills = [];
          healUsed = true;
          
          await addHistoryEvent('night', `🧪 La Sorcière a utilisé sa potion de vie pour ressusciter la victime des Loups-Garous.`);
        }
        
        if (!poisonUsed && Math.random() < 0.3) {
          const targets = allAlive.filter(p => p.id !== sorciereBot.id);
          if (targets.length > 0) {
            const target = targets[Math.floor(Math.random() * targets.length)];
            newPoisons = [target.number];
            poisonUsed = true;
            
            await addHistoryEvent('night', `🧪 La Sorcière a empoisonné ${target.name} (N° ${target.number}).`);
          }
        }
        
        await supabaseClient.from('game_state').update({
          current_night_kills: newKills,
          current_night_poisons: newPoisons,
          witch_heal_used: healUsed,
          witch_poison_used: poisonUsed
        }).eq('id', 1);
        
        await supabaseClient.from('players').update({ vote_target: 999 }).eq('id', sorciereBot.id);
        if (statusText) statusText.textContent = "Sorcière bot a pris ses décisions.";
      }
    } else if (role === 'fluteur') {
      const fluteurBot = botPlayers.find(p => p.role === 'fluteur');
      if (fluteurBot) {
        const targets = allAlive.filter(p => p.id !== fluteurBot.id && !p.charmed);
        if (targets.length >= 2) {
          const shuffled = [...targets];
          shuffleArray(shuffled);
          const charmedIds = [shuffled[0].id, shuffled[1].id];
          
          const names = charmedIds.map(id => allAlive.find(p => p.id === id)).filter(p => p).map(p => `${p.name} (N° ${p.number})`).join(' et ');
          await addHistoryEvent('night', `🎶 Le Flûteur a charmé ${names}.`);

          await supabaseClient.from('players').update({ charmed: true }).in('id', charmedIds);
          await supabaseClient.from('players').update({ vote_target: 999 }).eq('id', fluteurBot.id);
          if (statusText) statusText.textContent = `Flûteur bot a charmé N° ${shuffled[0].number} et N° ${shuffled[1].number}.`;
        } else if (targets.length > 0) {
          await addHistoryEvent('night', `🎶 Le Flûteur a charmé ${targets[0].name} (N° ${targets[0].number}).`);

          await supabaseClient.from('players').update({ charmed: true }).eq('id', targets[0].id);
          await supabaseClient.from('players').update({ vote_target: 999 }).eq('id', fluteurBot.id);
          if (statusText) statusText.textContent = `Flûteur bot a charmé N° ${targets[0].number}.`;
        } else {
          await supabaseClient.from('players').update({ vote_target: 999 }).eq('id', fluteurBot.id);
        }
      }
    }
  } else if (gameState.phase === 'day_mayor_election') {
    const votes = botPlayers.map(bot => {
      if (allAlive.length > 0) {
        const target = allAlive[Math.floor(Math.random() * allAlive.length)];
        return supabaseClient.from('players').update({ vote_target: target.number.toString() }).eq('id', bot.id);
      }
      return Promise.resolve();
    });
    await Promise.all(votes);
    if (statusText) statusText.textContent = "Tous les bots ont voté pour l'élection du Maire.";
  } else if (gameState.phase === 'day_vote') {
    const votes = botPlayers.map(bot => {
      const targets = allAlive.filter(p => p.id !== bot.id);
      if (targets.length > 0) {
        const numVotes = Math.floor(Math.random() * 4); // 0 à 3 votes
        const shuffled = [...targets];
        shuffleArray(shuffled);
        const chosen = shuffled.slice(0, Math.min(numVotes, shuffled.length));
        const voteStr = chosen.map(p => p.number).join(',');
        return supabaseClient.from('players').update({ vote_target: voteStr }).eq('id', bot.id);
      }
      return Promise.resolve();
    });
    await Promise.all(votes);
    if (statusText) statusText.textContent = "Tous les bots ont voté au hasard (0 à 3 votes par bot).";
  } else if (gameState.phase === 'day_vote_tiebreak') {
    const mayor = allAlive.find(p => p.is_mayor && p.name.startsWith('[Bot]'));
    if (mayor) {
      const parts = (gameState.announcement_text || "").split(':');
      const spotsLeft = parseInt(parts[0]) || 1;
      const tiedNums = parts[1] ? parts[1].split(',').map(n => parseInt(n)) : [];
      
      const tiedPlayers = allAlive.filter(p => tiedNums.includes(p.number));
      if (tiedPlayers.length > 0) {
        const shuffled = [...tiedPlayers];
        shuffleArray(shuffled);
        const chosen = shuffled.slice(0, Math.min(spotsLeft, shuffled.length));
        
        // Log de tranchement du maire bot
        const names = chosen.map(p => `${p.name} (N° ${p.number})`).join(', ');
        await addHistoryEvent('death', `⚖️ ARBITRAGE DU MAIRE : Le Maire bot ${mayor.name} (N° ${mayor.number}) a tranché l'égalité et a éliminé ${names}.`);

        const updates = chosen.map(p => {
          return supabaseClient.from('players').update({ status: 'dead' }).eq('id', p.id);
        });
        await Promise.all(updates);
        
        await supabaseClient.from('game_state').update({
          announcement_text: 'resolved'
        }).eq('id', 1);
        
        if (statusText) statusText.textContent = `Le Maire bot a tranché et éliminé : ${chosen.map(p => p.name).join(', ')}.`;
      }
    }
  }
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

  // Log de début de nuit
  const currentHistory = Array.isArray(gameState.game_history) ? gameState.game_history : [];
  const nightCount = currentHistory.filter(e => e.type === 'night_start').length + 1;
  await addHistoryEvent('night_start', `🌙 Nuit ${nightCount} : Le village s'endort...`);

  // Mettre à jour la phase à night et vider les variables de nuit
  await supabaseClient.from('game_state').update({
    phase: 'night',
    current_night_kills: [],
    current_night_saves: [],
    current_night_poisons: []
  }).eq('id', 1);

  // Appeler le helper pour définir la phase de nuit avec les minuteurs et nettoyer les votes
  await setNightPhase(startRole);
}

// Calculer le vote de nuit des Loups
async function calculateLoupNightKill() {
  const { data: wolvesPlayers } = await supabaseClient
    .from('players')
    .select('vote_target')
    .eq('role', 'loup')
    .eq('status', 'alive');

  if (wolvesPlayers && wolvesPlayers.length > 0) {
    const counts = {};
    wolvesPlayers.forEach(w => {
      if (w.vote_target) {
        const targets = w.vote_target.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
        targets.forEach(t => {
          counts[t] = (counts[t] || 0) + 1;
        });
      }
    });

    const aliveCount = players.filter(p => p.status === 'alive').length;
    const limit = Math.ceil(aliveCount / 10);

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const topTargets = sorted.slice(0, limit).map(([targetNum]) => parseInt(targetNum));

    if (topTargets.length > 0) {
      const names = topTargets.map(num => {
        const p = players.find(x => x.number === num);
        return p ? `${p.name} (N° ${p.number})` : `Joueur N° ${num}`;
      }).join(', ');
      await addHistoryEvent('night', `🐺 Les Loups-Garous ont attaqué ${names}.`);
    } else {
      await addHistoryEvent('night', `🐺 Les Loups-Garous n'ont trouvé aucune proie ce soir.`);
    }

    await supabaseClient.from('game_state').update({
      current_night_kills: topTargets
    }).eq('id', 1);
  }
}

// Mettre à jour le minuteur GM
async function updateGMTimer(seconds) {
  await supabaseClient.from('game_state').update({
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

// ==========================================================================
// ORCHESTRATEUR DE PARTIE AUTOMATIQUE GLOBAL (GM)
// ==========================================================================

function runGlobalAutoPilot() {
  if (globalAutoPilotInterval) clearInterval(globalAutoPilotInterval);

  globalAutoPilotInterval = setInterval(async () => {
    if (!gameState || !gameState.phase) return;

    const phase = gameState.phase;
    const duration = gameState.timer_duration;
    const startedAt = gameState.timer_started_at;

    // Gérer l'affichage du minuteur sur l'écran GM (lobby)
    const lobbyTimerVal = document.getElementById('gm-lobby-timer-val');
    const lobbyTimerContainer = document.getElementById('gm-lobby-timer-container');
    if (gameState.is_auto_mode && phase === 'lobby' && startedAt && duration > 0) {
      if (lobbyTimerContainer) lobbyTimerContainer.classList.remove('hidden');
      const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
      const left = duration - elapsed;
      if (lobbyTimerVal) {
        if (left > 0) {
          lobbyTimerVal.textContent = formatTime(left);
        } else {
          lobbyTimerVal.textContent = "Lancement...";
        }
      }
    } else {
      if (lobbyTimerContainer) lobbyTimerContainer.classList.add('hidden');
    }

    // Gestion du démarrage automatique du lobby
    if (gameState.is_auto_mode && phase === 'lobby') {
      if (!startedAt || duration <= 0) {
        // Initialiser le compte à rebours de 10 min (600s)
        await supabaseClient.from('game_state').update({
          timer_duration: 600,
          timer_started_at: new Date().toISOString()
        }).eq('id', 1);
        return;
      }

      const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
      const left = duration - elapsed;

      if (left <= 0) {
        console.log("[Auto-Pilot] Compte à rebours du lobby expiré. Lancement...");
        clearInterval(globalAutoPilotInterval);
        await autoLaunchGame();
        runGlobalAutoPilot();
      }
      return; // Ne pas exécuter le reste de la boucle de jeu dans la phase lobby
    }

    // Gestion de la fin de partie automatique (30 secondes d'attente puis reset)
    if (gameState.is_auto_mode && phase === 'game_over') {
      if (!startedAt || duration <= 0) {
        await supabaseClient.from('game_state').update({
          timer_duration: 30, // 30s d'affichage des résultats
          timer_started_at: new Date().toISOString()
        }).eq('id', 1);
        return;
      }

      const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
      const left = duration - elapsed;

      if (left <= 0) {
        console.log("[Auto-Pilot] Temps de fin de partie écoulé. Réinitialisation et retour au lobby.");
        clearInterval(globalAutoPilotInterval);
        const { error } = await supabaseClient.rpc('reset_game');
        if (error) {
          console.error("Erreur lors de la réinitialisation de la partie:", error);
        }
        runGlobalAutoPilot();
      }
      return; // Ne pas exécuter le reste de la boucle de jeu dans la phase game_over
    }

    if (!startedAt || duration <= 0) return;

    const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
    const left = duration - elapsed;

    // 1. Gérer le bouton de rallonge de temps "+30s"
    const addTimeBtn = document.getElementById('btn-gm-add-time');
    if (addTimeBtn) {
      if (['distributing', 'day_mayor_election', 'day_vote_tiebreak', 'night', 'day_announcement', 'day_discussion', 'day_vote'].includes(phase) && left > 0) {
        addTimeBtn.classList.remove('hidden');
      } else {
        addTimeBtn.classList.add('hidden');
      }
    }

    // Si le temps n'est pas expiré, on ne fait rien sauf conditions spéciales (ex: Maire a résolu)
    if (left > 0) {
      if (phase === 'day_vote_tiebreak' && gameState.announcement_text === 'resolved') {
        clearInterval(globalAutoPilotInterval);
        await finishDayVoteTiebreak(true);
        runGlobalAutoPilot();
      }
      return;
    }

    // Le temps est expiré ! Transition automatique
    console.log(`[Auto-Pilot] Temps expiré pour la phase : ${phase}`);
    clearInterval(globalAutoPilotInterval);

    try {
      if (phase === 'distributing') {
        await startMayorElection();
      } 
      else if (phase === 'day_mayor_election') {
        await resolveMayorElection();
      } 
      else if (phase === 'night') {
        if (gameState.night_phase === 'none') {
          await wakeUpVillage();
        } else {
          await advanceNightStep();
        }
      } 
      else if (phase === 'day_announcement') {
        await startDayDiscussion();
      } 
      else if (phase === 'day_discussion') {
        await startDayVote();
      } 
      else if (phase === 'day_vote') {
        await resolveDayVote();
      }
      else if (phase === 'day_vote_tiebreak') {
        await finishDayVoteTiebreak(false);
      }
    } catch (err) {
      console.error("Erreur lors de la transition automatique:", err);
    }

    runGlobalAutoPilot();
  }, 1000);
}

async function startMayorElection() {
  const clean = players.map(p => supabaseClient.from('players').update({ vote_target: null }).eq('id', p.id));
  await Promise.all(clean);

  await supabaseClient.from('game_state').update({
    phase: 'day_mayor_election',
    timer_duration: configMayorTimerVal,
    timer_started_at: new Date().toISOString(),
    announcement_text: ''
  }).eq('id', 1);
}

async function resolveMayorElection() {
  const { data: activePlayers } = await supabaseClient
    .from('players')
    .select('id, name, number, vote_target')
    .eq('status', 'alive');

  if (!activePlayers || activePlayers.length === 0) {
    await advanceToNight();
    return;
  }

  const counts = {};
  activePlayers.forEach(p => {
    if (p.vote_target) {
      const num = parseInt(p.vote_target);
      if (!isNaN(num)) {
        counts[num] = (counts[num] || 0) + 1;
      }
    }
  });

  let mayorNum = null;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (sorted.length > 0) {
    const maxVotes = sorted[0][1];
    const candidates = sorted.filter(c => c[1] === maxVotes).map(c => parseInt(c[0]));
    mayorNum = candidates[Math.floor(Math.random() * candidates.length)];
  } else {
    const randPlayer = activePlayers[Math.floor(Math.random() * activePlayers.length)];
    if (randPlayer) mayorNum = randPlayer.number;
  }

  const mayorPlayer = activePlayers.find(p => p.number === mayorNum);
  if (mayorPlayer) {
    await supabaseClient.from('players').update({ is_mayor: true }).eq('id', mayorPlayer.id);
    
    // Log election maire
    await addHistoryEvent('info', `👑 ÉLECTION DU MAIRE : ${mayorPlayer.name} (N° ${mayorPlayer.number}) a été élu Maire.`);

    await supabaseClient.from('game_state').update({
      announcement_text: `👑 ${mayorPlayer.name} (N° ${mayorPlayer.number}) a été élu Maire !`
    }).eq('id', 1);

    setTimeout(async () => {
      await advanceToNight();
    }, 3000);
  } else {
    await advanceToNight();
  }
}

async function wakeUpVillage() {
  const { data: allPlayers } = await supabaseClient.from('players').select('*');
  if (!allPlayers) return;

  const kills = gameState.current_night_kills || [];
  const saves = gameState.current_night_saves || [];
  const poisons = gameState.current_night_poisons || [];

  const deadThisNight = [];

  kills.forEach(targetNum => {
    if (!saves.includes(targetNum)) {
      deadThisNight.push(targetNum);
    }
  });

  poisons.forEach(targetNum => {
    deadThisNight.push(targetNum);
  });

  let loverDied = false;
  if (gameState.lovers && gameState.lovers.length === 2) {
    const [lover1Id, lover2Id] = gameState.lovers;
    const lover1 = allPlayers.find(p => p.id === lover1Id);
    const lover2 = allPlayers.find(p => p.id === lover2Id);

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

  let announcement = "";
  if (deadThisNight.length > 0) {
    const uniqueDeads = [...new Set(deadThisNight)];
    
    // Log des morts dans l'historique
    for (const num of uniqueDeads) {
      const p = allPlayers.find(x => x.number === num);
      if (p) {
        await addHistoryEvent('death', `☠️ MORT DE NUIT : ${p.name} (N° ${p.number}) qui était ${ROLES_INFO[p.role]?.title || p.role}.`);
      }
    }
    if (loverDied) {
      await addHistoryEvent('death', `💔 MORT DE CHAGRIN : Un des amoureux a succombé de chagrin.`);
    }

    const killUpdates = uniqueDeads.map(num => {
      const p = allPlayers.find(x => x.number === num);
      if (p) {
        announcement += `☠️ <strong>${p.name}</strong> (N° ${p.number}), qui était <i>${ROLES_INFO[p.role]?.title || p.role}</i>.<br>`;
        return supabaseClient.from('players').update({ status: 'dead' }).eq('id', p.id);
      }
      return Promise.resolve();
    });
    await Promise.all(killUpdates);
    
    if (loverDied) {
      announcement += `<br>💔 Deux amoureux ont été réunis dans la mort...`;
    }
  } else {
    announcement = "🍀 Aucun mort cette nuit. Le village respire !";
    await addHistoryEvent('info', `🍀 Aucun mort cette nuit. Le village se réveille en paix !`);
  }

  const { data: updatedPlayers } = await supabaseClient.from('players').select('*');
  const winners = checkGameOverConditions(updatedPlayers);

  if (winners) {
    const victoryText = getVictoryText(winners);
    await addHistoryEvent('info', victoryText);
    
    await supabaseClient.from('game_state').update({
      phase: 'game_over',
      winners: winners,
      announcement_text: announcement
    }).eq('id', 1);
  } else {
    await supabaseClient.from('game_state').update({
      phase: 'day_announcement',
      announcement_text: announcement,
      timer_duration: 10,
      timer_started_at: new Date().toISOString()
    }).eq('id', 1);
  }
}

async function startDayDiscussion() {
  await supabaseClient.from('game_state').update({
    phase: 'day_discussion',
    timer_duration: configDayTimerVal,
    timer_started_at: new Date().toISOString()
  }).eq('id', 1);
}

async function startDayVote() {
  const cleanVotes = players.map(p => {
    return supabaseClient.from('players').update({ vote_target: null }).eq('id', p.id);
  });
  await Promise.all(cleanVotes);

  await supabaseClient.from('game_state').update({
    phase: 'day_vote',
    timer_duration: configVoteTimerVal,
    timer_started_at: new Date().toISOString()
  }).eq('id', 1);
}

async function resolveDayVote() {
  const { data: alivePlayers } = await supabaseClient
    .from('players')
    .select('*')
    .eq('status', 'alive');

  if (!alivePlayers || alivePlayers.length === 0) return;

  const totalAlive = alivePlayers.length;
  const limit = Math.ceil(totalAlive / 10);

  const votesCount = {};
  alivePlayers.forEach(p => {
    if (p.vote_target) {
      const targets = p.vote_target.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
      targets.forEach(t => {
        votesCount[t] = (votesCount[t] || 0) + 1;
      });
    }
  });

  const sorted = alivePlayers
    .map(p => ({ player: p, votes: votesCount[p.number] || 0 }))
    .sort((a, b) => b.votes - a.votes);

  if (sorted.length === 0 || sorted[0].votes === 0) {
    await announceNoDayElimination();
    return;
  }

  const definitelyKill = [];
  const tiedForLastSpot = [];

  const boundaryVotes = sorted[Math.min(limit - 1, sorted.length - 1)].votes;

  sorted.forEach(item => {
    if (item.votes > boundaryVotes) {
      definitelyKill.push(item.player);
    } else if (item.votes === boundaryVotes && boundaryVotes > 0) {
      tiedForLastSpot.push(item.player);
    }
  });

  const spotsLeft = limit - definitelyKill.length;

  if (tiedForLastSpot.length > spotsLeft && spotsLeft > 0) {
    const mayor = alivePlayers.find(p => p.is_mayor);
    if (mayor) {
      const tiedNumbers = tiedForLastSpot.map(p => p.number).join(',');
      await supabaseClient.from('game_state').update({
        phase: 'day_vote_tiebreak',
        announcement_text: `${spotsLeft}:${tiedNumbers}`,
        timer_duration: 15,
        timer_started_at: new Date().toISOString()
      }).eq('id', 1);
    } else {
      shuffleArray(tiedForLastSpot);
      const chosen = tiedForLastSpot.slice(0, spotsLeft);
      await executeDayEliminations([...definitelyKill, ...chosen]);
    }
  } else {
    const toKill = [...definitelyKill];
    if (spotsLeft > 0) {
      toKill.push(...tiedForLastSpot.slice(0, spotsLeft));
    }
    await executeDayEliminations(toKill);
  }
}

async function finishDayVoteTiebreak(resolvedByMayor) {
  if (resolvedByMayor) {
    const { data: updatedPlayers } = await supabaseClient.from('players').select('*');
    const winners = checkGameOverConditions(updatedPlayers);
    if (winners) {
      const victoryText = getVictoryText(winners);
      await addHistoryEvent('info', victoryText);
      await supabaseClient.from('game_state').update({
        phase: 'game_over',
        winners: winners
      }).eq('id', 1);
    } else {
      await advanceToNight();
    }
  } else {
    const parts = (gameState.announcement_text || "").split(':');
    const spotsLeft = parseInt(parts[0]) || 1;
    const tiedNums = parts[1] ? parts[1].split(',').map(n => parseInt(n)) : [];

    const { data: alivePlayers } = await supabaseClient
      .from('players')
      .select('*')
      .eq('status', 'alive')
      .in('number', tiedNums);

    shuffleArray(alivePlayers);
    const chosen = alivePlayers.slice(0, spotsLeft);

    // Log d'arbitrage expiré dans l'historique
    const names = chosen.map(p => `${p.name} (N° ${p.number})`).join(', ');
    await addHistoryEvent('death', `⚖️ ARBITRAGE EXPIRÉ : Le temps imparti au maire a expiré. Le destin a éliminé aléatoirement ${names}.`);

    const updates = chosen.map(p => {
      return supabaseClient.from('players').update({ status: 'dead' }).eq('id', p.id);
    });
    await Promise.all(updates);

    const { data: updatedPlayers } = await supabaseClient.from('players').select('*');
    const winners = checkGameOverConditions(updatedPlayers);
    if (winners) {
      const victoryText = getVictoryText(winners);
      await addHistoryEvent('info', victoryText);
      await supabaseClient.from('game_state').update({
        phase: 'game_over',
        winners: winners
      }).eq('id', 1);
    } else {
      await advanceToNight();
    }
  }
}

async function executeDayEliminations(playersToKill) {
  const updates = playersToKill.map(p => {
    return supabaseClient.from('players').update({ status: 'dead' }).eq('id', p.id);
  });
  await Promise.all(updates);

  let loverDied = false;
  if (gameState.lovers && gameState.lovers.length === 2) {
    const [l1, l2] = gameState.lovers;
    const deadIds = playersToKill.map(p => p.id);
    if (deadIds.includes(l1) || deadIds.includes(l2)) {
      const otherId = deadIds.includes(l1) ? l2 : l1;
      await supabaseClient.from('players').update({ status: 'dead' }).eq('id', otherId);
      loverDied = true;
    }
  }

  // Log de vote du village dans l'historique
  for (const p of playersToKill) {
    await addHistoryEvent('death', `🗳️ VOTE DU VILLAGE : ${p.name} (N° ${p.number}) a été éliminé par le village. Rôle : ${ROLES_INFO[p.role]?.title || p.role}.`);
  }
  if (loverDied) {
    await addHistoryEvent('death', `💔 MORT DE CHAGRIN : Un des amoureux a succombé de chagrin.`);
  }

  let text = "☠️ Le village a éliminé :<br>";
  playersToKill.forEach(p => {
    text += `<strong>${p.name}</strong> (N° ${p.number}) qui était <i>${ROLES_INFO[p.role]?.title || p.role}</i>.<br>`;
  });
  if (loverDied) {
    text += "💔 Un cœur s'est brisé... l'amoureux l'a suivi dans la tombe.";
  }

  const { data: updatedPlayers } = await supabaseClient.from('players').select('*');
  const winners = checkGameOverConditions(updatedPlayers);

  if (winners) {
    const victoryText = getVictoryText(winners);
    await addHistoryEvent('info', victoryText);

    await supabaseClient.from('game_state').update({
      phase: 'game_over',
      winners: winners,
      announcement_text: text
    }).eq('id', 1);
  } else {
    await supabaseClient.from('game_state').update({
      phase: 'day_announcement',
      announcement_text: text,
      timer_duration: 8,
      timer_started_at: new Date().toISOString()
    }).eq('id', 1);
  }
}

async function announceNoDayElimination() {
  // Log de vote blanc dans l'historique
  await addHistoryEvent('info', `📣 DÉBATS : L'Assemblée a voté blanc, aucun suspect n'a été éliminé.`);

  await supabaseClient.from('game_state').update({
    phase: 'day_announcement',
    announcement_text: "📣 Les villageois n'ont désigné aucun coupable aujourd'hui.",
    timer_duration: 8,
    timer_started_at: new Date().toISOString()
  }).eq('id', 1);
}
