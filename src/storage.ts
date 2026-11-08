import type { Board, Rules } from './game';

export type Personality = 'Aggressive' | 'Defensive' | 'Tactical' | 'Adaptive' | 'Unpredictable';
export interface MoveRecord { row: number; col: number; letter: 'S' | 'O'; player: 0 | 1; sequences: number; }
export interface MatchRecord {
  id: string;
  date: string;
  durationMs: number;
  size: number;
  difficulty: number;
  personality: Personality;
  scores: [number, number];
  sequences: [number, number];
  result: 'win' | 'loss' | 'draw';
  moves: MoveRecord[];
  board: Board;
  rules: Rules;
  challengeSeed?: string;
  challengeTarget?: number;
  challengeCompleted?: boolean;
}
export interface Preferences {
  size: number;
  difficulty: number;
  personality: Personality;
  theme: string;
  customAccent: string;
  cellStyle: string;
  letterStyle: string;
  animation: string;
  sound: boolean;
  soundVolume: number;
  dialogue: boolean;
  playerName: string;
  rules: Rules;
}
export const DEFAULT_PREFERENCES: Preferences = {
  size: 5, difficulty: 3, personality: 'Tactical', theme: 'Midnight Dark',
  customAccent: '#76a7ff', cellStyle: 'Rounded', letterStyle: 'Modern', animation: 'Smooth',
  sound: false, soundVolume: 45, dialogue: true, playerName: 'Player',
  rules: { directions: { horizontal: true, vertical: true, diagonal: true }, extraTurn: true, winningScore: null },
};

const DB_NAME = 'sos-mind-arena';
const STORE = 'matches';
let connection: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB is unavailable in this browser.'));
  if (!connection) connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open match storage.'));
  });
  return connection;
}

export async function getMatches(): Promise<MatchRecord[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    request.onsuccess = () => resolve((request.result as MatchRecord[]).sort((a, b) => b.date.localeCompare(a.date)));
    request.onerror = () => reject(request.error ?? new Error('Could not read match history.'));
  });
}

export async function saveMatch(match: MatchRecord): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).add(match);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Could not save this match.'));
  });
}

export async function clearMatches(): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Could not clear match history.'));
  });
}

export function loadPreferences(): Preferences {
  try {
    const saved = localStorage.getItem('sos-preferences');
    if (!saved) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(saved) as Partial<Preferences>;
    return {
      ...DEFAULT_PREFERENCES,
      ...parsed,
      rules: {
        ...DEFAULT_PREFERENCES.rules,
        ...parsed.rules,
        directions: { ...DEFAULT_PREFERENCES.rules.directions, ...parsed.rules?.directions },
      },
    };
  } catch (error) {
    console.warn('Could not load preferences:', error);
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(preferences: Preferences): void {
  try { localStorage.setItem('sos-preferences', JSON.stringify(preferences)); }
  catch (error) { console.error('Could not save preferences:', error); }
}
