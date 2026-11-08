export type Letter = 'S' | 'O' | null;
export type Board = Letter[][];
export type Direction = 'horizontal' | 'vertical' | 'diagonal';
export type Coordinate = { row: number; col: number };
export type Sequence = Coordinate[];

export interface Rules {
  directions: Record<Direction, boolean>;
  extraTurn: boolean;
  winningScore: number | null;
}

export const DEFAULT_RULES: Rules = {
  directions: { horizontal: true, vertical: true, diagonal: true },
  extraTurn: true,
  winningScore: null,
};

const VECTORS: Record<Direction, [number, number][]> = {
  horizontal: [[0, 1]],
  vertical: [[1, 0]],
  diagonal: [[1, 1], [1, -1]],
};

export function createBoard(size: number): Board {
  if (!Number.isInteger(size) || size < 3 || size > 10) throw new RangeError('Board size must be from 3 to 10.');
  return Array.from({ length: size }, () => Array<Letter>(size).fill(null));
}

export function findSequences(board: Board, at?: Coordinate, rules: Rules = DEFAULT_RULES): Sequence[] {
  const found: Sequence[] = [];
  const size = board.length;
  if (!size) return found;
  for (const [direction, enabled] of Object.entries(rules.directions) as [Direction, boolean][]) {
    if (!enabled) continue;
    for (const [dr, dc] of VECTORS[direction]) {
      for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
        const endRow = row + 2 * dr;
        const endCol = col + 2 * dc;
        if (endRow < 0 || endCol < 0 || endRow >= size || endCol >= size) continue;
        const sequence: Sequence = [{ row, col }, { row: row + dr, col: col + dc }, { row: endRow, col: endCol }];
        if (at && !sequence.some(cell => cell.row === at.row && cell.col === at.col)) continue;
        if (board[row][col] === 'S' && board[row + dr][col + dc] === 'O' && board[endRow][endCol] === 'S') found.push(sequence);
      }
    }
  }
  return found;
}

export function placeLetter(board: Board, at: Coordinate, letter: Exclude<Letter, null>): Board {
  const current = board[at.row]?.[at.col];
  if (current !== null) throw new Error('That cell is already occupied.');
  return board.map((row, r) => row.map((cell, c) => r === at.row && c === at.col ? letter : cell));
}

export function getLegalMoves(board: Board): Coordinate[] {
  return board.flatMap((row, r) => row.flatMap((cell, c) => cell === null ? [{ row: r, col: c }] : []));
}

export function scoreMove(board: Board, at: Coordinate, letter: Exclude<Letter, null>, rules: Rules): { board: Board; sequences: Sequence[] } {
  const nextBoard = placeLetter(board, at, letter);
  return { board: nextBoard, sequences: findSequences(nextBoard, at, rules) };
}

export function isGameOver(board: Board, scores: [number, number], rules: Rules): boolean {
  return getLegalMoves(board).length === 0 || (rules.winningScore !== null && Math.max(...scores) >= rules.winningScore);
}

export function chooseAiMove(
  board: Board,
  rules: Rules,
  difficulty: number,
  personality: string,
  history: { row: number; col: number; player: 0 | 1; letter: 'S' | 'O' }[] = [],
  seed = Date.now(),
): { at: Coordinate; letter: 'S' | 'O'; explanation: string } {
  const moves = getLegalMoves(board);
  if (!moves.length) throw new Error('No legal moves remain.');
  const size = board.length;
  const depth = difficulty >= 5 ? (size <= 3 ? 4 : size <= 5 ? 3 : 2) : difficulty >= 4 ? (size <= 4 ? 3 : size <= 6 ? 2 : 1) : 1;
  const letterCounts = { S: 0, O: 0 };
  for (const move of history) if (move.player === 0) letterCounts[move.letter]++;
  const candidates = moves.flatMap(at => (['S', 'O'] as const).map(letter => {
    const { board: next, sequences } = scoreMove(board, at, letter, rules);
    const tactical = evaluateBoard(next, rules);
    const immediate = sequences.length * 120;
    const block = potentialScore(board, at, letter === 'S' ? 'O' : 'S', rules) * 22;
    const positional = centerValue(at, size) * (personality === 'Aggressive' ? 0.6 : 0.25);
    const defensive = personality === 'Defensive' ? block * 1.5 : block;
    const adaptive = personality === 'Adaptive' && history.length
      ? (letterCounts[letter] < letterCounts[letter === 'S' ? 'O' : 'S'] ? 9 : 0) +
        (history.filter(move => move.player === 0).some(move => Math.abs(move.row - at.row) + Math.abs(move.col - at.col) <= 1) ? 3 : 0)
      : 0;
    return { at, letter, score: immediate + tactical + defensive + positional + adaptive, sequences, next };
  })).sort((a, b) => b.score - a.score);

  const beamWidth = difficulty >= 4 ? 8 : 6;
  const random = seededRandom(seed);
  const scoringCandidates = candidates.filter(move => move.sequences.length > 0);
  const rootCandidates = scoringCandidates.length ? scoringCandidates : candidates;
  const searched = rootCandidates.slice(0, beamWidth).map(move => ({
    ...move,
    score: move.score + (difficulty >= 3
      ? searchPosition(move.next, rules, depth - 1, sequencesContinueTurn(move.sequences.length, rules), -Infinity, Infinity)
      : 0) + (personality === 'Unpredictable' ? random() * 8 : 0),
  })).sort((a, b) => b.score - a.score);
  const best = searched[0];
  const mistakeChance = difficulty === 1 ? 0.22 : difficulty === 2 ? 0.08 : 0;
  const selected = random() < mistakeChance ? searched[Math.min(searched.length - 1, 1 + Math.floor(random() * Math.min(3, searched.length - 1)))] : best;
  let explanation = selected.sequences.length ? `I found ${selected.sequences.length} scoring ${selected.sequences.length === 1 ? 'sequence' : 'sequences'}.` : 'I am positioning for the next scoring chance.';
  if (personality === 'Defensive' && !selected.sequences.length) explanation = 'I am closing off a scoring opportunity.';
  if (personality === 'Tactical') explanation = selected.sequences.length ? explanation : 'I am setting up a tactical trap.';
  return { at: selected.at, letter: selected.letter, explanation };
}

function sequencesContinueTurn(count: number, rules: Rules): boolean {
  return count > 0 && rules.extraTurn;
}

function searchPosition(board: Board, rules: Rules, depth: number, aiTurn: boolean, alpha: number, beta: number): number {
  const moves = getLegalMoves(board);
  if (depth <= 0 || moves.length === 0) return evaluateBoard(board, rules) * 8;
  const options = moves.flatMap(at => (['S', 'O'] as const).map(letter => {
    const { board: next, sequences } = scoreMove(board, at, letter, rules);
    return { next, sequences, order: sequences.length * (aiTurn ? 120 : -120) + evaluateBoard(next, rules) };
  })).sort((a, b) => b.order - a.order).slice(0, board.length <= 4 ? 6 : 4);
  let best = aiTurn ? -Infinity : Infinity;
  for (const option of options) {
    const gained = option.sequences.length * 120 * (aiTurn ? 1 : -1);
    const nextAiTurn = sequencesContinueTurn(option.sequences.length, rules) ? aiTurn : !aiTurn;
    const value = gained + searchPosition(option.next, rules, depth - 1, nextAiTurn, alpha, beta);
    best = aiTurn ? Math.max(best, value) : Math.min(best, value);
    if (aiTurn) alpha = Math.max(alpha, best);
    else beta = Math.min(beta, best);
    if (beta <= alpha) break;
  }
  return Number.isFinite(best) ? best : 0;
}

function evaluateBoard(board: Board, rules: Rules): number {
  return potentialScore(board, undefined, undefined, rules);
}

function potentialScore(board: Board, at: Coordinate | undefined, letter: 'S' | 'O' | undefined, rules: Rules): number {
  const candidate = at && letter ? placeLetter(board, at, letter) : board;
  let score = 0;
  for (const sequence of findSequences(candidate, undefined, rules)) score += sequence.length;
  const size = board.length;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    if (candidate[r][c] !== 'O') continue;
    for (const [direction, enabled] of Object.entries(rules.directions) as [Direction, boolean][]) {
      if (!enabled) continue;
      for (const [dr, dc] of VECTORS[direction]) {
        for (const sign of [-1, 1]) {
          const ends = [{ row: r - dr * sign, col: c - dc * sign }, { row: r + dr * sign, col: c + dc * sign }];
          if (ends.every(p => p.row >= 0 && p.col >= 0 && p.row < size && p.col < size && (candidate[p.row][p.col] === 'S' || candidate[p.row][p.col] === null))) {
            const sCount = ends.filter(p => candidate[p.row][p.col] === 'S').length;
            score += sCount === 1 ? 0.4 : 0.8;
          }
        }
      }
    }
  }
  return score;
}

function centerValue(at: Coordinate, size: number): number {
  return 1 - (Math.abs(at.row - (size - 1) / 2) + Math.abs(at.col - (size - 1) / 2)) / size;
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
