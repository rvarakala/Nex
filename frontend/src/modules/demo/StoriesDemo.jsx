/**
 * AUDINEXA Demo — Stories mode.
 *
 * Case-driven storyboard. Each story is a sequence of *scenes* — an
 * actor at a screen, a moment in time, a narrative sentence, a feature
 * callout, an optional outcome ribbon.
 *
 * Layout: sticky top rail = story picker; left rail = scenes within
 * current story; centre = big screenshot + storytelling copy panel.
 * Keyboard: ← → arrows navigate scenes, S/F jump between stories.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Play, Pause, Home, Camera, Clock, User,
  Sparkles, Grid3x3, BookOpen,
} from 'lucide-react';
import { STORIES } from './stories';

const C = {
  bone: '#FDFBF7',
  ink: '#1A1C23',
  ink2: '#4A4D57',
  saffron: '#D95D39',
  border: '#E2DFD8',
  navy: '#0B0D17',
  surface: '#F3F1EC',
};
const F = {
  display: '"Cabinet Grotesk", "Inter", sans-serif',
  body: '"IBM Plex Sans", sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, monospace',
};

const AUTOPLAY_MS = 9000;

function useFonts() {
  useEffect(() => {
    if (document.getElementById('audinexa-demo-fonts')) return;
    const l1 = document.createElement('link');
    l1.id = 'audinexa-demo-fonts';
    l1.rel = 'stylesheet';
    l1.href = 'https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@700,800,500,300&display=swap';
    document.head.appendChild(l1);
    const l2 = document.createElement('link');
    l2.rel = 'stylesheet';
    l2.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap';
    document.head.appendChild(l2);
  }, []);
}

function ScreenshotFrame({ src, alt, accent }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative rounded-2xl overflow-hidden border shadow-2xl bg-white h-full flex items-center justify-center"
      style={{ borderColor: C.border, boxShadow: `0 30px 80px -30px ${accent}55` }}
      data-testid="demo-screenshot-frame">
      <div className="absolute top-0 left-0 right-0 flex items-center gap-1.5 px-4 py-2 border-b z-10"
        style={{ background: C.surface, borderColor: C.border }}>
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#FCA5A5' }} />
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#FCD34D' }} />
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#86EFAC' }} />
        <span className="ml-3 text-[10px] uppercase tracking-widest font-semibold truncate"
          style={{ fontFamily: F.mono, color: C.ink2 }}>audinexa · {alt}</span>
      </div>
      {failed ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center px-8">
          <Camera className="w-14 h-14" style={{ color: accent }} strokeWidth={1.5} />
          <p className="text-lg font-extrabold" style={{ fontFamily: F.display, color: C.ink }}>Screenshot capturing…</p>
          <p className="text-sm max-w-md" style={{ fontFamily: F.body, color: C.ink2 }}>
            This scene is captured with live production data. If you\u2019re viewing seconds after a refresh, hit reload.
          </p>
        </div>
      ) : (
        <img src={src} alt={alt} onError={() => setFailed(true)}
          className="w-full h-full object-contain pt-9" style={{ background: 'white' }} />
      )}
    </div>
  );
}

function ActorChip({ actor, accent }) {
  const map = {
    'Front Desk': '#0EA5A4', 'Audiologist': accent, 'System': '#4F46E5',
    'Owner': '#DB2777', 'Vendor': '#EA580C',
  };
  const bg = map[actor] || accent;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest"
      style={{ background: `${bg}22`, color: bg, fontFamily: F.mono }}>
      <User className="w-3 h-3" /> {actor}
    </span>
  );
}

function StoryRail({ stories, currentStoryIdx, currentSceneIdx, onJump }) {
  return (
    <aside className="hidden lg:flex flex-col w-72 border-r shrink-0 overflow-hidden"
      style={{ borderColor: C.border, background: C.bone }}>
      <div className="p-5 border-b" style={{ borderColor: C.border }}>
        <Link to="/" className="flex items-center gap-2" data-testid="demo-home-link">
          <span className="inline-flex w-8 h-8 rounded-lg items-center justify-center font-black"
            style={{ background: C.saffron, color: 'white', fontFamily: F.display }}>A</span>
          <span className="text-xl font-extrabold" style={{ fontFamily: F.display, color: C.ink, letterSpacing: '-0.03em' }}>audinexa</span>
        </Link>
        <p className="mt-3 text-[10px] uppercase tracking-widest font-semibold" style={{ fontFamily: F.mono, color: C.ink2 }}>Use-case stories</p>
        <p className="mt-1 text-sm font-semibold" style={{ fontFamily: F.body, color: C.ink }}>
          {stories.length} stories · {stories.reduce((n, s) => n + s.scenes.length, 0)} scenes
        </p>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {stories.map((story, sIdx) => {
          const isCurrent = sIdx === currentStoryIdx;
          const sceneCount = story.scenes.length;
          return (
            <div key={story.id} className="mb-2" data-testid={`story-${story.slug}`}>
              <button
                onClick={() => onJump(sIdx, 0)}
                className="w-full text-left px-5 py-3 transition-colors hover:bg-[color:var(--surface)]"
                style={{
                  background: isCurrent ? C.surface : 'transparent',
                  borderLeft: `3px solid ${isCurrent ? story.accent : 'transparent'}`,
                }}
              >
                <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ fontFamily: F.mono, color: story.accent }}>
                  {story.slug.split('-')[0].toUpperCase()}
                </p>
                <p className="text-sm font-bold leading-tight" style={{ fontFamily: F.display, color: C.ink, letterSpacing: '-0.01em' }}>
                  {story.title.split('·')[0].trim()}
                </p>
                <p className="text-[11px] mt-0.5" style={{ fontFamily: F.body, color: C.ink2 }}>{sceneCount} scene{sceneCount === 1 ? '' : 's'}</p>
              </button>
              {/* Scene mini-tocs when active */}
              {isCurrent && (
                <div className="pl-8 py-1">
                  {story.scenes.map((sc, scIdx) => (
                    <button
                      key={scIdx}
                      onClick={() => onJump(sIdx, scIdx)}
                      className="w-full text-left py-1 flex items-center gap-2 text-xs hover:underline"
                      data-testid={`scene-${sIdx}-${scIdx}`}
                      style={{
                        fontFamily: F.body,
                        color: scIdx === currentSceneIdx ? story.accent : C.ink2,
                        fontWeight: scIdx === currentSceneIdx ? 700 : 400,
                      }}
                    >
                      <span className="text-[9px] font-mono uppercase" style={{ color: C.ink2 }}>{sc.time}</span>
                      <span className="truncate">{sc.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="p-4 border-t space-y-2" style={{ borderColor: C.border }}>
        <Link to="/demo/features" className="flex items-center gap-2 text-xs hover:underline" style={{ fontFamily: F.body, color: C.ink2 }} data-testid="switch-to-features">
          <Grid3x3 className="w-3.5 h-3.5" /> Switch to Feature Grid →
        </Link>
        <p className="text-[10px] uppercase tracking-widest" style={{ fontFamily: F.mono, color: C.ink2 }}>Keys: ← → space</p>
      </div>
    </aside>
  );
}

export default function StoriesDemo() {
  useFonts();
  const [sIdx, setSIdx] = useState(0);
  const [scIdx, setScIdx] = useState(0);
  const [playing, setPlaying] = useState(false);

  const story = STORIES[sIdx];
  const scene = story.scenes[scIdx];

  const total = useMemo(() => STORIES.reduce((n, s) => n + s.scenes.length, 0), []);
  const linearIdx = useMemo(() => {
    let n = 0;
    for (let i = 0; i < sIdx; i++) n += STORIES[i].scenes.length;
    return n + scIdx;
  }, [sIdx, scIdx]);

  const jump = useCallback((newS, newSc = 0) => {
    setSIdx(Math.max(0, Math.min(STORIES.length - 1, newS)));
    setScIdx(Math.max(0, Math.min(STORIES[newS].scenes.length - 1, newSc)));
  }, []);

  const next = useCallback(() => {
    if (scIdx + 1 < story.scenes.length) setScIdx(scIdx + 1);
    else if (sIdx + 1 < STORIES.length) jump(sIdx + 1, 0);
  }, [scIdx, sIdx, story.scenes.length, jump]);

  const prev = useCallback(() => {
    if (scIdx > 0) setScIdx(scIdx - 1);
    else if (sIdx > 0) jump(sIdx - 1, STORIES[sIdx - 1].scenes.length - 1);
  }, [scIdx, sIdx, jump]);

  // Keyboard
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      else if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p); }
      else if (e.key === 'Home') { jump(0, 0); }
      else if (e.key === 'End') { jump(STORIES.length - 1, STORIES.at(-1).scenes.length - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, jump]);

  // Autoplay
  useEffect(() => {
    if (!playing) return () => {};
    const t = setInterval(next, AUTOPLAY_MS);
    return () => clearInterval(t);
  }, [playing, next]);

  useEffect(() => { document.title = `AUDINEXA Demo · ${story.title.split('·')[0].trim()}`; }, [story]);

  return (
    <div className="min-h-screen flex" style={{ background: C.bone, fontFamily: F.body, color: C.ink }} data-testid="demo-stories-page">
      <StoryRail stories={STORIES} currentStoryIdx={sIdx} currentSceneIdx={scIdx} onJump={jump} />

      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between gap-4 px-8 py-4 border-b" style={{ borderColor: C.border }}>
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <span className="text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded shrink-0"
              style={{ background: story.accent, color: 'white', fontFamily: F.mono }}>
              {story.slug.split('-')[0].toUpperCase()} · USE CASE
            </span>
            <span className="text-sm font-bold truncate" style={{ fontFamily: F.display, color: C.ink }}>{story.title}</span>
            <span className="text-[11px] uppercase tracking-widest ml-auto shrink-0" style={{ fontFamily: F.mono, color: C.ink2 }}>
              Scene {scIdx + 1} / {story.scenes.length} · Overall {linearIdx + 1}/{total}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPlaying((p) => !p)}
              className="p-2 rounded-md hover:bg-[color:var(--surface)]"
              style={{ background: playing ? C.surface : 'transparent' }}
              data-testid="demo-play-toggle" title="Play / pause (Space)">
              {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <Link to="/" className="p-2 rounded-md hover:bg-[color:var(--surface)]" data-testid="demo-exit" title="Home">
              <Home className="w-4 h-4" />
            </Link>
          </div>
        </header>

        {/* Progress */}
        <div className="h-1 w-full" style={{ background: C.surface }}>
          <div className="h-full transition-all duration-500" style={{ width: `${((linearIdx + 1) / total) * 100}%`, background: story.accent }} />
        </div>

        {/* Story lede band — only visible on first scene of each story */}
        {scIdx === 0 && (
          <div className="px-8 py-4 border-b flex flex-wrap items-center gap-4" style={{ background: `${story.accent}0A`, borderColor: `${story.accent}22` }}>
            <BookOpen className="w-4 h-4 shrink-0" style={{ color: story.accent }} />
            <p className="text-sm max-w-4xl" style={{ fontFamily: F.body, color: C.ink }}>{story.lede}</p>
          </div>
        )}

        {/* Scene */}
        <section className="flex-1 grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-8 p-8 overflow-y-auto">
          <div className="min-h-[420px] lg:min-h-0">
            <ScreenshotFrame src={scene.screenshot} alt={scene.title} accent={story.accent} />
          </div>

          <div className="flex flex-col justify-center max-w-xl">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-semibold" style={{ fontFamily: F.mono, color: C.ink2 }}>
                <Clock className="w-3 h-3" /> {scene.time}
              </span>
              <ActorChip actor={scene.actor} accent={story.accent} />
            </div>

            <h1 className="mt-3 text-3xl md:text-4xl font-extrabold" style={{ fontFamily: F.display, color: C.ink, letterSpacing: '-0.03em', lineHeight: 1.1 }}>
              {scene.title}
            </h1>

            <p className="mt-5 text-lg leading-relaxed" style={{ fontFamily: F.body, color: C.ink }}>
              {scene.narrative}
            </p>

            {/* Feature callout */}
            <div className="mt-6 rounded-lg border-l-4 py-3 pl-4 pr-3" style={{ borderColor: story.accent, background: `${story.accent}08` }}>
              <p className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ fontFamily: F.mono, color: story.accent }}>
                <Sparkles className="w-3 h-3 inline mr-1" />Feature callout
              </p>
              <p className="text-[15px] leading-relaxed" style={{ fontFamily: F.body, color: C.ink }}>
                {scene.callout}
              </p>
            </div>

            {/* Outcome ribbon */}
            {scene.outcome && (
              <div className="mt-4 rounded-lg px-3 py-2 text-[13px] font-semibold" style={{ background: '#0B0D17', color: 'white', fontFamily: F.mono }}>
                ● {scene.outcome}
              </div>
            )}

            {/* Route hint */}
            <p className="mt-8 text-[10px] uppercase tracking-widest" style={{ fontFamily: F.mono, color: C.ink2 }}>
              Screen route · <code>{scene.url}</code>
            </p>
          </div>
        </section>

        {/* Footer nav */}
        <footer className="flex items-center justify-between px-8 py-4 border-t" style={{ borderColor: C.border, background: C.bone }}>
          <button onClick={prev} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border font-semibold hover:border-[color:var(--ink)]"
            style={{ borderColor: C.border, fontFamily: F.body }} data-testid="demo-prev">
            <ArrowLeft className="w-4 h-4" /> Prev
          </button>

          {/* Scene dots for this story */}
          <div className="flex items-center gap-1">
            {story.scenes.map((_, i) => (
              <button key={i} onClick={() => setScIdx(i)} data-testid={`scene-dot-${i}`}
                className="h-1.5 rounded-full transition-all"
                style={{
                  width: i === scIdx ? 24 : 6,
                  background: i === scIdx ? story.accent : i < scIdx ? C.ink2 : C.border,
                }} />
            ))}
          </div>

          <button onClick={next} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full font-semibold text-white"
            style={{ background: story.accent, fontFamily: F.body }} data-testid="demo-next">
            {scIdx + 1 === story.scenes.length && sIdx + 1 < STORIES.length ? 'Next story' : 'Next'} <ArrowRight className="w-4 h-4" />
          </button>
        </footer>
      </main>
    </div>
  );
}
