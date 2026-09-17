const TEMPLATES = require('./templates');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans caracteres ambigus
const PHASE = {
  LOBBY: 'lobby',
  CAPTION: 'caption',
  VOTING: 'voting',
  REVEAL: 'reveal',
  GAMEOVER: 'gameover',
};

const DEFAULT_SETTINGS = {
  mode: 'classic', // 'classic' | 'upload'
  rounds: 5,
  captionSeconds: 75,
  voteSeconds: 30,
};

function makeCode() {
  let code = '';
  for (let i = 0; i < 5; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

class Room {
  constructor(code, hostId) {
    this.code = code;
    this.hostId = hostId;
    this.players = new Map(); // socketId -> { id, name, score, connected }
    this.settings = { ...DEFAULT_SETTINGS };
    this.phase = PHASE.LOBBY;
    this.round = 0;
    this.usedTemplateIds = new Set();
    this.currentTemplate = null; // classic mode only
    this.submissions = new Map(); // socketId -> { imageUrl, authorName }
    this.votes = new Map(); // voterId -> targetId
    this.lastRoundResults = null;
    this.phaseEndsAt = null;
    this.timer = null;
  }

  get playerList() {
    return [...this.players.values()];
  }

  get activePlayers() {
    return this.playerList.filter((p) => p.connected);
  }
}

class GameManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
  }

  createRoom(hostSocketId, hostName, settings) {
    let code;
    do {
      code = makeCode();
    } while (this.rooms.has(code));

    const room = new Room(code, hostSocketId);
    room.settings.mode = settings && settings.mode === 'upload' ? 'upload' : 'classic';
    room.settings.rounds = clampInt(settings && settings.rounds, 3, 10, DEFAULT_SETTINGS.rounds);
    room.settings.captionSeconds = clampInt(settings && settings.captionSeconds, 30, 180, DEFAULT_SETTINGS.captionSeconds);
    room.settings.voteSeconds = clampInt(settings && settings.voteSeconds, 15, 90, DEFAULT_SETTINGS.voteSeconds);
    room.players.set(hostSocketId, { id: hostSocketId, name: hostName.slice(0, 20), score: 0, connected: true });
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code) {
    return this.rooms.get((code || '').toUpperCase());
  }

  joinRoom(code, socketId, name) {
    const room = this.getRoom(code);
    if (!room) return { error: "Cette partie n'existe pas." };
    if (room.phase !== PHASE.LOBBY) return { error: 'La partie a déjà commencé.' };
    if (room.players.size >= 12) return { error: 'La partie est complète (12 joueurs max).' };
    const trimmed = (name || 'Joueur').trim().slice(0, 20) || 'Joueur';
    room.players.set(socketId, { id: socketId, name: trimmed, score: 0, connected: true });
    return { room };
  }

  findRoomBySocket(socketId) {
    for (const room of this.rooms.values()) {
      if (room.players.has(socketId)) return room;
    }
    return null;
  }

  handleDisconnect(socketId) {
    const room = this.findRoomBySocket(socketId);
    if (!room) return null;
    const player = room.players.get(socketId);
    if (player) player.connected = false;

    if (room.hostId === socketId) {
      const next = room.activePlayers[0];
      if (next) room.hostId = next.id;
    }

    if (room.activePlayers.length === 0) {
      this.clearTimer(room);
      this.rooms.delete(room.code);
      return null;
    }

    this.maybeAutoAdvance(room);
    return room;
  }

  clearTimer(room) {
    if (room.timer) {
      clearTimeout(room.timer);
      room.timer = null;
    }
  }

  // ---- Game flow -----------------------------------------------------

  startGame(room) {
    if (room.phase !== PHASE.LOBBY) return;
    if (room.activePlayers.length < 2) return;
    room.playerList.forEach((p) => (p.score = 0));
    room.round = 0;
    room.usedTemplateIds.clear();
    this.startRound(room);
  }

  startRound(room) {
    room.round += 1;
    room.submissions.clear();
    room.votes.clear();
    room.lastRoundResults = null;
    room.phase = PHASE.CAPTION;

    if (room.settings.mode === 'classic') {
      room.currentTemplate = this.pickTemplate(room);
    } else {
      room.currentTemplate = null; // chaque joueur apporte sa propre image
    }

    this.beginTimer(room, room.settings.captionSeconds, () => this.endCaptionPhase(room));
    this.broadcastState(room);
  }

  pickTemplate(room) {
    let pool = TEMPLATES.filter((t) => !room.usedTemplateIds.has(t.id));
    if (pool.length === 0) {
      room.usedTemplateIds.clear();
      pool = TEMPLATES;
    }
    const chosen = pool[Math.floor(Math.random() * pool.length)];
    room.usedTemplateIds.add(chosen.id);
    return chosen;
  }

  submitMeme(room, socketId, imageUrl) {
    if (room.phase !== PHASE.CAPTION) return { error: 'Ce n’est pas le moment de soumettre.' };
    const player = room.players.get(socketId);
    if (!player) return { error: 'Joueur inconnu.' };
    if (typeof imageUrl !== 'string' || !imageUrl.startsWith('data:image/')) {
      return { error: 'Image invalide.' };
    }
    if (imageUrl.length > 6_000_000) {
      return { error: 'Image trop lourde, réessaie avec une photo plus légère.' };
    }
    room.submissions.set(socketId, { imageUrl, authorName: player.name });
    this.maybeAutoAdvance(room);
    return { ok: true };
  }

  maybeAutoAdvance(room) {
    if (room.phase === PHASE.CAPTION) {
      const active = room.activePlayers;
      if (active.length > 0 && active.every((p) => room.submissions.has(p.id))) {
        this.clearTimer(room);
        this.endCaptionPhase(room);
      }
    } else if (room.phase === PHASE.VOTING) {
      const eligible = room.activePlayers.filter((p) => room.submissions.has(p.id));
      if (eligible.length > 0 && eligible.every((p) => room.votes.has(p.id))) {
        this.clearTimer(room);
        this.endVotingPhase(room);
      }
    }
  }

  endCaptionPhase(room) {
    if (room.submissions.size === 0) {
      // Personne n'a rien soumis : on saute directement au bilan (vide) puis manche suivante.
      room.phase = PHASE.REVEAL;
      room.lastRoundResults = { entries: [], leaderboard: this.leaderboard(room), noSubmissions: true };
      this.broadcastState(room);
      this.beginTimer(room, 6, () => this.afterReveal(room));
      return;
    }
    room.phase = PHASE.VOTING;
    this.beginTimer(room, room.settings.voteSeconds, () => this.endVotingPhase(room));
    this.broadcastState(room);
  }

  castVote(room, socketId, targetId) {
    if (room.phase !== PHASE.VOTING) return { error: 'Ce n’est pas le moment de voter.' };
    if (!room.submissions.has(targetId)) return { error: 'Cible de vote invalide.' };
    if (targetId === socketId) return { error: 'Tu ne peux pas voter pour toi-même.' };
    if (!room.players.has(socketId)) return { error: 'Joueur inconnu.' };
    room.votes.set(socketId, targetId);
    this.maybeAutoAdvance(room);
    this.broadcastState(room); // pour mettre a jour le compteur "X/Y ont vote"
    return { ok: true };
  }

  endVotingPhase(room) {
    const tally = new Map(); // targetId -> count
    for (const targetId of room.votes.values()) {
      tally.set(targetId, (tally.get(targetId) || 0) + 1);
    }

    const entries = [...room.submissions.entries()].map(([playerId, sub]) => {
      const votes = tally.get(playerId) || 0;
      const points = votes * 100;
      const player = room.players.get(playerId);
      if (player) player.score += points;
      return {
        playerId,
        name: sub.authorName,
        imageUrl: sub.imageUrl,
        votes,
        points,
      };
    }).sort((a, b) => b.votes - a.votes);

    room.phase = PHASE.REVEAL;
    room.lastRoundResults = { entries, leaderboard: this.leaderboard(room) };
    this.beginTimer(room, 10, () => this.afterReveal(room));
    this.broadcastState(room);
  }

  afterReveal(room) {
    if (room.round >= room.settings.rounds) {
      room.phase = PHASE.GAMEOVER;
      this.broadcastState(room);
      return;
    }
    this.startRound(room);
  }

  leaderboard(room) {
    return room.playerList
      .map((p) => ({ id: p.id, name: p.name, score: p.score, connected: p.connected }))
      .sort((a, b) => b.score - a.score);
  }

  backToLobby(room) {
    this.clearTimer(room);
    room.phase = PHASE.LOBBY;
    room.round = 0;
    room.submissions.clear();
    room.votes.clear();
    room.lastRoundResults = null;
    room.currentTemplate = null;
    room.playerList.forEach((p) => (p.score = 0));
    this.broadcastState(room);
  }

  beginTimer(room, seconds, callback) {
    this.clearTimer(room);
    room.phaseEndsAt = Date.now() + seconds * 1000;
    room.timer = setTimeout(() => {
      room.timer = null;
      callback();
    }, seconds * 1000);
  }

  // ---- Broadcast -------------------------------------------------------

  serializeFor(room, socketId) {
    const base = {
      code: room.code,
      phase: room.phase,
      round: room.round,
      totalRounds: room.settings.rounds,
      settings: room.settings,
      hostId: room.hostId,
      isHost: room.hostId === socketId,
      players: room.playerList.map((p) => ({ id: p.id, name: p.name, score: p.score, connected: p.connected })),
      phaseEndsAt: room.phaseEndsAt,
      serverNow: Date.now(),
    };

    if (room.phase === PHASE.CAPTION) {
      base.template = room.currentTemplate; // null en mode upload
      base.youSubmitted = room.submissions.has(socketId);
      base.submittedCount = room.submissions.size;
      base.activeCount = room.activePlayers.length;
    }

    if (room.phase === PHASE.VOTING) {
      const entries = [...room.submissions.entries()]
        .filter(([playerId]) => playerId !== socketId) // on ne vote pas pour soi
        .map(([playerId, sub]) => ({ playerId, imageUrl: sub.imageUrl }));
      // Ordre stable mais mélangé une fois par joueur (seed = socketId) -> simple shuffle random ici.
      base.gallery = shuffle(entries);
      base.hasVoted = room.votes.has(socketId);
      base.votedCount = room.votes.size;
      base.eligibleCount = room.activePlayers.filter((p) => room.submissions.has(p.id)).length;
      base.canVote = room.submissions.has(socketId) || room.activePlayers.length > 0;
    }

    if (room.phase === PHASE.REVEAL) {
      base.results = room.lastRoundResults;
    }

    if (room.phase === PHASE.GAMEOVER) {
      base.finalLeaderboard = this.leaderboard(room);
    }

    return base;
  }

  broadcastState(room) {
    for (const player of room.players.values()) {
      this.io.to(player.id).emit('room:state', this.serializeFor(room, player.id));
    }
  }
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = { GameManager, PHASE };
