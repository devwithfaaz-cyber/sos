import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity, ArrowDownToLine, ArrowRight, Award, BarChart3, Bot, Brain,
  CalendarDays, Check, ChevronDown, CircleHelp, Clock3, Crown, Download, Flame,
  Gamepad2, Grid2X2, History, Home, Menu, Pause, Play, RotateCcw, Settings,
  Shield, Sparkles, Target, Trophy, Undo2, Volume2, X, Zap,
} from 'lucide-react';
import {
  chooseAiMove, createBoard, DEFAULT_RULES, getLegalMoves, isGameOver,
  scoreMove, type Board, type Coordinate, type Rules, type Sequence,
} from './game';
import {
  clearMatches, getMatches, loadPreferences, saveMatch,
  savePreferences, type MatchRecord, type MoveRecord, type Personality, type Preferences,
} from './storage';
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

type Screen = 'home' | 'game' | 'custom' | 'analytics' | 'history' | 'settings' | 'ai-lab' | 'achievements' | 'challenge' | 'how-to' | 'results';
type GameSnapshot = { board: Board; scores: [number, number]; sequences: [number, number]; current: 0 | 1; moves: MoveRecord[] };
type ChallengeConfig = { seed: string; target: number; rules: Rules };
type GameState = GameSnapshot & { startedAt: number; paused: boolean; focus: boolean; status: string; lastSequences: Sequence[]; rules: Rules; difficulty: number; personality: Personality; challenge?: ChallengeConfig };

const AI_NAMES: Record<Personality, string> = {
  Aggressive: 'Vex • The Challenger', Defensive: 'Aegis • The Sentinel',
  Tactical: 'Nyx • The Architect', Adaptive: 'Mira • The Learner',
  Unpredictable: 'Glitch • The Wildcard',
};
const DIFFICULTIES = ['Beginner', 'Casual', 'Strategist', 'Expert', 'Mastermind'];
const THEMES: Record<string, { accent: string; glow: string; surface: string }> = {
  'Midnight Dark': { accent: '#76a7ff', glow: '#795bff', surface: '#111522' },
  'Neon Cyberpunk': { accent: '#27f5d0', glow: '#f54bff', surface: '#10151e' },
  'Minimal White': { accent: '#5276e8', glow: '#9a6aff', surface: '#f3f5fa' },
  'Royal Gold': { accent: '#f5cb6b', glow: '#ed8f57', surface: '#171511' },
  'Ocean Blue': { accent: '#4dd6eb', glow: '#547aff', surface: '#0d1921' },
  Emerald: { accent: '#59d99d', glow: '#32b5a2', surface: '#101b18' },
  Custom: { accent: '#76a7ff', glow: '#795bff', surface: '#111522' },
};
const SIZE_OPTIONS = [3, 4, 5, 6, 7, 8, 10];
const PERSONALITIES: Personality[] = ['Aggressive', 'Defensive', 'Tactical', 'Adaptive', 'Unpredictable'];
const quotes = ['Interesting move.', 'I saw that coming.', "You're getting better.", "Let's see your next move.", 'That was a clever strategy.'];

function freshGame(size: number, difficulty: number, personality: Personality, rules: Rules, challenge?: ChallengeConfig): GameState {
  return {
    board: createBoard(size), scores: [0, 0], sequences: [0, 0], current: 0,
    moves: [], startedAt: Date.now(), paused: false, focus: false,
    status: 'Your move. Choose a cell and place S or O.', lastSequences: [],
    difficulty, personality, rules, challenge,
  };
}

function playGameTone(enabled: boolean, volume: number, scored: boolean, player: 0 | 1) {
  if (!enabled || volume <= 0 || !window.AudioContext) return;
  try {
    const context = new window.AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(scored ? 740 : player === 0 ? 410 : 320, now);
    oscillator.frequency.exponentialRampToValueAtTime(scored ? 980 : 260, now + 0.11);
    gain.gain.setValueAtTime(volume / 100 * 0.055, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.15);
    oscillator.onended = () => { void context.close(); };
  } catch (cause) {
    console.warn('Could not play the move sound:', cause);
  }
}

function matchResult(scores: [number, number]): MatchRecord['result'] {
  return scores[0] === scores[1] ? 'draw' : scores[0] > scores[1] ? 'win' : 'loss';
}

function App() {
  const [preferences, setPreferences] = useState<Preferences>(() => loadPreferences());
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [screen, setScreen] = useState<Screen>('home');
  const [game, setGame] = useState<GameState | null>(null);
  const [selectedLetter, setSelectedLetter] = useState<'S' | 'O'>('S');
  const [undoStack, setUndoStack] = useState<GameSnapshot[]>([]);
  const [error, setError] = useState('');
  const [filterDifficulty, setFilterDifficulty] = useState('All');
  const [filterPersonality, setFilterPersonality] = useState('All');
  const [filterSize, setFilterSize] = useState('All');
  const [dateFilter, setDateFilter] = useState('All time');
  const [search, setSearch] = useState('');
  const [selectedMatch, setSelectedMatch] = useState<MatchRecord | null>(null);
  const [compareMatches, setCompareMatches] = useState<string[]>([]);
  const [customSize, setCustomSize] = useState(5);
  const gameLock = useRef(false);
  const finishLock = useRef(false);
  const gameRef = useRef<GameState | null>(null);
  gameRef.current = game;

  const reloadMatches = useCallback(async () => {
    try { setMatches(await getMatches()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load saved matches.'); }
  }, []);

  useEffect(() => { void reloadMatches(); }, [reloadMatches]);
  useEffect(() => { savePreferences(preferences); }, [preferences]);
  useEffect(() => {
    const theme = THEMES[preferences.theme] ?? THEMES['Midnight Dark'];
    const accent = preferences.theme === 'Custom' ? preferences.customAccent : theme.accent;
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--glow', preferences.theme === 'Custom' ? accent : theme.glow);
    document.documentElement.style.setProperty('--board-surface', theme.surface);
    document.documentElement.dataset.theme = preferences.theme.toLowerCase().replaceAll(' ', '-');
  }, [preferences.theme, preferences.customAccent]);

  const filteredMatches = useMemo(() => {
    const now = Date.now();
    return matches.filter(match => {
      if (filterDifficulty !== 'All' && DIFFICULTIES[match.difficulty - 1] !== filterDifficulty) return false;
      if (filterPersonality !== 'All' && match.personality !== filterPersonality) return false;
      if (filterSize !== 'All' && match.size !== Number(filterSize)) return false;
      const age = now - new Date(match.date).getTime();
      if (dateFilter === 'Last 7 days' && age > 7 * 86400000) return false;
      if (dateFilter === 'Last 30 days' && age > 30 * 86400000) return false;
      if (dateFilter.startsWith('Custom:')) {
        const [start, end] = dateFilter.slice(7).split('|');
        const day = match.date.slice(0, 10);
        if (start && day < start) return false;
        if (end && day > end) return false;
      }
      return true;
    });
  }, [matches, filterDifficulty, filterPersonality, filterSize, dateFilter]);

  const beginGame = useCallback((size = preferences.size, challenge?: ChallengeConfig) => {
    try {
      finishLock.current = false;
      const rules = challenge?.rules ?? preferences.rules;
      setGame(freshGame(size, challenge ? 3 : preferences.difficulty, challenge ? 'Tactical' : preferences.personality, rules, challenge));
      setUndoStack([]);
      setSelectedLetter('S');
      setError('');
      setScreen('game');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not start the match.'); }
  }, [preferences]);
  useEffect(() => {
    const start = () => beginGame();
    window.addEventListener('start-match', start);
    return () => window.removeEventListener('start-match', start);
  }, [beginGame]);

  const finishGame = useCallback(async (finalGame: GameState) => {
    if (finishLock.current) return;
    finishLock.current = true;
    const record: MatchRecord = {
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      durationMs: Date.now() - finalGame.startedAt,
      size: finalGame.board.length,
      difficulty: finalGame.difficulty,
      personality: finalGame.personality,
      scores: [...finalGame.scores],
      sequences: [...finalGame.sequences],
      result: matchResult(finalGame.scores),
      moves: finalGame.moves,
      board: finalGame.board,
      rules: finalGame.rules,
      challengeSeed: finalGame.challenge?.seed,
      challengeTarget: finalGame.challenge?.target,
      challengeCompleted: finalGame.challenge ? finalGame.sequences[0] >= finalGame.challenge.target : undefined,
    };
    try {
      await saveMatch(record);
      setMatches(previous => [record, ...previous]);
      setScreen('results');
    } catch (cause) {
      setError(`Match finished, but saving failed: ${cause instanceof Error ? cause.message : 'storage error'}`);
      setScreen('results');
    }
  }, []);

  const applyMove = useCallback((at: Coordinate, letter: 'S' | 'O', player: 0 | 1) => {
    const previous = gameRef.current;
    if (!previous || previous.paused || isGameOver(previous.board, previous.scores, previous.rules) || previous.current !== player || previous.board[at.row]?.[at.col] !== null) return;
    const snapshot: GameSnapshot = {
      board: previous.board.map(row => [...row]),
      scores: [...previous.scores], sequences: [...previous.sequences],
      current: previous.current, moves: [...previous.moves],
    };
    setUndoStack(stack => [...stack, snapshot]);
    const { board, sequences } = scoreMove(previous.board, at, letter, previous.rules);
    playGameTone(preferences.sound, preferences.soundVolume, sequences.length > 0, player);
    const nextScores: [number, number] = [...previous.scores];
    const nextSequenceCount: [number, number] = [...previous.sequences];
    nextScores[player] += sequences.length;
    nextSequenceCount[player] += sequences.length;
    const moves = [...previous.moves, { row: at.row, col: at.col, letter, player, sequences: sequences.length }];
    const keepsTurn = sequences.length > 0 && previous.rules.extraTurn;
    const next: GameState = {
      ...previous, board, scores: nextScores, sequences: nextSequenceCount,
      moves, current: keepsTurn ? player : player === 0 ? 1 : 0,
      status: sequences.length ? `${sequences.length} SOS ${sequences.length === 1 ? 'sequence' : 'sequences'} scored${keepsTurn ? ' — play again!' : '.'}` : player === 0 ? 'AI is considering its move…' : 'Your move.',
      lastSequences: sequences,
    };
    if (isGameOver(board, nextScores, previous.rules)) next.status = 'Match complete.';
    gameRef.current = next;
    setGame(next);
    if (isGameOver(board, nextScores, previous.rules)) window.setTimeout(() => { void finishGame(next); }, 750);
  }, [finishGame, preferences.sound, preferences.soundVolume]);

  useEffect(() => {
    if (!game || game.paused || isGameOver(game.board, game.scores, game.rules) || game.current !== 1 || gameLock.current || screen !== 'game') return;
    gameLock.current = true;
    const thinkingDelay = window.setTimeout(() => {
      try {
        const choice = chooseAiMove(game.board, game.rules, game.difficulty, game.personality, game.moves);
        applyMove(choice.at, choice.letter, 1);
        if (preferences.dialogue) {
          setGame(current => current ? { ...current, status: `${quotes[Math.floor(Math.random() * quotes.length)]} ${choice.explanation}` } : current);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'AI could not choose a move.');
      } finally { gameLock.current = false; }
    }, 850);
    return () => { window.clearTimeout(thinkingDelay); gameLock.current = false; };
  }, [game, screen, preferences.dialogue, game?.rules, applyMove]);

  const changePreferences = (patch: Partial<Preferences>) => setPreferences(current => ({ ...current, ...patch }));
  const openScreen = (target: Screen) => { setError(''); setSelectedMatch(null); setScreen(target); };

  const currentRecord = selectedMatch;
  const playerStats = useMemo(() => calculateStats(filteredMatches, 0), [filteredMatches]);
  const aiStats = useMemo(() => calculateStats(filteredMatches, 1), [filteredMatches]);
  const chartData = useMemo(() => [...filteredMatches].reverse().map((match, index) => ({
    match: index + 1, player: match.scores[0], ai: match.scores[1],
    date: new Date(match.date).toLocaleDateString(), diff: match.scores[0] - match.scores[1],
  })), [filteredMatches]);

  function onCell(row: number, col: number) {
    if (!game || game.current !== 0 || game.paused) return;
    applyMove({ row, col }, selectedLetter, 0);
  }

  function resetCurrentMatch() {
    if (game) beginGame(game.board.length, game.challenge);
  }

  function undoMove() {
    if (!game || isGameOver(game.board, game.scores, game.rules) || !undoStack.length || game.current !== 0 || !game.moves.some(move => move.player === 0)) return;
    const index = game.moves.at(-1)?.player === 1 && undoStack.length > 1 ? undoStack.length - 2 : undoStack.length - 1;
    const snapshot = undoStack[index];
    setUndoStack(stack => stack.slice(0, index));
    setGame(current => current ? { ...current, ...snapshot, lastSequences: [], status: 'Move undone.' } : current);
  }

  async function exportData(format: 'json' | 'csv') {
    const content = format === 'json'
      ? JSON.stringify({ exportedAt: new Date().toISOString(), matches }, null, 2)
      : ['match,date,board,difficulty,personality,player_score,ai_score,result,duration_ms,player_sos,ai_sos',
        ...matches.map((m, i) => [i + 1, m.date, `${m.size}x${m.size}`, DIFFICULTIES[m.difficulty - 1], m.personality, m.scores[0], m.scores[1], m.result, m.durationMs, m.sequences[0], m.sequences[1]].join(','))].join('\n');
    const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `sos-mind-arena-matches.${format}`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const nav = [
    { key: 'home' as Screen, label: 'Home', icon: Home },
    { key: 'custom' as Screen, label: 'Custom Match', icon: Gamepad2 },
    { key: 'ai-lab' as Screen, label: 'AI Lab', icon: Brain },
    { key: 'analytics' as Screen, label: 'Analytics', icon: BarChart3 },
    { key: 'history' as Screen, label: 'Match History', icon: History },
    { key: 'achievements' as Screen, label: 'Progress', icon: Award },
    { key: 'challenge' as Screen, label: 'Daily Challenge', icon: CalendarDays },
  ];

  return (
    <div className={`app-shell ${game?.focus && screen === 'game' ? 'focus-mode' : ''}`}>
      {!game?.focus || screen !== 'game' ? <aside className="sidebar">
        <button className="brand" onClick={() => openScreen('home')} aria-label="SOS Mind Arena home">
          <div className="brand-mark"><span>S</span><span>O</span><span>S</span></div>
          <div className="brand-name">MIND <b>ARENA</b><small>STRATEGY DIVISION</small></div>
        </button>
        <div className="nav-label">COMMAND</div>
        <nav className="side-nav">
          {nav.map(item => {
            const Icon = item.icon;
            return <button key={item.key} className={`nav-item ${screen === item.key ? 'active' : ''}`} onClick={() => openScreen(item.key)} title={item.label} aria-label={item.label}>
              <Icon size={17} strokeWidth={1.8} /><span>{item.label}</span>{item.key === 'challenge' && <span className="nav-dot" />}
            </button>;
          })}
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-promo">
          <div className="promo-icon"><Sparkles size={16} /></div>
          <strong>Mind over moves.</strong><p>A new challenge awaits you.</p>
          <button onClick={() => openScreen('challenge')}>Explore daily challenge <ArrowRight size={13} /></button>
        </div>
        <button className={`nav-item ${screen === 'settings' ? 'active' : ''}`} title="Settings" aria-label="Settings" onClick={() => openScreen('settings')}><Settings size={17} /><span>Settings</span></button>
        <button className={`nav-item ${screen === 'how-to' ? 'active' : ''}`} title="How to play" aria-label="How to play" onClick={() => openScreen('how-to')}><CircleHelp size={17} /><span>How to play</span></button>
        <div className="profile-mini"><div className="avatar player-avatar">P</div><div><b>{preferences.playerName || 'Player'}</b><small>Level {Math.floor(matches.length / 3) + 1} Strategist</small></div><ChevronDown size={15} /></div>
      </aside> : null}

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb"><span>ARENA</span><span className="crumb-slash">/</span><b>{screen.replace('-', ' ').toUpperCase()}</b></div>
          <div className="topbar-actions"><div className="online-indicator"><span /> LOCAL PLAY</div><div className="topbar-divider" /><button className="icon-btn" title="Settings" onClick={() => openScreen('settings')}><Settings size={17} /></button></div>
        </header>
        {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error"><X size={15} /></button></div>}

        <AnimatePresence mode="wait">
          <motion.div key={screen} className="screen-content" initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.18 }}>
            {screen === 'home' && <HomeScreen matches={matches} playerName={preferences.playerName} onPlay={() => beginGame()} onCustom={() => openScreen('custom')} onNavigate={openScreen} />}
            {screen === 'custom' && <CustomScreen preferences={preferences} onChange={changePreferences} onStart={() => beginGame(customSize)} customSize={customSize} setCustomSize={setCustomSize} />}
            {screen === 'game' && game && <GameScreen game={game} preferences={preferences} selectedLetter={selectedLetter} setSelectedLetter={setSelectedLetter} onCell={onCell} onPause={() => setGame(g => g ? { ...g, paused: !g.paused } : g)} onRestart={resetCurrentMatch} onUndo={undoMove} canUndo={undoStack.length > 0 && game.current === 0} onFocus={() => setGame(g => g ? { ...g, focus: !g.focus } : g)} />}
            {screen === 'analytics' && <AnalyticsScreen matches={filteredMatches} allMatches={matches} playerStats={playerStats} aiStats={aiStats} chartData={chartData} difficulty={filterDifficulty} setDifficulty={setFilterDifficulty} personality={filterPersonality} setPersonality={setFilterPersonality} size={filterSize} setSize={setFilterSize} dateFilter={dateFilter} setDateFilter={setDateFilter} onExport={exportData} onClear={async () => { if (window.confirm('Delete all saved match records and statistics? This cannot be undone.')) { await clearMatches(); setMatches([]); } }} />}
            {screen === 'history' && <HistoryScreen matches={matches} search={search} setSearch={setSearch} selected={currentRecord} setSelected={setSelectedMatch} compare={compareMatches} setCompare={setCompareMatches} />}
            {screen === 'settings' && <SettingsScreen preferences={preferences} onChange={changePreferences} />}
            {screen === 'ai-lab' && <AiLabScreen preferences={preferences} onChange={changePreferences} matches={matches} onPlay={() => beginGame()} />}
            {screen === 'achievements' && <AchievementsScreen matches={matches} />}
            {screen === 'challenge' && <ChallengeScreen onStart={(seed, target, size, rules) => beginGame(size, { seed, target, rules })} matches={matches} />}
            {screen === 'how-to' && <HowToScreen />}
            {screen === 'results' && game && <ResultsScreen game={game} preferences={preferences} onAgain={() => beginGame(game.board.length, game.challenge)} onCustom={() => openScreen('custom')} onHome={() => openScreen('home')} />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

function calculateStats(matches: MatchRecord[], side: 0 | 1) {
  const scores = matches.map(match => match.scores[side]);
  const wins = matches.filter(match => match.result === (side === 0 ? 'win' : 'loss')).length;
  const losses = matches.filter(match => match.result === (side === 0 ? 'loss' : 'win')).length;
  const draws = matches.filter(match => match.result === 'draw').length;
  let streak = 0;
  for (const match of matches) {
    if (match.result === (side === 0 ? 'win' : 'loss')) streak++;
    else break;
  }
  return {
    matches: matches.length, wins, losses, draws, streak, total: scores.reduce((sum, score) => sum + score, 0),
    average: matches.length ? scores.reduce((sum, score) => sum + score, 0) / matches.length : 0,
    highest: scores.length ? Math.max(...scores) : 0,
    sequences: matches.reduce((sum, match) => sum + match.sequences[side], 0),
    winRate: matches.length ? Math.round(wins / matches.length * 100) : 0,
  };
}

function PageTitle({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-title"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function HomeScreen({ matches, playerName, onPlay, onCustom, onNavigate }: { matches: MatchRecord[]; playerName: string; onPlay: () => void; onCustom: () => void; onNavigate: (screen: Screen) => void }) {
  const wins = matches.filter(match => match.result === 'win').length;
  return <div className="home-screen">
    <div className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-dot" /> STRATEGY IS A STATE OF MIND</div><h1>Welcome back, <span>{playerName}.</span></h1><p>Your next great move is one game away.</p></div><div className="welcome-date"><CalendarDays size={15} />{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div></div>
    <section className="hero-card">
      <div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" /><div className="hero-grid" />
      <div className="hero-copy"><div className="hero-kicker"><span className="pulse-dot" /> THE ARENA IS OPEN</div><h2>Think ahead.<br /><span>Outsmart the AI.</span></h2><p>A classic game of strategy. An opponent that learns. Every move matters.</p><div className="hero-actions"><button className="primary-btn" onClick={onPlay}><Play size={16} fill="currentColor" /> Play now <ArrowRight size={15} /></button><button className="ghost-btn light" onClick={onCustom}>Build a match <Settings size={15} /></button></div></div>
      <div className="hero-board" aria-hidden="true"><div className="mini-board">{['S', null, 'O', null, 'O', null, null, 'S', 'S'].map((cell, i) => <div key={i} className={cell ? `mini-cell ${cell === 'S' ? 'mini-s' : 'mini-o'}` : 'mini-cell'}>{cell}</div>)}</div><div className="board-score"><span>TACTICAL PATTERN</span><b><span>S</span> <i>×</i> <span>O</span> <i>×</i> <span>S</span></b></div></div>
    </section>
    <div className="section-heading"><div><span className="eyebrow">YOUR COMMAND CENTER</span><h2>At a glance</h2></div><button className="text-btn" onClick={() => onNavigate('analytics')}>Full analytics <ArrowRight size={14} /></button></div>
    <div className="overview-grid"><MetricCard icon={<Gamepad2 />} label="MATCHES PLAYED" value={matches.length.toString()} meta="Your arena record" tone="blue" /><MetricCard icon={<Trophy />} label="VICTORIES" value={wins.toString()} meta={matches.length ? `${Math.round(wins / matches.length * 100)}% win rate` : 'First win awaits'} tone="violet" /><MetricCard icon={<Target />} label="SOS SEQUENCES" value={matches.reduce((n, m) => n + m.sequences[0], 0).toString()} meta="Across completed matches" tone="gold" /><MetricCard icon={<Flame />} label="CURRENT STREAK" value={`${currentWinStreak(matches)} wins`} meta="Keep the momentum" tone="pink" /></div>
    <div className="home-lower"><button className="challenge-card" onClick={() => onNavigate('challenge')}><div className="challenge-icon"><Zap size={19} /></div><div><span className="eyebrow">DAILY CHALLENGE</span><h3>One board. One objective.</h3><p>A fresh tactical puzzle, every day.</p></div><ArrowRight size={18} className="challenge-arrow" /></button><div className="quick-links"><button onClick={() => onNavigate('ai-lab')}><Brain size={17} /><span><b>Explore AI Lab</b><small>Meet your next rival</small></span><ArrowRight size={14} /></button><button onClick={() => onNavigate('history')}><History size={17} /><span><b>Review matches</b><small>{matches.length ? `${matches.length} match${matches.length === 1 ? '' : 'es'} on record` : 'Your history starts here'}</small></span><ArrowRight size={14} /></button></div></div>
  </div>;
}

function currentWinStreak(matches: MatchRecord[]) { let count = 0; for (const match of matches) { if (match.result !== 'win') break; count++; } return count; }

function MetricCard({ icon, label, value, meta, tone }: { icon: React.ReactNode; label: string; value: string; meta: string; tone: string }) {
  return <div className={`metric-card tone-${tone}`}><div className="metric-top"><div className="metric-icon">{icon}</div><span className="metric-label">{label}</span></div><strong>{value}</strong><small>{meta}</small></div>;
}

function CustomScreen({ preferences, onChange, onStart, customSize, setCustomSize }: { preferences: Preferences; onChange: (patch: Partial<Preferences>) => void; onStart: () => void; customSize: number; setCustomSize: (size: number) => void }) {
  const rules = preferences.rules;
  const updateRules = (patch: Partial<Rules>) => onChange({ rules: { ...rules, ...patch } });
  return <div className="page-wrap">
    <PageTitle eyebrow="MATCH CONFIGURATION" title="Build your arena." description="Set the rules. Choose your rival. Make every match your own." action={<button className="primary-btn" onClick={onStart}><Play size={15} fill="currentColor" /> Start match</button>} />
    <div className="custom-layout"><section className="panel configuration-panel"><div className="panel-heading"><div><h3>Board & rules</h3><p>Shape the game to your strategy</p></div><Grid2X2 size={18} /></div>
      <div className="field-label">BOARD SIZE <span>{customSize} × {customSize}</span></div><div className="size-grid">{SIZE_OPTIONS.map(size => <button key={size} className={customSize === size ? 'size-option selected' : 'size-option'} onClick={() => { setCustomSize(size); onChange({ size }); }}>{size}<small>× {size}</small></button>)}</div>
      <label className="slider-label"><span>Custom size</span><b>{customSize} × {customSize}</b></label><input aria-label="Custom board size" type="range" min="3" max="10" value={customSize} onChange={event => { const size = Number(event.target.value); setCustomSize(size); onChange({ size }); }} />
      <div className="divider" /><div className="field-label">SCORING DIRECTIONS</div>
      <div className="toggle-list">{(['horizontal', 'vertical', 'diagonal'] as const).map(direction => <ToggleRow key={direction} title={direction[0].toUpperCase() + direction.slice(1)} detail={`${direction} SOS sequences`} checked={rules.directions[direction]} onChange={checked => updateRules({ directions: { ...rules.directions, [direction]: checked } })} />)}</div>
      <div className="divider" /><div className="toggle-list"><ToggleRow title="Extra turn" detail="Score an SOS to play again" checked={rules.extraTurn} onChange={checked => updateRules({ extraTurn: checked })} /></div>
      <label className="input-label">Winning score <span className="muted">Optional</span><input type="number" min="1" max="100" placeholder="No score limit" value={rules.winningScore ?? ''} onChange={event => updateRules({ winningScore: event.target.value ? Math.max(1, Number(event.target.value)) : null })} /></label>
    </section>
    <section className="panel rival-panel"><div className="panel-heading"><div><h3>Choose your opponent</h3><p>Every personality brings a different game</p></div><Bot size={19} /></div>
      <div className="field-label">DIFFICULTY</div><div className="difficulty-list">{DIFFICULTIES.map((difficulty, index) => <button key={difficulty} className={`difficulty-option ${preferences.difficulty === index + 1 ? 'selected' : ''}`} onClick={() => onChange({ difficulty: index + 1 })}><span className="difficulty-rank">0{index + 1}</span><span><b>{difficulty}</b><small>{['Learns the basics', 'A friendly challenge', 'Thinks a few moves ahead', 'Sharp, multi-move strategy', 'The ultimate test'][index]}</small></span>{preferences.difficulty === index + 1 && <Check size={16} />}</button>)}</div>
      <div className="field-label">AI PERSONALITY</div><select className="select-control" value={preferences.personality} onChange={event => onChange({ personality: event.target.value as Personality })}>{PERSONALITIES.map(personality => <option key={personality}>{personality}</option>)}</select>
      <div className="rival-preview"><div className="avatar ai-avatar"><Bot size={18} /></div><div><small>YOUR OPPONENT</small><b>{AI_NAMES[preferences.personality]}</b></div><div className="rival-spark"><Sparkles size={17} /></div></div>
      <button className="primary-btn wide-btn start-bottom" onClick={onStart}><Play size={15} fill="currentColor" /> Enter the arena <ArrowRight size={15} /></button>
    </section></div>
  </div>;
}

function ToggleRow({ title, detail, checked, onChange }: { title: string; detail: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <div className="toggle-row"><div><b>{title}</b><small>{detail}</small></div><button className={`switch ${checked ? 'on' : ''}`} role="switch" aria-checked={checked} onClick={() => onChange(!checked)}><span /></button></div>;
}

function GameScreen({ game, preferences, selectedLetter, setSelectedLetter, onCell, onPause, onRestart, onUndo, canUndo, onFocus }: { game: GameState; preferences: Preferences; selectedLetter: 'S' | 'O'; setSelectedLetter: (letter: 'S' | 'O') => void; onCell: (row: number, col: number) => void; onPause: () => void; onRestart: () => void; onUndo: () => void; canUndo: boolean; onFocus: () => void }) {
  const size = game.board.length;
  const finished = isGameOver(game.board, game.scores, game.rules);
  const lastMove = game.moves.at(-1);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const interval = window.setInterval(() => setElapsed(Math.floor((Date.now() - game.startedAt) / 1000)), 1000);
    return () => window.clearInterval(interval);
  }, [game.startedAt]);
  const highlightCells = new Set(game.lastSequences.flat().map(cell => `${cell.row}-${cell.col}`));
  const recentMoves = [...game.moves].reverse().slice(0, 6);
  return <div className={`game-screen ${game.focus ? 'focused' : ''}`}>
    {game.focus && <button className="focus-exit" onClick={onFocus}><X size={14} /> Exit focus</button>}
    {!game.focus && <div className="game-topline"><div><div className="eyebrow">LIVE MATCH <span className="live-dot" /></div><h1>Mind arena</h1></div><div className="game-controls"><button className="icon-btn" title="Undo move" disabled={!canUndo} onClick={onUndo}><Undo2 size={16} /></button><button className="icon-btn" title="Restart match" onClick={onRestart}><RotateCcw size={16} /></button><button className="icon-btn" title="Focus mode" onClick={onFocus}><Menu size={16} /></button><button className="icon-btn" title={game.paused ? 'Resume' : 'Pause'} onClick={onPause}>{game.paused ? <Play size={16} /> : <Pause size={16} />}</button></div></div>}
    <div className="scoreboard"><div className={`competitor ${game.current === 0 && !game.paused ? 'turn-active' : ''}`}><div className="avatar player-avatar large-avatar">{preferences.playerName.trim().slice(0, 1).toUpperCase() || 'P'}</div><div className="competitor-info"><small>YOU</small><b>{preferences.playerName}</b><span>{game.current === 0 ? 'Your turn' : 'On standby'}</span></div><div className="score-value player-score">{game.scores[0]}</div></div><div className="vs-badge">VS</div><div className={`competitor ai-competitor ${game.current === 1 && !game.paused ? 'turn-active' : ''}`}><div className="score-value ai-score">{game.scores[1]}</div><div className="competitor-info"><small>{DIFFICULTIES[game.difficulty - 1].toUpperCase()}</small><b>{AI_NAMES[game.personality].split(' • ')[0]}</b><span>{game.current === 1 ? 'Thinking…' : 'On standby'}</span></div><div className="avatar ai-avatar large-avatar"><Bot size={20} /></div></div></div>
    <div className="game-body"><section className="board-panel"><div className="board-toolbar"><span><span className="board-live" /> {game.paused ? 'MATCH PAUSED' : game.status.toUpperCase()}</span><div className="board-toolbar-right"><Clock3 size={14} /> {formatDuration(elapsed)} <span className="toolbar-divider" /> {getLegalMoves(game.board).length} open</div></div>
      <div className={`sos-board board-${size} cells-${preferences.cellStyle.toLowerCase()} letters-${preferences.letterStyle.toLowerCase()} animation-${preferences.animation.toLowerCase()}`} style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}>
        {game.board.flatMap((row, r) => row.map((letter, c) => {
          const move = game.moves.find(item => item.row === r && item.col === c);
          return <button key={`${r}-${c}`} className={`board-cell ${letter ? `filled letter-${letter.toLowerCase()} owner-${move?.player ?? 0}` : ''} ${highlightCells.has(`${r}-${c}`) ? 'scored-cell' : ''} ${lastMove?.row === r && lastMove.col === c ? 'last-cell' : ''}`} disabled={!!letter || game.current !== 0 || game.paused || finished} onClick={() => onCell(r, c)} aria-label={`Row ${r + 1}, column ${c + 1}${letter ? `, ${letter}` : ', empty'}`}>{letter && <span>{letter}</span>}</button>;
        }))}
      </div>
      <div className="board-bottom"><div className="letter-picker"><span>YOUR LETTER</span><button className={selectedLetter === 'S' ? 'picked' : ''} onClick={() => setSelectedLetter('S')}>S</button><button className={selectedLetter === 'O' ? 'picked' : ''} onClick={() => setSelectedLetter('O')}>O</button></div><div className="game-guidance"><span className={`turn-marker ${game.current === 1 ? 'ai-turn' : ''}`} />{game.paused ? 'Paused. Resume when ready.' : game.current === 1 ? 'AI is calculating its next move…' : 'Select a cell to place your letter.'}</div></div>
    </section>
    {!game.focus && <aside className="game-side"><div className="panel move-panel"><div className="panel-heading compact"><div><h3>Match activity</h3><p>Move-by-move record</p></div><Activity size={17} /></div><div className="move-count"><b>{game.moves.length.toString().padStart(2, '0')}</b><span>TOTAL MOVES</span></div><div className="move-list">{recentMoves.length ? recentMoves.map((move, i) => <div className="move-item" key={`${move.row}-${move.col}-${i}`}><span className={`move-index ${move.player === 1 ? 'ai-index' : ''}`}>{String(game.moves.length - i).padStart(2, '0')}</span><span className={`move-letter ${move.letter === 'O' ? 'o-letter' : ''}`}>{move.letter}</span><span className="move-owner">{move.player === 0 ? preferences.playerName : 'AI'}</span><span className="move-location">R{move.row + 1} · C{move.col + 1}</span></div>) : <div className="empty-moves">Your first move is waiting.</div>}</div><div className="move-panel-footer"><span>SEQUENCES</span><b><span>{game.sequences[0]}</span> — <span className="ai-text">{game.sequences[1]}</span></b></div></div><div className="ai-status"><div className="ai-status-avatar"><Bot size={16} /></div><div><span>AI INTELLIGENCE</span><b>{DIFFICULTIES[game.difficulty - 1]} · {game.personality}</b></div><span className={game.current === 1 ? 'thinking-bars active' : 'thinking-bars'}><i /><i /><i /></span></div></aside>}
    </div>
    {game.paused && <div className="pause-overlay"><div className="pause-card"><div className="pause-icon"><Pause size={22} /></div><span className="eyebrow">TIME OUT</span><h2>Match paused</h2><p>Your strategy isn't going anywhere.</p><button className="primary-btn" onClick={onPause}><Play size={15} fill="currentColor" /> Resume match</button><button className="text-btn" onClick={onRestart}>Restart match</button></div></div>}
  </div>;
}

function formatDuration(seconds: number) { return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`; }

function ResultsScreen({ game, preferences, onAgain, onCustom, onHome }: { game: GameState; preferences: Preferences; onAgain: () => void; onCustom: () => void; onHome: () => void }) {
  const result = matchResult(game.scores);
  const title = result === 'win' ? 'Victory is yours.' : result === 'loss' ? 'A worthy challenge.' : 'A tactical draw.';
  return <div className="results-screen"><div className={`result-emblem ${result}`}><Trophy size={29} /></div><div className="eyebrow">{result === 'win' ? 'ARENA CHAMPION' : result === 'loss' ? 'MATCH COMPLETE' : 'EVENLY MATCHED'}</div><h1>{title}</h1><p className="result-subtitle">{result === 'win' ? 'Your strategy outmaneuvered the machine.' : result === 'loss' ? 'Every defeat is a lesson in disguise.' : 'Neither strategist gave an inch.'}</p><div className="result-score"><div><small>{preferences.playerName.toUpperCase()}</small><b>{game.scores[0]}</b><span>{game.sequences[0]} SOS</span></div><i>:</i><div><small>{AI_NAMES[game.personality].split(' • ')[0].toUpperCase()}</small><b>{game.scores[1]}</b><span>{game.sequences[1]} SOS</span></div></div><div className="result-facts"><span><Clock3 size={14} /> {formatDuration(Math.floor((Date.now() - game.startedAt) / 1000))} duration</span><span><Gamepad2 size={14} /> {game.moves.length} moves</span><span><Grid2X2 size={14} /> {game.board.length} × {game.board.length}</span><span><Brain size={14} /> {DIFFICULTIES[game.difficulty - 1]}</span></div>{game.challenge && <div className={`challenge-result ${game.sequences[0] >= game.challenge.target ? 'complete' : ''}`}><Target size={14} /> Daily objective: {game.sequences[0]} / {game.challenge.target} SOS · {game.sequences[0] >= game.challenge.target ? 'Completed' : 'Not completed'}</div>}<div className="result-actions"><button className="primary-btn" onClick={onAgain}><RotateCcw size={15} /> Play again</button><button className="ghost-btn" onClick={onCustom}>New custom match</button><button className="text-btn" onClick={onHome}>Return to home <ArrowRight size={14} /></button></div></div>;
}

function AnalyticsScreen({ matches, allMatches, playerStats, aiStats, chartData, difficulty, setDifficulty, personality, setPersonality, size, setSize, dateFilter, setDateFilter, onExport, onClear }: { matches: MatchRecord[]; allMatches: MatchRecord[]; playerStats: ReturnType<typeof calculateStats>; aiStats: ReturnType<typeof calculateStats>; chartData: { match: number; player: number; ai: number; date: string; diff: number }[]; difficulty: string; setDifficulty: (value: string) => void; personality: string; setPersonality: (value: string) => void; size: string; setSize: (value: string) => void; dateFilter: string; setDateFilter: (value: string) => void; onExport: (format: 'json' | 'csv') => void; onClear: () => void }) {
  if (!allMatches.length) return <EmptyState title="Your story starts with a move." description="Complete your first match to unlock real performance insights, score comparisons, and trend lines." cta="Start your first match" onClick={() => window.dispatchEvent(new CustomEvent('start-match'))} />;
  const maxScore = Math.max(playerStats.highest, aiStats.highest);
  const trendData = [...matches].reverse().reduce<{ match: number; date: string; playerTotal: number; aiTotal: number; playerAverage: number; aiAverage: number; minutes: number }[]>((data, match, index) => {
    const previous = data.at(-1);
    const playerTotal = (previous?.playerTotal ?? 0) + match.scores[0];
    const aiTotal = (previous?.aiTotal ?? 0) + match.scores[1];
    data.push({
      match: index + 1, date: new Date(match.date).toLocaleDateString(),
      playerTotal, aiTotal, playerAverage: playerTotal / (index + 1), aiAverage: aiTotal / (index + 1),
      minutes: match.durationMs / 60000,
    });
    return data;
  }, []);
  const difficultyData = DIFFICULTIES.map((name, index) => {
    const group = matches.filter(match => match.difficulty === index + 1);
    return { name, playerWins: group.filter(match => match.result === 'win').length, aiWins: group.filter(match => match.result === 'loss').length, matches: group.length };
  }).filter(item => item.matches);
  const personalityData = PERSONALITIES.map(name => {
    const group = matches.filter(match => match.personality === name);
    return { name, player: group.reduce((sum, match) => sum + match.scores[0], 0), ai: group.reduce((sum, match) => sum + match.scores[1], 0), matches: group.length };
  }).filter(item => item.matches);
  return <div className="page-wrap analytics-page"><PageTitle eyebrow="PERFORMANCE INTELLIGENCE" title="Score analytics." description="Every point, every match — your strategy in numbers." action={<div className="export-actions"><button className="ghost-btn small" onClick={() => onExport('csv')}><Download size={14} /> CSV</button><button className="ghost-btn small" onClick={() => onExport('json')}><ArrowDownToLine size={14} /> JSON</button></div>} />
    <div className="filter-bar"><span className="filter-caption">FILTER BY</span><select value={dateFilter.startsWith('Custom:') ? 'Custom range' : dateFilter} onChange={event => setDateFilter(event.target.value === 'Custom range' ? 'Custom:|' : event.target.value)}><option>All time</option><option>Last 30 days</option><option>Last 7 days</option><option>Custom range</option></select>{dateFilter.startsWith('Custom:') && <DateRangeFilter value={dateFilter} onChange={setDateFilter} />}<select value={difficulty} onChange={event => setDifficulty(event.target.value)}><option>All</option>{DIFFICULTIES.map(value => <option key={value}>{value}</option>)}</select><select value={personality} onChange={event => setPersonality(event.target.value)}><option>All</option>{PERSONALITIES.map(value => <option key={value}>{value}</option>)}</select><select value={size} onChange={event => setSize(event.target.value)}><option>All</option>{SIZE_OPTIONS.map(value => <option key={value} value={value}>{value} × {value}</option>)}</select></div>
    <div className="analytics-competitors"><StatsGroup title="PLAYER PERFORMANCE" name="You" stats={playerStats} matches={matches} side={0} tone="player" /><StatsGroup title="AI PERFORMANCE" name="AI opponents" stats={aiStats} matches={matches} side={1} tone="ai" /></div>
    <div className="panel chart-panel"><div className="panel-heading"><div><h3>Score progression</h3><p>Points per completed match · {matches.length} matches</p></div><div className="chart-legend"><span><i className="legend-player" /> Player</span><span><i className="legend-ai" /> AI</span></div></div><div className="chart-main">{matches.length ? <ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 10, right: 12, bottom: 4, left: -18 }}><CartesianGrid stroke="#ffffff0c" vertical={false} /><XAxis dataKey="match" tick={{ fill: '#778098', fontSize: 11 }} tickLine={false} axisLine={false} label={{ value: 'MATCH NUMBER', position: 'insideBottom', offset: -3, fill: '#687187', fontSize: 9 }} /><YAxis allowDecimals={false} tick={{ fill: '#778098', fontSize: 11 }} tickLine={false} axisLine={false} /><Tooltip content={<ScoreTooltip />} /><Line type="monotone" dataKey="player" name="Player" stroke="var(--accent)" strokeWidth={2.6} dot={{ r: 3, fill: 'var(--accent)', stroke: '#111522', strokeWidth: 2 }} activeDot={{ r: 5 }} /><Line type="monotone" dataKey="ai" name="AI" stroke="#ad7aff" strokeWidth={2.2} dot={{ r: 3, fill: '#ad7aff', stroke: '#111522', strokeWidth: 2 }} activeDot={{ r: 5 }} /></LineChart></ResponsiveContainer> : <div className="empty-filter">No matches for these filters.</div>}</div></div>
    <div className="analytics-bottom"><div className="panel highest-panel"><div className="panel-heading compact"><div><h3>All-time high scores</h3><p>Your personal best vs the arena</p></div><Crown size={18} /></div><div className="highscore-compare"><div className="highscore-person"><span className="highscore-label"><i className="legend-player" /> PLAYER BEST</span><b>{playerStats.highest}</b><div className="highscore-track"><i className="player-fill" style={{ width: `${maxScore ? playerStats.highest / maxScore * 100 : 0}%` }} /></div></div><div className="highscore-person"><span className="highscore-label"><i className="legend-ai" /> AI BEST</span><b>{aiStats.highest}</b><div className="highscore-track"><i className="ai-fill" style={{ width: `${maxScore ? aiStats.highest / maxScore * 100 : 0}%` }} /></div></div></div><div className="leader-note"><Sparkles size={14} /> {playerStats.highest === aiStats.highest ? 'A perfect tie at the top.' : playerStats.highest > aiStats.highest ? 'You hold the all-time high score.' : 'The AI holds the all-time high score.'}</div></div>
      <div className="panel distribution-panel"><div className="panel-heading compact"><div><h3>Match outcomes</h3><p>Win, loss & draw distribution</p></div><Activity size={17} /></div><div className="outcome-bars">{[['Wins', playerStats.wins, 'win'], ['Losses', playerStats.losses, 'loss'], ['Draws', playerStats.draws, 'draw']].map(([label, amount, tone]) => <div className="outcome-row" key={String(label)}><span>{label}</span><div className="outcome-track"><i className={`outcome-fill ${tone}`} style={{ width: `${allMatches.length ? Number(amount) / allMatches.length * 100 : 0}%` }} /></div><b>{amount}</b></div>)}</div><div className="match-count-note"><span>{matches.length}</span> filtered matches in view</div></div></div>
    <div className="analytics-chart-grid">
      <TrendChart title="Cumulative points" subtitle="Player vs AI total points over time" data={trendData} playerKey="playerTotal" aiKey="aiTotal" />
      <TrendChart title="Average score" subtitle="Running average per match" data={trendData} playerKey="playerAverage" aiKey="aiAverage" />
      <div className="panel mini-chart-panel"><div className="panel-heading compact"><div><h3>Match duration</h3><p>Minutes per completed match</p></div><Clock3 size={16} /></div><div className="mini-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={trendData}><CartesianGrid stroke="#ffffff0c" vertical={false} /><XAxis dataKey="match" tick={{ fill: '#778098', fontSize: 9 }} tickLine={false} axisLine={false} /><YAxis tick={{ fill: '#778098', fontSize: 9 }} tickLine={false} axisLine={false} width={28} /><Tooltip /><Line type="monotone" dataKey="minutes" name="Minutes" stroke="#e0bf76" strokeWidth={2} dot={{ r: 2 }} /></LineChart></ResponsiveContainer></div></div>
      <div className="panel mini-chart-panel"><div className="panel-heading compact"><div><h3>Wins by difficulty</h3><p>Actual outcomes against each tier</p></div><Shield size={16} /></div><div className="mini-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={difficultyData}><CartesianGrid stroke="#ffffff0c" vertical={false} /><XAxis dataKey="name" tick={{ fill: '#778098', fontSize: 8 }} tickLine={false} axisLine={false} /><YAxis allowDecimals={false} tick={{ fill: '#778098', fontSize: 9 }} tickLine={false} axisLine={false} width={25} /><Tooltip /><Line type="monotone" dataKey="playerWins" name="Player wins" stroke="#80a8ff" strokeWidth={2} dot={{ r: 3 }} /><Line type="monotone" dataKey="aiWins" name="AI wins" stroke="#b48aff" strokeWidth={2} dot={{ r: 3 }} /></LineChart></ResponsiveContainer></div></div>
      <div className="panel mini-chart-panel"><div className="panel-heading compact"><div><h3>Points by personality</h3><p>Player and AI scores vs each rival</p></div><Brain size={16} /></div><div className="mini-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={personalityData}><CartesianGrid stroke="#ffffff0c" vertical={false} /><XAxis dataKey="name" tick={{ fill: '#778098', fontSize: 8 }} tickLine={false} axisLine={false} /><YAxis tick={{ fill: '#778098', fontSize: 9 }} tickLine={false} axisLine={false} width={25} /><Tooltip /><Line type="monotone" dataKey="player" name="Player points" stroke="#80a8ff" strokeWidth={2} dot={{ r: 3 }} /><Line type="monotone" dataKey="ai" name="AI points" stroke="#b48aff" strokeWidth={2} dot={{ r: 3 }} /></LineChart></ResponsiveContainer></div></div>
    </div>
    <div className="filtered-count">Showing {matches.length} of {allMatches.length} completed matches <button className="text-btn" onClick={onClear}>Delete all history</button></div>
  </div>;
}

function ScoreTooltip({ active, payload, label }: { active?: boolean; payload?: { payload: { date: string; player: number; ai: number; diff: number } }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload;
  return <div className="chart-tooltip"><small>MATCH {label} · {data.date}</small><b className="tooltip-player">PLAYER <span>{data.player}</span></b><b className="tooltip-ai">AI <span>{data.ai}</span></b><small className="tooltip-diff">SCORE DIFFERENCE {data.diff > 0 ? '+' : ''}{data.diff}</small></div>;
}

function DateRangeFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [start = '', end = ''] = value.slice(7).split('|');
  return <div className="date-range-filter"><input aria-label="Start date" type="date" value={start} onChange={event => onChange(`Custom:${event.target.value}|${end}`)} /><span>to</span><input aria-label="End date" type="date" value={end} onChange={event => onChange(`Custom:${start}|${event.target.value}`)} /></div>;
}

function TrendChart({ title, subtitle, data, playerKey, aiKey }: { title: string; subtitle: string; data: { match: number; date: string; playerTotal: number; aiTotal: number; playerAverage: number; aiAverage: number; minutes: number }[]; playerKey: 'playerTotal' | 'playerAverage'; aiKey: 'aiTotal' | 'aiAverage' }) {
  return <div className="panel mini-chart-panel"><div className="panel-heading compact"><div><h3>{title}</h3><p>{subtitle}</p></div><Activity size={16} /></div><div className="mini-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={data}><CartesianGrid stroke="#ffffff0c" vertical={false} /><XAxis dataKey="match" tick={{ fill: '#778098', fontSize: 9 }} tickLine={false} axisLine={false} /><YAxis tick={{ fill: '#778098', fontSize: 9 }} tickLine={false} axisLine={false} width={30} /><Tooltip /><Line type="monotone" dataKey={playerKey} name="Player" stroke="#80a8ff" strokeWidth={2} dot={{ r: 2 }} /><Line type="monotone" dataKey={aiKey} name="AI" stroke="#b48aff" strokeWidth={2} dot={{ r: 2 }} /></LineChart></ResponsiveContainer></div></div>;
}

function StatsGroup({ title, name, stats, matches, side, tone }: { title: string; name: string; stats: ReturnType<typeof calculateStats>; matches: MatchRecord[]; side: 0 | 1; tone: string }) {
  const bestWin = Math.max(0, ...matches.filter(match => match.result === (side === 0 ? 'win' : 'loss')).map(match => match.scores[side]));
  const cards = [['MATCHES', stats.matches], ['TOTAL POINTS', stats.total], ['AVG / MATCH', stats.average.toFixed(1)], ['ALL-TIME HIGH', stats.highest], ['BEST WIN', bestWin], ['SOS SEQUENCES', stats.sequences], ['WINS', stats.wins], ['WIN RATE', `${stats.winRate}%`], ['CURRENT STREAK', stats.streak], ['LOSSES', stats.losses], ['DRAWS', stats.draws]];
  return <div className={`stats-group ${tone}-group`}><div className="stats-group-head"><div className={`stats-dot ${tone}`} /><span>{title}</span><b>{name}</b></div><div className="stats-card-grid">{cards.map(([label, value]) => <div className="stats-mini-card" key={String(label)}><small>{label}</small><b>{value}</b></div>)}</div></div>;
}

function EmptyState({ title, description, cta, onClick }: { title: string; description: string; cta: string; onClick: () => void }) {
  return <div className="empty-state"><div className="empty-orbit"><div className="empty-logo">SOS</div><span className="empty-orbit-dot" /></div><div className="eyebrow">THE ARENA AWAITS</div><h2>{title}</h2><p>{description}</p><button className="primary-btn" onClick={onClick}><Play size={15} fill="currentColor" /> {cta} <ArrowRight size={14} /></button></div>;
}

function HistoryScreen({ matches, search, setSearch, selected, setSelected, compare, setCompare }: { matches: MatchRecord[]; search: string; setSearch: (value: string) => void; selected: MatchRecord | null; setSelected: (match: MatchRecord | null) => void; compare: string[]; setCompare: (ids: string[]) => void }) {
  const [sort, setSort] = useState('newest');
  const [difficulty, setDifficulty] = useState('All');
  const [personality, setPersonality] = useState('All');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const visible = matches.filter(match => {
    const date = match.date.slice(0, 10);
    return (difficulty === 'All' || DIFFICULTIES[match.difficulty - 1] === difficulty) &&
      (personality === 'All' || match.personality === personality) &&
      (!startDate || date >= startDate) && (!endDate || date <= endDate) &&
      `${match.personality} ${DIFFICULTIES[match.difficulty - 1]} ${match.result} ${match.size}x${match.size} ${date}`.toLowerCase().includes(search.toLowerCase());
  });
  visible.sort((a, b) => sort === 'player' ? b.scores[0] - a.scores[0] : sort === 'ai' ? b.scores[1] - a.scores[1] : sort === 'oldest' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date));
  return <div className="page-wrap"><PageTitle eyebrow="THE ARCHIVE" title="Match history." description="Revisit every clash. Learn something from each one." action={<span className="match-total">{matches.length} SAVED</span>} />
    <div className="history-tools"><div className="search-field"><span>⌕</span><input placeholder="Search matches…" value={search} onChange={event => setSearch(event.target.value)} /></div><select className="select-control" value={sort} onChange={event => setSort(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="player">Highest player score</option><option value="ai">Highest AI score</option></select></div>
    <div className="history-filters"><span>FILTER HISTORY</span><select value={difficulty} onChange={event => setDifficulty(event.target.value)}><option>All</option>{DIFFICULTIES.map(value => <option key={value}>{value}</option>)}</select><select value={personality} onChange={event => setPersonality(event.target.value)}><option>All</option>{PERSONALITIES.map(value => <option key={value}>{value}</option>)}</select><input aria-label="History start date" type="date" value={startDate} onChange={event => setStartDate(event.target.value)} /><span>to</span><input aria-label="History end date" type="date" value={endDate} onChange={event => setEndDate(event.target.value)} /></div>
    {!matches.length ? <EmptyState title="No matches in the archive." description="Every completed match is saved here automatically, ready when you are." cta="Play your first match" onClick={() => window.dispatchEvent(new CustomEvent('start-match'))} /> :
    <div className="panel history-panel"><div className="history-head"><span>MATCH</span><span>DATE</span><span>BOARD</span><span>AI OPPONENT</span><span>SCORE</span><span>RESULT</span><span>REPORT</span></div>
      {visible.map((match, i) => <div className={`history-row ${selected?.id === match.id ? 'row-selected' : ''}`} key={match.id}><label className="compare-check"><input type="checkbox" checked={compare.includes(match.id)} onChange={event => setCompare(event.target.checked ? [...compare.slice(-1), match.id] : compare.filter(id => id !== match.id))} /><span /></label><span className="history-number">#{String(matches.length - i).padStart(3, '0')}</span><span className="history-date">{new Date(match.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span><span className="history-size">{match.size} × {match.size}</span><span className="history-ai"><small>{DIFFICULTIES[match.difficulty - 1]}</small><b>{match.personality}</b></span><span className="history-score"><b>{match.scores[0]}</b><i>:</i><b>{match.scores[1]}</b></span><span className={`result-pill ${match.result}`}>{match.result}</span><button className="row-open" onClick={() => setSelected(match)} aria-label="View match report"><ArrowRight size={15} /></button></div>)}
      {!visible.length && <div className="empty-filter">No matches match that search.</div>}
      {compare.length === 2 && <div className="compare-strip"><span>Comparing two matches</span>{compare.map(id => { const match = matches.find(item => item.id === id); return <b key={id}>{match?.scores[0]} : {match?.scores[1]}</b>; })}<button onClick={() => setCompare([])}>Clear</button></div>}
    </div>}
    {selected && <div className="modal-backdrop" onClick={() => setSelected(null)}><div className="report-modal" onClick={event => event.stopPropagation()}><button className="modal-close" onClick={() => setSelected(null)}><X size={17} /></button><div className="eyebrow">MATCH REPORT</div><h2>Match #{String(matches.indexOf(selected) + 1).padStart(3, '0')}</h2><div className="report-score"><b>{selected.scores[0]}</b><span>:</span><b>{selected.scores[1]}</b></div><div className="report-grid">{[['Result', selected.result], ['Date', new Date(selected.date).toLocaleString()], ['Duration', formatDuration(Math.floor(selected.durationMs / 1000))], ['Board', `${selected.size} × ${selected.size}`], ['AI difficulty', DIFFICULTIES[selected.difficulty - 1]], ['Personality', selected.personality], ['Total moves', selected.moves.length], ['SOS sequences', `${selected.sequences[0]} player · ${selected.sequences[1]} AI`]].map(([label, value]) => <div key={label}><small>{label}</small><b>{value}</b></div>)}</div><div className="report-moves"><h3>Complete move history</h3>{selected.moves.map((move, i) => <span key={i} className={`report-move ${move.player === 1 ? 'ai-move' : ''}`}>{i + 1}. {move.player === 0 ? 'You' : 'AI'} · {move.letter} · R{move.row + 1} C{move.col + 1}{move.sequences ? ` · +${move.sequences} SOS` : ''}</span>)}</div></div></div>}
  </div>;
}

function SettingsScreen({ preferences, onChange }: { preferences: Preferences; onChange: (patch: Partial<Preferences>) => void }) {
  return <div className="page-wrap"><PageTitle eyebrow="PERSONALIZATION" title="Your arena, your rules." description="Fine-tune the atmosphere and the way the game feels." />
    <div className="settings-layout"><section className="panel settings-panel"><div className="panel-heading"><div><h3>Visual identity</h3><p>Choose the atmosphere of your arena</p></div><Sparkles size={17} /></div><div className="theme-grid">{Object.entries(THEMES).map(([name, colors]) => <button key={name} className={`theme-option ${preferences.theme === name ? 'selected' : ''}`} onClick={() => onChange({ theme: name })}><span style={{ background: `linear-gradient(135deg, ${colors.accent}, ${colors.glow})` }} /><b>{name}</b>{preferences.theme === name && <Check size={14} />}</button>)}</div>
      {preferences.theme === 'Custom' && <label className="color-control">Custom accent color<input aria-label="Custom accent color" type="color" value={preferences.customAccent} onChange={event => onChange({ customAccent: event.target.value })} /></label>}
      <div className="custom-preview"><div className={`preview-board cells-${preferences.cellStyle.toLowerCase()} letters-${preferences.letterStyle.toLowerCase()} animation-${preferences.animation.toLowerCase()}`}><span>S</span><i /><span>O</span><i /><i /><span>S</span><i /><i /><span>O</span></div><span>LIVE BOARD PREVIEW</span></div>
      <label className="input-label">Cell style<select className="select-control" value={preferences.cellStyle} onChange={event => onChange({ cellStyle: event.target.value })}>{['Rounded', 'Sharp', 'Glass', 'Neon', '3D'].map(style => <option key={style}>{style}</option>)}</select></label>
      <label className="input-label">Letter style<select className="select-control" value={preferences.letterStyle} onChange={event => onChange({ letterStyle: event.target.value })}>{['Modern', 'Bold', 'Neon', 'Gradient'].map(style => <option key={style}>{style}</option>)}</select></label>
      <label className="input-label">Animation<select className="select-control" value={preferences.animation} onChange={event => onChange({ animation: event.target.value })}>{['Smooth', 'Dynamic', 'Cinematic', 'Minimal'].map(style => <option key={style}>{style}</option>)}</select></label>
      <div className="divider" /><div className="panel-heading compact"><div><h3>Player profile</h3><p>Your name in the arena</p></div></div><label className="input-label">Display name<input value={preferences.playerName} maxLength={24} onChange={event => onChange({ playerName: event.target.value })} /></label>
    </section><section className="panel settings-panel"><div className="panel-heading"><div><h3>Game experience</h3><p>Sound, speech, and match defaults</p></div><Volume2 size={17} /></div><div className="toggle-list"><ToggleRow title="Sound effects" detail="Play move and SOS scoring tones" checked={preferences.sound} onChange={sound => onChange({ sound })} /><ToggleRow title="AI dialogue" detail="Contextual reactions and move insights" checked={preferences.dialogue} onChange={dialogue => onChange({ dialogue })} /></div>
      <label className="slider-label sound-volume"><span>Sound volume</span><b>{preferences.soundVolume}%</b></label><input aria-label="Sound volume" className="volume-slider" type="range" min="0" max="100" value={preferences.soundVolume} onChange={event => onChange({ soundVolume: Number(event.target.value) })} />
      <div className="divider" /><div className="panel-heading compact"><div><h3>Default match</h3><p>Used when you choose Quick Play</p></div></div><label className="input-label">Board size<select className="select-control" value={preferences.size} onChange={event => onChange({ size: Number(event.target.value) })}>{SIZE_OPTIONS.map(size => <option key={size} value={size}>{size} × {size}</option>)}</select></label><label className="input-label">AI difficulty<select className="select-control" value={preferences.difficulty} onChange={event => onChange({ difficulty: Number(event.target.value) })}>{DIFFICULTIES.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select></label><label className="input-label">AI personality<select className="select-control" value={preferences.personality} onChange={event => onChange({ personality: event.target.value as Personality })}>{PERSONALITIES.map(p => <option key={p}>{p}</option>)}</select></label></section></div>
  </div>;
}

function AiLabScreen({ preferences, onChange, matches, onPlay }: { preferences: Preferences; onChange: (patch: Partial<Preferences>) => void; matches: MatchRecord[]; onPlay: () => void }) {
  return <div className="page-wrap"><PageTitle eyebrow="INTELLIGENCE DIVISION" title="Meet the minds." description="Five personalities. Five distinct approaches. One opponent at a time." action={<button className="primary-btn" onClick={onPlay}><Play size={15} fill="currentColor" /> Challenge current AI</button>} />
    <div className="ai-lab-feature"><div className="ai-lab-glow" /><div className="ai-lab-icon"><Brain size={24} /></div><div><span className="eyebrow">THE ENGINE ROOM</span><h2>Not just a move.<br /><span>A strategy.</span></h2><p>Each opponent evaluates scoring lines, blocks threats, and searches ahead. Higher difficulties look further into the board.</p></div><div className="engine-stats"><div><b>5</b><small>PERSONALITIES</small></div><div><b>5</b><small>DIFFICULTY TIERS</small></div><div><b>{matches.length}</b><small>YOUR MATCHES</small></div></div></div>
    <div className="personality-grid">{PERSONALITIES.map((personality, i) => {
      const descriptions = ['Pushes for immediate scoring chances and keeps the pressure on.', 'Reads your open lines and closes down scoring opportunities.', 'Sets traps, weighs tradeoffs, and plans several moves ahead.', 'Observes your habits and changes its approach as you play.', 'A shifting play style that keeps every board unpredictable.'];
      const features = [['High-pressure scoring', 'Fast openings'], ['Threat denial', 'Board control'], ['Multi-line planning', 'Tactical setups'], ['Pattern recognition', 'Adaptive responses'], ['Varied tactics', 'Unconventional lines']];
      const matchesWith = matches.filter(match => match.personality === personality);
      const aiWins = matchesWith.filter(match => match.result === 'loss').length;
      return <button key={personality} className={`personality-card ${preferences.personality === personality ? 'selected' : ''}`} onClick={() => onChange({ personality })}><div className={`personality-avatar personality-${i}`}><Bot size={19} /></div><div className="personality-name"><span>0{i + 1} · AI PERSONALITY</span><h3>{AI_NAMES[personality]}</h3></div>{preferences.personality === personality && <span className="active-badge"><Check size={11} /> SELECTED</span>}<p>{descriptions[i]}</p><div className="strength-list">{features[i].map(feature => <span key={feature}><Check size={11} />{feature}</span>)}</div><div className="personality-footer"><span>YOUR MATCHES</span><b>{matchesWith.length}</b><span className="footer-spacer">AI WIN RATE</span><b>{matchesWith.length ? Math.round(aiWins / matchesWith.length * 100) : '—'}{matchesWith.length ? '%' : ''}</b></div></button>;
    })}</div>
    <section className="panel difficulty-panel"><div className="panel-heading"><div><h3>Calibrate the challenge</h3><p>Search depth and tactical complexity scale with difficulty</p></div><Shield size={18} /></div><div className="difficulty-scale">{DIFFICULTIES.map((difficulty, i) => <button key={difficulty} className={preferences.difficulty === i + 1 ? 'active' : ''} onClick={() => onChange({ difficulty: i + 1 })}><span>{String(i + 1).padStart(2, '0')}</span><b>{difficulty}</b><i style={{ height: `${20 + i * 15}%` }} /></button>)}</div></section>
  </div>;
}

function AchievementsScreen({ matches }: { matches: MatchRecord[] }) {
  const wins = matches.filter(match => match.result === 'win').length;
  const allSequences = matches.reduce((total, match) => total + match.sequences[0], 0);
  const maxScore = Math.max(0, ...matches.map(match => match.scores[0]));
  const averageDuration = matches.length ? matches.reduce((total, match) => total + match.durationMs, 0) / matches.length : 0;
  const boardCounts = matches.reduce<Record<number, number>>((counts, match) => ({ ...counts, [match.size]: (counts[match.size] ?? 0) + 1 }), {});
  const favoriteBoard = Object.entries(boardCounts).sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0];
  const bestStreak = (() => { let streak = 0; let best = 0; for (const match of [...matches].reverse()) { streak = match.result === 'win' ? streak + 1 : 0; best = Math.max(best, streak); } return best; })();
  const achievements = [
    ['First Victory', 'Claim your first win against the AI.', wins >= 1, '1 win'],
    ['SOS Master', 'Score 25 SOS sequences across all matches.', allSequences >= 25, `${allSequences} / 25`],
    ['AI Destroyer', 'Win 10 matches against any AI.', wins >= 10, `${wins} / 10 wins`],
    ['Strategic Genius', 'Complete 25 matches.', matches.length >= 25, `${matches.length} / 25 matches`],
    ['Perfect Streak', 'Build a streak of 5 victories.', bestStreak >= 5, `Best: ${bestStreak}`],
    ['Mastermind Challenger', 'Face the Mastermind difficulty.', matches.some(match => match.difficulty === 5), 'Play on Mastermind'],
    ['Score Champion', 'Score 10 or more SOS in one match.', maxScore >= 10, `Best: ${maxScore}`],
    ['Comeback King', 'Win after trailing at the halfway point.', matches.some(isComebackWin), 'Keep fighting back'],
  ] as const;
  const xp = wins * 120 + matches.length * 30 + allSequences * 8;
  const level = Math.floor(xp / 500) + 1;
  return <div className="page-wrap"><PageTitle eyebrow="PLAYER PROGRESSION" title="Earn your legend." description="Every match is progress. Every victory is proof." />
    <div className="level-card"><div className="level-medal"><Crown size={22} /></div><div className="level-info"><span>ARENA RANK · LEVEL {level}</span><h2>Strategist</h2><div className="xp-track"><i style={{ width: `${xp % 500 / 5}%` }} /></div><small>{xp % 500} / 500 XP to level {level + 1}</small></div><div className="xp-total"><b>{xp.toLocaleString()}</b><span>TOTAL XP</span></div></div>
    <div className="progress-stats">{[['MATCHES', matches.length], ['WIN RATE', `${matches.length ? Math.round(wins / matches.length * 100) : 0}%`], ['AVERAGE TIME', formatDuration(Math.floor(averageDuration / 1000))], ['TOTAL SOS', matches.reduce((total, match) => total + match.sequences[0] + match.sequences[1], 0)], ['BEST STREAK', `${bestStreak} wins`], ['FAVORITE BOARD', favoriteBoard ? `${favoriteBoard} × ${favoriteBoard}` : '—']].map(([label, value]) => <div className="progress-stat" key={String(label)}><small>{label}</small><b>{value}</b></div>)}</div>
    <div className="achievement-heading"><div><span className="eyebrow">THE HALL OF PROGRESS</span><h2>Achievements</h2></div><span>{achievements.filter(item => item[2]).length} / {achievements.length} UNLOCKED</span></div>
    <div className="achievement-grid">{achievements.map(([name, description, unlocked, progress], i) => <div className={`achievement-card ${unlocked ? 'unlocked' : 'locked'}`} key={name}><div className={`achievement-icon ach-${i}`}>{[<Trophy />, <Zap />, <Target />, <Brain />, <Flame />, <Crown />, <Award />, <Activity />][i]}</div><div className="achievement-copy"><b>{name}</b><p>{description}</p><small>{unlocked ? 'UNLOCKED' : progress}</small></div>{unlocked && <Check className="achievement-check" size={15} />}</div>)}</div>
  </div>;
}

function isComebackWin(match: MatchRecord) {
  if (match.result !== 'win') return false;
  const halfway = Math.floor(match.moves.length / 2);
  let scores: [number, number] = [0, 0];
  for (let index = 0; index < halfway; index++) scores[match.moves[index].player] += match.moves[index].sequences;
  return scores[0] < scores[1];
}

function ChallengeScreen({ onStart, matches }: { onStart: (seed: string, target: number, size: number, rules: Rules) => void; matches: MatchRecord[] }) {
  const today = new Date();
  const seed = `${today.getUTCFullYear()}-${today.getUTCMonth() + 1}-${today.getUTCDate()}`;
  const challenge = [...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const target = 3 + challenge % 4;
  const boardSize = [4, 5, 6][challenge % 3];
  const rules: Rules = { ...DEFAULT_RULES, directions: { ...DEFAULT_RULES.directions, diagonal: challenge % 2 === 0 } };
  const completedDates = new Set(matches.filter(match => match.challengeCompleted).map(match => match.challengeSeed));
  const completed = matches.some(match => match.challengeSeed === seed && match.challengeCompleted);
  const todayKey = today.toISOString().slice(0, 10);
  let streakDate = new Date(`${todayKey}T00:00:00Z`);
  if (!completedDates.has(todayKey)) streakDate.setUTCDate(streakDate.getUTCDate() - 1);
  let streak = 0;
  while (completedDates.has(streakDate.toISOString().slice(0, 10))) {
    streak++;
    streakDate.setUTCDate(streakDate.getUTCDate() - 1);
  }
  return <div className="page-wrap challenge-page"><PageTitle eyebrow="DAILY TACTICAL EXERCISE" title="Today's challenge." description="A fresh board, a focused objective, and one shot to make your mark." />
    <div className="daily-card"><div className="daily-decor"><div className="daily-ring" /><div className="daily-ring second" /><span>0{challenge % 9 + 1}</span></div><div className="daily-content"><span className="eyebrow"><CalendarDays size={13} /> DAILY CHALLENGE · {today.toLocaleDateString(undefined, { month: 'long', day: 'numeric' }).toUpperCase()}</span><h2>Find your opening.</h2><p>Finish the match with at least <b>{target} SOS sequences</b>. Every cell counts.</p><div className="daily-tags"><span><Grid2X2 size={13} /> {boardSize} × {boardSize} Board</span><span><Brain size={13} /> Strategist AI</span><span><Zap size={13} /> {rules.directions.diagonal ? 'All directions' : 'No diagonal scoring'}</span></div><button className="primary-btn" onClick={() => onStart(seed, target, boardSize, rules)}><Play size={15} fill="currentColor" /> {completed ? 'Play again' : 'Accept challenge'} <ArrowRight size={15} /></button></div><div className="challenge-status"><span>DAILY STATUS</span><b className={completed ? 'done' : ''}>{completed ? '✓ COMPLETED TODAY' : 'READY WHEN YOU ARE'}</b><small>Daily streak · {streak} day{streak === 1 ? '' : 's'}</small><small>Challenge seed · {seed}</small></div></div>
    <div className="challenge-note"><Sparkles size={16} /><span><b>Same challenge for everyone, every day.</b> This board is generated from today's date, so you can return and compare your strategy.</span></div>
  </div>;
}

function HowToScreen() {
  return <div className="page-wrap"><PageTitle eyebrow="FIELD MANUAL" title="How to play SOS." description="Simple rules. A surprising amount of strategy." />
    <div className="howto-layout"><section className="panel howto-main"><div className="howto-step"><span>01</span><div><h3>Choose a letter</h3><p>On your turn, pick any empty cell and place either <b className="text-s">S</b> or <b className="text-o">O</b>. The AI does the same on its turn.</p></div></div><div className="howto-step"><span>02</span><div><h3>Complete an SOS</h3><p>Make the sequence <b className="text-s">S</b>–<b className="text-o">O</b>–<b className="text-s">S</b> horizontally, vertically, or diagonally. Each new sequence scores one point.</p></div></div><div className="howto-step"><span>03</span><div><h3>Score and play again</h3><p>With extra turns enabled, completing one or more SOS sequences earns a point for each and lets you take another turn.</p></div></div><div className="howto-step"><span>04</span><div><h3>Win the arena</h3><p>The match ends when the board is full or the configured winning score is reached. The strategist with more points wins.</p></div></div></section><aside className="panel howto-tip"><div className="tip-icon"><Brain size={20} /></div><span className="eyebrow">STRATEGIST'S NOTE</span><h3>Think beyond the next move.</h3><p>An O between two empty cells is a promise of future points. Look for ways to create your own openings—and close the AI's.</p><div className="example-sequence"><span className="text-s">S</span><i /> <span className="text-o">O</span><i /> <span>?</span></div></aside></div>
  </div>;
}

export default App;
