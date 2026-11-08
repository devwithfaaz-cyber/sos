import { describe, expect, it } from 'vitest';
import { chooseAiMove, createBoard, DEFAULT_RULES, findSequences, isGameOver, scoreMove, type Board, type Rules } from './game';

function boardOf(rows: string[]): Board {
  return rows.map(row => [...row].map(letter => letter === '.' ? null : letter as 'S' | 'O'));
}

describe('SOS sequence detection', () => {
  it('detects horizontal, vertical, and both diagonal directions', () => {
    expect(findSequences(boardOf(['SOS', '...', '...']))).toHaveLength(1);
    expect(findSequences(boardOf(['S..', 'O..', 'S..']))).toHaveLength(1);
    expect(findSequences(boardOf(['S..', '.O.', '..S']))).toHaveLength(1);
    expect(findSequences(boardOf(['..S', '.O.', 'S..']))).toHaveLength(1);
  });

  it('respects disabled directions', () => {
    const rules: Rules = { ...DEFAULT_RULES, directions: { ...DEFAULT_RULES.directions, diagonal: false } };
    expect(findSequences(boardOf(['S..', '.O.', '..S']), undefined, rules)).toHaveLength(0);
    expect(findSequences(boardOf(['SOS', '...', '...']), undefined, rules)).toHaveLength(1);
  });

  it('counts multiple intersecting sequences only once each', () => {
    const board = boardOf(['.S.', 'SOS', '.S.']);
    expect(findSequences(board)).toHaveLength(2);
    expect(findSequences(board, { row: 1, col: 1 })).toHaveLength(2);
  });

  it('detects all sequences created by one move', () => {
    const board = boardOf(['.S.', 'S.S', '.S.']);
    const result = scoreMove(board, { row: 1, col: 1 }, 'O', DEFAULT_RULES);
    expect(result.sequences).toHaveLength(2);
    expect(result.board[1][1]).toBe('O');
  });

  it('creates boards within the supported range and rejects invalid sizes', () => {
    expect(createBoard(10)).toHaveLength(10);
    expect(createBoard(10)[0]).toHaveLength(10);
    expect(() => createBoard(2)).toThrow(RangeError);
  });

  it('chooses a scoring move when one is available', () => {
    const board = boardOf(['SO.', '...', '...']);
    const move = chooseAiMove(board, DEFAULT_RULES, 5, 'Tactical', [], 17);
    expect(move.at).toEqual({ row: 0, col: 2 });
    expect(move.letter).toBe('S');
  });

  it('ends a match on a full board or configured winning score', () => {
    expect(isGameOver(boardOf(['SOS', 'SOS', 'SOS']), [0, 0], DEFAULT_RULES)).toBe(true);
    expect(isGameOver(boardOf(['...', '...', '...']), [2, 0], { ...DEFAULT_RULES, winningScore: 2 })).toBe(true);
    expect(isGameOver(boardOf(['...', '...', '...']), [1, 0], { ...DEFAULT_RULES, winningScore: 2 })).toBe(false);
  });
});
