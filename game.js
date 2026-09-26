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

const RECORDS_KEY = 'tetris-records';
const BEST_COMBO_KEY = 'tetris-best-combo';
const MAX_LINES_KEY = 'tetris-max-lines';
const MAX_RECORDS = 5;

function loadRecords() {
  try {
    const raw = localStorage.getItem(RECORDS_KEY);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRecord({ name, score, lines, level }) {
  const records = loadRecords();
  const entry = { name, score, lines, level, date: new Date().toISOString() };
  records.push(entry);
  records.sort((a, b) => b.score - a.score);
  const truncated = records.slice(0, MAX_RECORDS);
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(truncated));
  } catch {
    // ignore write errors (quota/unavailable storage)
  }
  const rank = truncated.indexOf(entry);
  return { records: truncated, rank };
}

function resetRecords() {
  try {
    localStorage.removeItem(RECORDS_KEY);
    localStorage.removeItem(BEST_COMBO_KEY);
    localStorage.removeItem(MAX_LINES_KEY);
  } catch {
    // ignore unavailable storage
  }
}

function getBestStats() {
  let bestCombo = 0;
  let maxLines = 0;
  try {
    const combo = parseInt(localStorage.getItem(BEST_COMBO_KEY), 10);
    if (Number.isFinite(combo)) bestCombo = combo;
  } catch {
    bestCombo = 0;
  }
  try {
    const maxL = parseInt(localStorage.getItem(MAX_LINES_KEY), 10);
    if (Number.isFinite(maxL)) maxLines = maxL;
  } catch {
    maxLines = 0;
  }
  return { bestCombo, maxLines };
}

function updateBestStats({ combo, lines }) {
  try {
    const current = getBestStats();
    const nextCombo = Math.max(current.bestCombo, combo || 0);
    const nextMaxLines = Math.max(current.maxLines, lines || 0);
    localStorage.setItem(BEST_COMBO_KEY, String(nextCombo));
    localStorage.setItem(MAX_LINES_KEY, String(nextMaxLines));
  } catch {
    // ignore write errors (quota/unavailable storage)
  }
}

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
const resumeBtn = document.getElementById('resume-btn');
const menuButtons = document.getElementById('menu-buttons');
const controlsBtn = document.getElementById('controls-btn');
const controlsPanel = document.getElementById('controls-panel');
const controlsPanelList = document.getElementById('controls-panel-list');
const backBtn = document.getElementById('back-btn');
// Single source of truth for key-binding text: the side panel's own controls list.
const sidePanelControlsList = document.querySelector('.panel-section.controls ul');
const startLevelEl = document.getElementById('start-level');

const START_LEVEL_KEY = 'tetris-start-level';
const MIN_START_LEVEL = 1;
const MAX_START_LEVEL = 20;

let board, current, next, score, lines, level, paused, gameOver, menuOpen, menuView, lastTime, dropAccum, dropInterval, animId, startLevel;

function clampStartLevel(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return MIN_START_LEVEL;
  return Math.min(MAX_START_LEVEL, Math.max(MIN_START_LEVEL, n));
}

function loadStartLevel() {
  let raw = null;
  try {
    raw = localStorage.getItem(START_LEVEL_KEY);
  } catch (e) {
    raw = null;
  }
  return clampStartLevel(raw);
}

function saveStartLevel(value) {
  try {
    localStorage.setItem(START_LEVEL_KEY, String(value));
  } catch (e) {
    // ignore storage failures (e.g. private mode / quota)
  }
}

function syncStartLevelUI() {
  if (startLevelEl) startLevelEl.value = startLevel;
}

let comboCount = 0;
let bestComboThisGame = 0;
let maxLinesThisGame = 0;

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
    level = startLevel + Math.floor(lines / 10);
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    comboCount++;
    bestComboThisGame = Math.max(bestComboThisGame, comboCount);
    maxLinesThisGame = Math.max(maxLinesThisGame, cleared);
    updateHUD();
  } else {
    comboCount = 0;
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

function populateControlsPanel() {
  if (!controlsPanelList || !sidePanelControlsList) return;
  controlsPanelList.innerHTML = sidePanelControlsList.innerHTML;
}

function showControls() {
  populateControlsPanel();
  if (menuButtons) menuButtons.classList.add('hidden');
  if (controlsPanel) controlsPanel.classList.remove('hidden');
}

function hideControls() {
  if (controlsPanel) controlsPanel.classList.add('hidden');
  if (menuButtons) menuButtons.classList.remove('hidden');
}

function endGame() {
  gameOver = true;
  updateBestStats({ combo: bestComboThisGame, lines: maxLinesThisGame });
  cancelAnimationFrame(animId);
  hideControls();
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

// State machine for the pause/menu overlay. `menuOpen` tracks whether the
// menu is visible; `paused` mirrors it so the game loop stays stopped while
// the menu is open. `menuView` tracks which panel of the menu is showing
// ('main' or 'controls') for sibling units that wire up real menu buttons.
function toggleMenu() {
  if (gameOver) return;
  menuOpen = !menuOpen;
  paused = menuOpen;
  if (menuOpen) {
    menuView = 'main';
    cancelAnimationFrame(animId);
    hideControls();
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  } else {
    hideControls();
    overlay.classList.add('hidden');
    lastTime = performance.now();
    loop(lastTime);
  }
}

// Kept as an alias so any existing callers (or sibling units wiring up
// buttons) that still invoke togglePause() keep working unchanged.
function togglePause() {
  toggleMenu();
}

// Resumes explicitly (used by the "Reanudar" button); only acts if the menu
// is actually open, since toggleMenu() would otherwise re-open a closed menu.
function resumeGame() {
  if (menuOpen) toggleMenu();
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
  // Fold any in-progress game's combo/line stats into the all-time bests
  // before resetting — covers restarting from the pause overlay, which
  // (unlike a natural game over) skips endGame()'s own updateBestStats() call.
  if (!gameOver) updateBestStats({ combo: bestComboThisGame, lines: maxLinesThisGame });
  board = createBoard();
  score = 0;
  lines = 0;
  startLevel = loadStartLevel();
  level = startLevel;
  paused = false;
  gameOver = false;
  menuOpen = false;
  menuView = 'main';
  dropInterval = Math.max(100, 1000 - (startLevel - 1) * 90);
  dropAccum = 0;
  comboCount = 0;
  bestComboThisGame = 0;
  maxLinesThisGame = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  hideControls();
  syncStartLevelUI();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

const MENU_BLOCKED_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyX'];

document.addEventListener('keydown', e => {
  if (document.activeElement === startLevelEl) return;
  if (e.code === 'KeyP' || e.code === 'Escape') {
    if (e.repeat) return;
    toggleMenu();
    return;
  }
  if (menuOpen) {
    if (MENU_BLOCKED_KEYS.includes(e.code)) e.preventDefault();
    return;
  }
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
resumeBtn.addEventListener('click', resumeGame);
controlsBtn.addEventListener('click', showControls);
backBtn.addEventListener('click', hideControls);

if (startLevelEl) {
  // Only persist the preference here — do NOT reassign the live `startLevel`
  // used by clearLines()/dropInterval. The overlay is shared between PAUSE
  // and GAME OVER, so editing this while merely paused must not corrupt an
  // in-progress game's difficulty. `init()` is the sole place that reads the
  // persisted value back into the live `startLevel`.
  startLevelEl.addEventListener('change', () => {
    const clamped = clampStartLevel(startLevelEl.value);
    saveStartLevel(clamped);
    startLevelEl.value = clamped;
  });
}

init();
