const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { GameManager } = require('./gameManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 6 * 1024 * 1024, // images (dataURL) compressees cote client, marge de securite
});

app.use(express.static(path.join(__dirname, '..', 'public')));

const games = new GameManager(io);

function ackOk(ack, data) {
  if (typeof ack === 'function') ack({ ok: true, ...data });
}
function ackErr(ack, error) {
  if (typeof ack === 'function') ack({ ok: false, error });
}

io.on('connection', (socket) => {
  socket.on('room:create', ({ name, settings } = {}, ack) => {
    const cleanName = (name || '').trim();
    if (!cleanName) return ackErr(ack, 'Choisis un pseudo.');
    const room = games.createRoom(socket.id, cleanName, settings || {});
    socket.join(room.code);
    ackOk(ack, { code: room.code });
    games.broadcastState(room);
  });

  socket.on('room:join', ({ code, name } = {}, ack) => {
    const cleanName = (name || '').trim();
    if (!cleanName) return ackErr(ack, 'Choisis un pseudo.');
    if (!code) return ackErr(ack, 'Code de partie manquant.');
    const result = games.joinRoom(code, socket.id, cleanName);
    if (result.error) return ackErr(ack, result.error);
    socket.join(result.room.code);
    ackOk(ack, { code: result.room.code });
    games.broadcastState(result.room);
  });

  socket.on('room:start', (_payload, ack) => {
    const room = games.findRoomBySocket(socket.id);
    if (!room) return ackErr(ack, 'Partie introuvable.');
    if (room.hostId !== socket.id) return ackErr(ack, "Seul l'hôte peut lancer la partie.");
    if (room.activePlayers.length < 2) return ackErr(ack, 'Il faut au moins 2 joueurs.');
    games.startGame(room);
    ackOk(ack, {});
  });

  socket.on('submission:submit', ({ imageUrl } = {}, ack) => {
    const room = games.findRoomBySocket(socket.id);
    if (!room) return ackErr(ack, 'Partie introuvable.');
    const result = games.submitMeme(room, socket.id, imageUrl);
    if (result.error) return ackErr(ack, result.error);
    ackOk(ack, {});
    games.broadcastState(room);
  });

  socket.on('vote:cast', ({ targetId } = {}, ack) => {
    const room = games.findRoomBySocket(socket.id);
    if (!room) return ackErr(ack, 'Partie introuvable.');
    const result = games.castVote(room, socket.id, targetId);
    if (result.error) return ackErr(ack, result.error);
    ackOk(ack, {});
  });

  socket.on('room:playAgain', (_payload, ack) => {
    const room = games.findRoomBySocket(socket.id);
    if (!room) return ackErr(ack, 'Partie introuvable.');
    if (room.hostId !== socket.id) return ackErr(ack, "Seul l'hôte peut relancer.");
    games.backToLobby(room);
    ackOk(ack, {});
  });

  socket.on('disconnect', () => {
    games.handleDisconnect(socket.id);
    const room = games.findRoomBySocket(socket.id);
    if (room) games.broadcastState(room);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Make it Meme (modded) écoute sur http://localhost:${PORT}`);
});
