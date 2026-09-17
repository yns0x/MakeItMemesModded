const socket = io();

let state = {
  code: null,
  mode: 'classic',
  timerInterval: null,
};

// ---------- Utils ----------------------------------------------------

function $(id) { return document.getElementById(id); }

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
  $(id).classList.add('active');
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 3200);
}

function emitAck(event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (res) => resolve(res || { ok: false, error: 'Pas de réponse du serveur.' }));
  });
}

function resizeImageFile(file, maxDim = 1000, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const c = document.createElement('canvas');
        c.width = width;
        c.height = height;
        c.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---------- Home screen ------------------------------------------------

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    $('tab-' + btn.dataset.tab).classList.add('active');
  });
});

let chosenMode = 'classic';
document.querySelectorAll('.mode-card').forEach((card) => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.mode-card').forEach((c) => c.classList.remove('active'));
    card.classList.add('active');
    chosenMode = card.dataset.mode;
  });
});

$('btnCreate').addEventListener('click', async () => {
  const name = $('createName').value.trim();
  if (!name) return toast('Choisis un pseudo.');
  const settings = {
    mode: chosenMode,
    rounds: $('setRounds').value,
    captionSeconds: $('setCaption').value,
    voteSeconds: $('setVote').value,
  };
  const res = await emitAck('room:create', { name, settings });
  if (!res.ok) return toast(res.error);
  state.code = res.code;
  enterRoom();
});

$('btnJoin').addEventListener('click', async () => {
  const name = $('joinName').value.trim();
  const code = $('joinCode').value.trim().toUpperCase();
  if (!name) return toast('Choisis un pseudo.');
  if (!code) return toast('Entre le code de la partie.');
  const res = await emitAck('room:join', { name, code });
  if (!res.ok) return toast(res.error);
  state.code = res.code;
  enterRoom();
});

function enterRoom() {
  $('roomBadge').classList.remove('hidden');
  $('roomCodeLabel').textContent = state.code;
  $('lobbyCode').textContent = state.code;
}

// ---------- Lobby --------------------------------------------------

$('btnStart').addEventListener('click', async () => {
  const res = await emitAck('room:start', {});
  if (!res.ok) toast(res.error);
});

$('btnPlayAgain').addEventListener('click', async () => {
  const res = await emitAck('room:playAgain', {});
  if (!res.ok) toast(res.error);
});

// ---------- Caption / creation ---------------------------------------

let currentPhaseKey = null; // evite de reset l'editeur a chaque tick d'etat
let fileChosenUrl = null;

$('fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) return toast('Choisis un fichier image.');
  try {
    fileChosenUrl = await resizeImageFile(file);
    $('editorZone').classList.remove('hidden');
    await MemeCanvas.loadImage(fileChosenUrl);
  } catch (err) {
    toast('Impossible de lire cette image.');
  }
});

$('topText').addEventListener('input', (e) => MemeCanvas.setTopText(e.target.value));
$('bottomText').addEventListener('input', (e) => MemeCanvas.setBottomText(e.target.value));

$('btnSubmitMeme').addEventListener('click', async () => {
  if (!MemeCanvas.hasImage()) return toast('Ajoute une image avant de valider.');
  const dataUrl = MemeCanvas.toDataURL();
  $('btnSubmitMeme').disabled = true;
  const res = await emitAck('submission:submit', { imageUrl: dataUrl });
  if (!res.ok) {
    toast(res.error);
    $('btnSubmitMeme').disabled = false;
    return;
  }
  $('capSubmittedInfo').textContent = 'Mème envoyé ! En attente des autres joueurs…';
});

// ---------- Voting -----------------------------------------------------

$('voteGallery').addEventListener('click', async (e) => {
  const item = e.target.closest('.gallery-item');
  if (!item || item.classList.contains('disabled')) return;
  const targetId = item.dataset.playerId;
  const res = await emitAck('vote:cast', { targetId });
  if (!res.ok) return toast(res.error);
  document.querySelectorAll('#voteGallery .gallery-item').forEach((el) => {
    el.classList.remove('selected');
    el.classList.add('disabled');
  });
  item.classList.add('selected');
});

// ---------- Timer helper ------------------------------------------------

function runTimer(elId, endsAt, serverNow) {
  clearInterval(state.timerInterval);
  const skew = Date.now() - serverNow;
  const el = $(elId);
  function tick() {
    const remaining = Math.max(0, Math.round((endsAt - (Date.now() - skew)) / 1000));
    el.textContent = remaining + 's';
    el.classList.toggle('low', remaining <= 10);
    if (remaining <= 0) clearInterval(state.timerInterval);
  }
  tick();
  state.timerInterval = setInterval(tick, 250);
}

// ---------- State rendering --------------------------------------------

socket.on('room:state', (s) => {
  state.mode = s.settings.mode;

  switch (s.phase) {
    case 'lobby': renderLobby(s); break;
    case 'caption': renderCaption(s); break;
    case 'voting': renderVoting(s); break;
    case 'reveal': renderReveal(s); break;
    case 'gameover': renderGameOver(s); break;
  }
});

function renderPlayerList(container, players, hostId) {
  container.innerHTML = '';
  players
    .slice()
    .sort((a, b) => b.score - a.score)
    .forEach((p) => {
      const li = document.createElement('li');
      if (!p.connected) li.classList.add('offline');
      li.innerHTML = `<span>${escapeHtml(p.name)} ${p.id === hostId ? '<span class="host-tag">HÔTE</span>' : ''}</span><span>${p.score} pts</span>`;
      container.appendChild(li);
    });
}

function renderLobby(s) {
  showScreen('screen-lobby');
  $('lobbyCode').textContent = s.code;
  $('lobbyModeInfo').textContent =
    s.settings.mode === 'upload'
      ? `Mode Upload perso — ${s.settings.rounds} manches — chacun apporte sa propre image.`
      : `Mode Classique — ${s.settings.rounds} manches — templates fournis par le jeu.`;
  renderPlayerList($('lobbyPlayers'), s.players, s.hostId);
  $('btnStart').classList.toggle('hidden', !s.isHost);
  $('lobbyWait').classList.toggle('hidden', s.isHost);
}

function renderCaption(s) {
  showScreen('screen-caption');
  $('capRound').textContent = s.round;
  $('capTotal').textContent = s.totalRounds;
  runTimer('capTimer', s.phaseEndsAt, s.serverNow);

  const phaseKey = `caption-${s.round}`;
  const isUpload = s.settings.mode === 'upload';
  $('uploadZone').classList.toggle('hidden', !isUpload);

  if (currentPhaseKey !== phaseKey) {
    currentPhaseKey = phaseKey;
    fileChosenUrl = null;
    $('fileInput').value = '';
    $('topText').value = '';
    $('bottomText').value = '';
    $('btnSubmitMeme').disabled = false;
    $('capSubmittedInfo').textContent = '';
    $('editorZone').classList.add('hidden');

    if (!isUpload && s.template) {
      $('editorZone').classList.remove('hidden');
      MemeCanvas.loadImage(s.template.file);
    }
  }

  $('capStatus').textContent = isUpload
    ? 'Choisis ta propre image, écris ton texte, puis valide.'
    : `Template : ${s.template ? s.template.name : ''} — écris ta légende.`;

  if (s.youSubmitted) {
    $('capSubmittedInfo').textContent = `Mème envoyé ! (${s.submittedCount}/${s.activeCount} joueurs prêts)`;
  } else {
    $('capSubmittedInfo').textContent = `${s.submittedCount}/${s.activeCount} joueurs ont déjà validé leur mème.`;
  }
}

function renderVoting(s) {
  showScreen('screen-voting');
  $('voteRound').textContent = s.round;
  runTimer('voteTimer', s.phaseEndsAt, s.serverNow);
  $('voteProgress').textContent = `${s.votedCount}/${s.eligibleCount} ont voté.`;

  const gallery = $('voteGallery');
  const phaseKey = `voting-${s.round}`;
  if (currentPhaseKey !== phaseKey) {
    currentPhaseKey = phaseKey;
    gallery.innerHTML = '';
    s.gallery.forEach((entry) => {
      const div = document.createElement('div');
      div.className = 'gallery-item';
      div.dataset.playerId = entry.playerId;
      div.innerHTML = `<img src="${entry.imageUrl}" alt="mème" />`;
      gallery.appendChild(div);
    });
    if (s.gallery.length === 0) {
      gallery.innerHTML = '<p class="muted">Personne d\'autre n\'a soumis de mème cette manche.</p>';
    }
  }

  if (s.hasVoted) {
    document.querySelectorAll('#voteGallery .gallery-item').forEach((el) => el.classList.add('disabled'));
  }
}

function renderReveal(s) {
  showScreen('screen-reveal');
  currentPhaseKey = null;
  const container = $('revealEntries');
  container.innerHTML = '';
  const results = s.results;
  if (results.noSubmissions) {
    container.innerHTML = '<p class="muted">Personne n\'a soumis de mème cette manche.</p>';
  } else {
    results.entries.forEach((entry) => {
      const div = document.createElement('div');
      div.className = 'gallery-item';
      div.innerHTML = `
        <img src="${entry.imageUrl}" alt="mème de ${escapeHtml(entry.name)}" />
        <div class="reveal-meta">
          <span>${escapeHtml(entry.name)}</span>
          <span class="votes">${entry.votes} vote${entry.votes > 1 ? 's' : ''} · +${entry.points}</span>
        </div>`;
      container.appendChild(div);
    });
  }
  renderOrderedLeaderboard($('revealLeaderboard'), results.leaderboard);
}

function renderGameOver(s) {
  showScreen('screen-gameover');
  renderOrderedLeaderboard($('finalLeaderboard'), s.finalLeaderboard);
  $('btnPlayAgain').classList.toggle('hidden', !s.isHost);
  $('gameoverWait').classList.toggle('hidden', s.isHost);
}

function renderOrderedLeaderboard(container, list) {
  container.innerHTML = '';
  list.forEach((p, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>#${i + 1} ${escapeHtml(p.name)}</span><span>${p.score} pts</span>`;
    container.appendChild(li);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Boot ---------------------------------------------------------

MemeCanvas.init($('memeCanvas'));

socket.on('connect_error', () => toast('Connexion au serveur impossible.'));
