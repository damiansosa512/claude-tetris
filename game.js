'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#7986cb', // J - indigo
  '#ffb74d', // L - orange
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const scoreEntry = document.getElementById('score-entry');
const nameInput = document.getElementById('name-input');
const saveScoreBtn = document.getElementById('save-score-btn');
const recordsSection = document.getElementById('records-section');
const recordsList = document.getElementById('records-list');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;

// ---------------------------------------------------------------------
// PLACEHOLDER STORAGE LAYER (Unit 8)
// loadRecords()/saveRecord()/wouldMakeTop5() below are a local
// localStorage-backed stub matching the contract Unit 6 is building in an
// isolated worktree:
//   loadRecords() -> array of { name, score, lines, level, date }, sorted
//     desc by score, max 5 entries.
//   saveRecord({ name, score, lines, level }) -> { records, rank } where
//     rank is the 0-based index in the top-5 if it made the cut, else -1.
// TODO: delete this whole guarded block and rely on Unit 6's real
// implementation once that PR merges (same function names/signatures, so
// this is a drop-in replacement).
//
// Everything here is declared with `var`/`typeof` guards rather than
// `const`/`function` at bare top level: if this file is merged with Unit
// 6's storage module (which will very likely declare the same
// loadRecords/saveRecord names), two top-level `const` declarations of the
// same name would be a hard `SyntaxError: Identifier has already been
// declared`. `var` can coexist with another `var` or `function`
// declaration of the same name, so the merge stays parseable; the
// `typeof loadRecords === 'undefined'` guard also means that if Unit 6's
// real functions are already defined by the time this runs, this
// placeholder is skipped entirely instead of clobbering them.
// ---------------------------------------------------------------------
if (typeof loadRecords === 'undefined') {
  var RECORDS_KEY = 'tetris-high-scores';
  var MAX_RECORDS = 5;

  var byScoreDesc = function byScoreDesc(a, b) { return b.score - a.score; };

  var loadRecords = function loadRecords() {
    let records;
    try {
      records = JSON.parse(localStorage.getItem(RECORDS_KEY)) || [];
    } catch (e) {
      records = [];
    }
    if (!Array.isArray(records)) records = [];
    return records.slice().sort(byScoreDesc).slice(0, MAX_RECORDS);
  };

  var saveRecord = function saveRecord({ name, score, lines, level }) {
    const records = loadRecords();
    const entry = { name, score, lines, level, date: new Date().toISOString() };
    records.push(entry);
    records.sort(byScoreDesc);
    const trimmed = records.slice(0, MAX_RECORDS);
    const rank = trimmed.indexOf(entry);
    try {
      localStorage.setItem(RECORDS_KEY, JSON.stringify(trimmed));
    } catch (e) {
      // ignore storage errors (quota exceeded, private mode, etc.)
    }
    return { records: trimmed, rank };
  };

  // Reuses the exact `byScoreDesc` comparator (and the same push+sort+trim
  // shape) that saveRecord uses, instead of re-deriving the qualification
  // rule independently, so the two can never silently disagree.
  var wouldMakeTop5 = function wouldMakeTop5(candidateScore, records) {
    const sentinel = { score: candidateScore };
    const merged = records.concat([sentinel]).sort(byScoreDesc).slice(0, MAX_RECORDS);
    return merged.indexOf(sentinel) !== -1;
  };
}

function renderRecords(records, highlightRank) {
  while (recordsList.firstChild) recordsList.removeChild(recordsList.firstChild);
  records.forEach((rec, i) => {
    const li = document.createElement('li');
    li.className = 'record-row' + (i === highlightRank ? ' highlight' : '');

    const rank = document.createElement('span');
    rank.className = 'record-rank';
    rank.textContent = `#${i + 1}`;

    const name = document.createElement('span');
    name.className = 'record-name';
    name.textContent = rec.name;

    const scoreSpan = document.createElement('span');
    scoreSpan.className = 'record-score';
    scoreSpan.textContent = rec.score.toLocaleString();

    li.appendChild(rank);
    li.appendChild(name);
    li.appendChild(scoreSpan);
    recordsList.appendChild(li);
  });
}

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = '#22222e';
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;

  const records = loadRecords();
  const qualifies = wouldMakeTop5(score, records);

  if (qualifies) {
    scoreEntry.classList.remove('hidden');
    nameInput.value = '';
    nameInput.disabled = false;
    saveScoreBtn.disabled = false;
  } else {
    scoreEntry.classList.add('hidden');
  }

  recordsSection.classList.remove('hidden');
  renderRecords(records, -1);

  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    scoreEntry.classList.add('hidden');
    recordsSection.classList.add('hidden');
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  scoreEntry.classList.add('hidden');
  recordsSection.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

saveScoreBtn.addEventListener('click', () => {
  if (!gameOver) return;
  const name = nameInput.value.trim() || 'AAA';
  const { records, rank } = saveRecord({ name, score, lines, level });
  renderRecords(records, rank);
  scoreEntry.classList.add('hidden');
  saveScoreBtn.disabled = true;
  nameInput.disabled = true;
});

init();
