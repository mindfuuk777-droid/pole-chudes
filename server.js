const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// 🔐 ПАРОЛЬ ДЛЯ ВХОДА (измените на свой)
const GAME_PASSWORD = '1234';

const CHAIR_COLORS = ['#ff4500', '#1e90ff', '#32cd32', '#ff69b4'];
const wordsWithHints = [
  { word: "КОЛЕСО", hint: "То, на чём ездят машины" },
  { word: "ТЕЛЕВИЗОР", hint: "Ящик для просмотра передач" },
  { word: "ВЕДУЩИЙ", hint: "Человек, который проводит шоу" },
  { word: "ПРИЗ", hint: "Награда победителю" },
  { word: "СТУДИЯ", hint: "Место, где снимают передачи" },
  { word: "ЯКУБОВИЧ", hint: "Легендарный ведущий Поля Чудес" },
  { word: "БАРАБАН", hint: "Музыкальный инструмент, который крутится" },
  { word: "МОСКВА", hint: "Столица России" },
  { word: "ПУШКИН", hint: "Великий русский поэт" },
  { word: "САМОВАР", hint: "Прибор для кипячения воды на Руси" },
  { word: "МАТРЁШКА", hint: "Деревянная кукла, в которой прячутся другие" },
  { word: "КОСМОНАВТ", hint: "Человек, летающий в космос" }
];

const sectors = [
  {label:"100", value:100, color:"#ff4500"}, {label:"200", value:200, color:"#ffa500"},
  {label:"300", value:300, color:"#ffd700"}, {label:"500", value:500, color:"#32cd32"},
  {label:"800", value:800, color:"#1e90ff"}, {label:"1000", value:1000, color:"#8a2be2"},
  {label:"БАНКРОТ", value:-1, color:"#000"}, {label:"0", value:0, color:"#555"},
  {label:"200", value:200, color:"#ff69b4"}, {label:"500", value:500, color:"#00ced1"}
];

let gameState = {
  players: [], hostId: null, currentWord: "", currentHint: "",
  guessedLetters: [], wrongLetters: [], currentPlayerIndex: 0,
  currentSectorValue: 0, isSpinning: false, wordIndex: 0, gameStarted: false
};

function getNextPlayer() {
  gameState.currentPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.players.length;
}

function loadNewWord() {
  const entry = wordsWithHints[gameState.wordIndex % wordsWithHints.length];
  gameState.currentWord = entry.word;
  gameState.currentHint = entry.hint;
  gameState.wordIndex++;
  gameState.guessedLetters = [];
  gameState.wrongLetters = [];
}

io.on('connection', (socket) => {
  socket.emit('game_state', gameState);

  socket.on('join_game', (data) => {
    const name = data.name;
    const password = data.password;
    
    if (password !== GAME_PASSWORD) {
      return socket.emit('error_msg', 'Неверный пароль!');
    }
    
    if (gameState.players.length >= 4) return socket.emit('error_msg', 'Комната заполнена (макс. 4)');
    if (gameState.gameStarted) return socket.emit('error_msg', 'Игра уже началась');
    
    const color = CHAIR_COLORS[gameState.players.length];
    gameState.players.push({ id: socket.id, name: name || 'Игрок', color, score: 0 });
    if (gameState.players.length === 1) gameState.hostId = socket.id;
    io.emit('game_state', gameState);
  });

  socket.on('start_game', () => {
    if (socket.id !== gameState.hostId || gameState.players.length < 2) return;
    gameState.gameStarted = true;
    loadNewWord();
    io.emit('game_state', gameState);
    io.emit('speak', `Добрый вечер! Начинаем игру! Тема: ${gameState.currentHint}.`);
  });

  socket.on('spin_wheel', () => {
    if (!gameState.gameStarted || gameState.isSpinning) return;
    const player = gameState.players[gameState.currentPlayerIndex];
    if (socket.id !== player.id) return;
    gameState.isSpinning = true;
    io.emit('game_state', gameState);
    const spinAmount = 1440 + Math.random() * 1080;
    setTimeout(() => {
      gameState.isSpinning = false;
      const norm = spinAmount % 360;
      const pa = (360 - (norm % 360)) % 360;
      const idx = Math.floor(pa / (360 / sectors.length)) % sectors.length;
      const sector = sectors[idx];
      gameState.currentSectorValue = sector.value;
      gameState.targetRotation = spinAmount;
      io.emit('game_state', gameState);
      if (sector.value === -1) {
        player.score = 0;
        io.emit('speak', "Ох, банкрот!");
        setTimeout(() => { getNextPlayer(); io.emit('game_state', gameState); }, 2500);
      } else if (sector.value === 0) {
        io.emit('speak', "Ноль. Переход хода.");
        setTimeout(() => { getNextPlayer(); io.emit('game_state', gameState); }, 2000);
      } else {
        io.emit('speak', `Сектор ${sector.value}. Назовите букву.`);
      }
    }, 4000);
  });

  socket.on('guess_letter', (letter) => {
    if (!gameState.gameStarted || gameState.isSpinning) return;
    const player = gameState.players[gameState.currentPlayerIndex];
    if (socket.id !== player.id) return;
    letter = letter.toUpperCase();
    if (!/^[А-ЯЁ]$/.test(letter) || gameState.guessedLetters.includes(letter) || gameState.wrongLetters.includes(letter)) return;
    if (gameState.currentWord.includes(letter)) {
      gameState.guessedLetters.push(letter);
      const count = gameState.currentWord.split('').filter(c => c === letter).length;
      player.score += gameState.currentSectorValue * count;
      io.emit('speak', `Есть такая буква! ${gameState.currentSectorValue * count} очков.`);
      io.emit('game_state', gameState);
      if (gameState.currentWord.split('').every(c => gameState.guessedLetters.includes(c))) {
        player.score += 1000;
        io.emit('speak', `Поздравляю! ${player.name} угадал слово!`);
        setTimeout(() => { loadNewWord(); gameState.currentPlayerIndex = 0; io.emit('game_state', gameState); }, 4000);
      }
    } else {
      gameState.wrongLetters.push(letter);
      io.emit('speak', "К сожалению, такой буквы нет.");
      io.emit('game_state', gameState);
      setTimeout(() => { getNextPlayer(); io.emit('game_state', gameState); }, 1500);
    }
  });

  socket.on('guess_word', (word) => {
    if (!gameState.gameStarted || gameState.isSpinning) return;
    const player = gameState.players[gameState.currentPlayerIndex];
    if (socket.id !== player.id) return;
    if (word.toUpperCase() === gameState.currentWord) {
      player.score += gameState.currentSectorValue * 10;
      io.emit('speak', "Абсолютно верно!");
      io.emit('game_state', gameState);
      setTimeout(() => { loadNewWord(); gameState.currentPlayerIndex = 0; io.emit('game_state', gameState); }, 3000);
    } else {
      player.score = Math.max(0, player.score - 1000);
      io.emit('speak', "Неверно.");
      io.emit('game_state', gameState);
      setTimeout(() => { getNextPlayer(); io.emit('game_state', gameState); }, 2000);
    }
  });

  socket.on('disconnect', () => {
    gameState.players = gameState.players.filter(p => p.id !== socket.id);
    if (gameState.players.length === 0) { gameState.gameStarted = false; gameState.hostId = null; }
    else if (socket.id === gameState.hostId) { gameState.hostId = gameState.players[0].id; }
    io.emit('game_state', gameState);
  });
});

server.listen(process.env.PORT || 3000, () => console.log(`Server running on port 3000`));