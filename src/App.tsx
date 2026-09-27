import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, Command, Flame, Grid2X2, Layers3, Lightbulb, RotateCcw, Search, Shuffle, Sparkles, X } from 'lucide-react'

type Rating = 'again' | 'hard' | 'good' | 'easy'
type Progress = Record<string, { seen: number; streak: number; due: number; lastRating: Rating }>
type Mode = 'study' | 'quiz' | 'library'
type CardPalette = { light: string; dark: string; accent: string }
const pretty = (word: string) => word.split('_').map(part => part.length <= 3 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)).join(' ')
const LEARNER_KEY = 'recall-cs-learner-id-v1'
type StudyData = {
  terms: { id: string; displayName: string; topic: string; position: number; colors: CardPalette }[]
  topics: string[]
}
type TermDetails = { explanation: string; keywords: string[] }
type LibraryResult = { id: string; displayName: string; topic: string; position: number; colors: CardPalette; keywords: string[] }
const getLearnerId = () => {
  let id = localStorage.getItem(LEARNER_KEY)
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(LEARNER_KEY, id) }
  return id
}
const intervalDays: Record<Rating, number> = { again: 0, hard: 1, good: 3, easy: 7 }

function StudyApp({ dataset }: { dataset: StudyData }) {
  const terms = useMemo(() => dataset.terms.map(({ id }) => [id, []] as [string, string[]]), [dataset])
  const cardColors = useMemo(() => Object.fromEntries(dataset.terms.map(term => [term.id, term.colors])) as Record<string, CardPalette>, [dataset])
  const topicByTerm = useMemo(() => Object.fromEntries(dataset.terms.map(term => [term.id, term.topic])), [dataset])
  const topicFor = (term: string) => topicByTerm[term] ?? 'Other'
  const [learnerId] = useState(getLearnerId)
  const [mode, setMode] = useState<Mode>('study')
  const [topic, setTopic] = useState('All topics')
  const [progress, setProgress] = useState<Progress>({})
  const [progressStatus, setProgressStatus] = useState<'loading' | 'saving' | 'saved' | 'error'>('loading')
  const [cardIndex, setCardIndex] = useState(0)
  const [slideDirection, setSlideDirection] = useState<'next' | 'previous'>('next')
  const [revealed, setRevealed] = useState(false)
  const [search, setSearch] = useState('')
  const [quizTerm, setQuizTerm] = useState(dataset.terms[0]?.id ?? '')
  const [quizInput, setQuizInput] = useState('')
  const [quizResult, setQuizResult] = useState<'right' | 'wrong' | null>(null)
  const [details, setDetails] = useState<Record<string, TermDetails>>({})
  const [libraryTerms, setLibraryTerms] = useState<LibraryResult[]>([])
  const [libraryTotal, setLibraryTotal] = useState(0)
  const [libraryPage, setLibraryPage] = useState(0)
  const [libraryLoading, setLibraryLoading] = useState(false)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const suppressCardTap = useRef(false)

  const topics = useMemo(() => ['All topics', ...dataset.topics], [dataset])
  const scopedTerms = useMemo(() => terms.filter(([key]) => topic === 'All topics' || topicFor(key) === topic), [topic])
  const dueTerms = useMemo(() => scopedTerms.filter(([key]) => (progress[key]?.due ?? 0) <= Date.now()), [progress, scopedTerms])
  const studyTerms = dueTerms.length ? dueTerms : scopedTerms
  const current = studyTerms[cardIndex % Math.max(studyTerms.length, 1)] || terms[0]
  const learned = Object.values(progress).filter(item => item.streak >= 2).length
  const masteredPct = Math.round(learned / terms.length * 100)
  const dueCount = terms.filter(([key]) => (progress[key]?.due ?? 0) <= Date.now()).length
  const reviewedCount = Object.values(progress).reduce((sum, item) => sum + item.seen, 0)
  const libraryPageSize = 30
  const loadDetails = (termId: string) => {
    if (details[termId]) return
    void fetch(`/api/terms/${encodeURIComponent(termId)}`)
      .then(response => { if (!response.ok) throw new Error('Could not load term details.'); return response.json() as Promise<TermDetails> })
      .then(data => setDetails(previous => ({ ...previous, [termId]: data })))
      .catch(() => {})
  }

  const navigateCard = (direction: 'next' | 'previous') => {
    setSlideDirection(direction)
    setCardIndex(index => (index + (direction === 'next' ? 1 : -1) + studyTerms.length) % Math.max(studyTerms.length, 1))
    setRevealed(false)
  }
  const shuffleSession = () => {
    if (studyTerms.length < 2) return
    const currentIndex = cardIndex % studyTerms.length
    let nextIndex = Math.floor(Math.random() * (studyTerms.length - 1))
    if (nextIndex >= currentIndex) nextIndex += 1
    setSlideDirection(nextIndex > currentIndex ? 'next' : 'previous')
    setCardIndex(nextIndex)
    setRevealed(false)
  }

  useEffect(() => {
    fetch(`/api/progress/${learnerId}`)
      .then(response => { if (!response.ok) throw new Error('Progress request failed'); return response.json() as Promise<Progress> })
      .then(saved => { setProgress(saved); setProgressStatus('saved') })
      .catch(() => setProgressStatus('error'))
  }, [learnerId])
  useEffect(() => { if (revealed) loadDetails(current[0]) }, [revealed, current?.[0]])
  useEffect(() => { if (mode === 'quiz') loadDetails(quizTerm) }, [mode, quizTerm])
  useEffect(() => {
    if (mode !== 'library') return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLibraryLoading(true)
      const params = new URLSearchParams({ q: search, topic, offset: String(libraryPage * libraryPageSize), limit: String(libraryPageSize) })
      fetch(`/api/library?${params}`, { signal: controller.signal })
        .then(response => { if (!response.ok) throw new Error('Could not load the library.'); return response.json() as Promise<{ total: number; terms: LibraryResult[] }> })
        .then(result => { setLibraryTerms(result.terms); setLibraryTotal(result.total) })
        .catch(() => { if (!controller.signal.aborted) { setLibraryTerms([]); setLibraryTotal(0) } })
        .finally(() => { if (!controller.signal.aborted) setLibraryLoading(false) })
    }, 180)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [mode, search, topic, libraryPage])
  useEffect(() => { setCardIndex(0); setRevealed(false) }, [topic, mode])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      const typing = ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) || target.isContentEditable
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setMode('library')
        window.setTimeout(() => document.getElementById('term-search')?.focus(), 0)
      } else if (!typing && mode === 'study' && event.code === 'Space') {
        event.preventDefault()
        setRevealed(value => !value)
      } else if (!typing && mode === 'study' && event.key === 'Enter') {
        event.preventDefault()
        setRevealed(value => !value)
      } else if (!typing && mode === 'study' && event.key === 'ArrowRight') {
        navigateCard('next')
      } else if (!typing && mode === 'study' && event.key === 'ArrowLeft') {
        navigateCard('previous')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode, revealed, studyTerms.length])

  const changeRating = (rating: Rating) => {
    const [key] = current
    const old = progress[key]
    const due = Date.now() + intervalDays[rating] * 86400000
    const record = { seen: (old?.seen || 0) + 1, streak: rating === 'again' ? 0 : (old?.streak || 0) + 1, due, lastRating: rating }
    setProgress(previous => ({ ...previous, [key]: record }))
    setProgressStatus('saving')
    void fetch(`/api/progress/${learnerId}/${encodeURIComponent(key)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record),
    }).then(response => { if (!response.ok) throw new Error('Progress save failed'); setProgressStatus('saved') })
      .catch(() => setProgressStatus('error'))
    navigateCard('next')
    setRevealed(false)
  }
  const resetProgress = () => {
    if (!confirm('Reset all saved study progress?')) return
    setProgress({})
    setProgressStatus('saving')
    void fetch(`/api/progress/${learnerId}`, { method: 'DELETE' })
      .then(response => { if (!response.ok) throw new Error('Progress reset failed'); setProgressStatus('saved') })
      .catch(() => setProgressStatus('error'))
  }
  const nextQuiz = () => {
    const [key] = terms[Math.floor(Math.random() * terms.length)]
    setQuizTerm(key); setQuizInput(''); setQuizResult(null)
  }
  const onCardTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('button')) return
    const touch = event.changedTouches[0]
    touchStart.current = { x: touch.clientX, y: touch.clientY }
  }
  const onCardTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!touchStart.current) return
    const touch = event.changedTouches[0]
    const deltaX = touch.clientX - touchStart.current.x
    const deltaY = touch.clientY - touchStart.current.y
    touchStart.current = null
    if (Math.abs(deltaX) < 55 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return
    suppressCardTap.current = true
    window.setTimeout(() => { suppressCardTap.current = false }, 350)
    navigateCard(deltaX < 0 ? 'next' : 'previous')
  }
  const onCardClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('button')) return
    if (suppressCardTap.current) return
    setRevealed(value => !value)
  }
  const checkQuiz = () => {
    const expected = (details[quizTerm]?.keywords ?? []).map(s => s.toLowerCase())
    const answer = quizInput.toLowerCase()
    setQuizResult(expected.some(word => answer.includes(word) || word.includes(answer.trim())) && answer.trim().length > 1 ? 'right' : 'wrong')
  }
  const filtered = libraryTerms

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Layers3 size={19}/></div><span>recall<span className="brand-dot">.</span></span></div>
      <div className="side-label">YOUR STUDY SPACE</div>
      <nav className="nav-list">
        <button className={`nav-item ${mode === 'study' ? 'active' : ''}`} onClick={() => setMode('study')}><BookOpen size={17}/> Study cards <span className="nav-count">{dueCount}</span></button>
        <button className={`nav-item ${mode === 'quiz' ? 'active' : ''}`} onClick={() => setMode('quiz')}><Sparkles size={17}/> Quick quiz</button>
        <button className={`nav-item ${mode === 'library' ? 'active' : ''}`} onClick={() => setMode('library')}><Grid2X2 size={17}/> All terms <span className="nav-count muted">{terms.length}</span></button>
      </nav>
      <div className="side-label topic-label">TOPICS <ChevronDown size={13}/></div>
      <div className="topic-list">{topics.slice(1).map((item, i) => <button key={item} className={`topic-item ${topic === item ? 'selected' : ''}`} onClick={() => { setTopic(topic === item ? 'All topics' : item); setMode('study') }}><span className={`topic-dot dot-${i % 6}`}/><span>{item}</span><span className="topic-total">{terms.filter(([key]) => topicFor(key) === item).length}</span></button>)}</div>
      <div className="sidebar-bottom"><div className="streak-card"><div className="streak-icon"><Flame size={17}/></div><div><strong>{reviewedCount ? 'Nice momentum' : 'Start your streak'}</strong><span>{reviewedCount} reviews completed</span></div></div><div className="profile"><div className="avatar">S</div><div className="profile-text"><strong>My study space</strong><span>Saved on this device</span></div><button className="icon-button" title="Reset progress" onClick={resetProgress}><RotateCcw size={15}/></button></div></div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="breadcrumb">Study space <span>/</span> <strong>{mode === 'study' ? 'Study cards' : mode === 'quiz' ? 'Quick quiz' : 'All terms'}</strong></div><div className="top-actions"><span className={`saved-status ${progressStatus}`}><span/> {progressStatus === 'loading' ? 'Loading progress' : progressStatus === 'saving' ? 'Saving progress' : progressStatus === 'error' ? 'Database unavailable' : 'Progress saved'}</span><button className="keyboard-hint"><Command size={13}/> K</button></div></header>
      <div className="content">
        {mode === 'library' && <><section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line"/> YOUR COMPUTER SCIENCE JOURNEY</div><h1>Explore the library.</h1><p>Browse all the concepts and connections you’re learning.</p></div><div className="progress-ring" style={{'--progress': `${masteredPct * 3.6}deg`} as React.CSSProperties}><div className="ring-inner"><strong>{masteredPct}%</strong><span>mastered</span></div></div></section>
        <section className="stats-row"><div className="stat-card"><div className="stat-icon lilac"><BookOpen size={17}/></div><div><span>Total concepts</span><strong>{terms.length}</strong></div><small>in your collection</small></div><div className="stat-card"><div className="stat-icon orange"><Lightbulb size={17}/></div><div><span>Due today</span><strong>{dueCount}</strong></div><small>ready to review</small></div><div className="stat-card"><div className="stat-icon green"><Check size={17}/></div><div><span>Mastered</span><strong>{learned}</strong></div><small>2+ confident reviews</small></div><div className="stat-card"><div className="stat-icon blue"><Flame size={17}/></div><div><span>Reviews done</span><strong>{reviewedCount}</strong></div><small>all time</small></div></section></>}

        {mode === 'study' && <section className="study-layout"><div className="study-main"><div className="section-heading"><div><div className="section-kicker">{dueTerms.length ? 'UP NEXT' : 'PICK UP WHERE YOU LEFT OFF'}</div><h2>{topic === 'All topics' ? 'Today’s session' : topic}</h2></div><div className="session-tools"><span className="session-count"><span className="count-dot"/>{dueTerms.length} cards due</span><button className="home-shuffle" onClick={shuffleSession} disabled={studyTerms.length < 2}><Shuffle size={13}/> Shuffle</button></div></div><div className={`flashcard slide-${slideDirection}`} style={{"--card-bg": cardColors[current[0]].light, "--card-accent": cardColors[current[0]].accent} as React.CSSProperties} key={current[0]} onTouchStart={onCardTouchStart} onTouchEnd={onCardTouchEnd} onClick={onCardClick} onTouchCancel={() => { touchStart.current = null }}><div className="card-topline"><span className="topic-pill">{topicFor(current[0])}</span><span className="card-position">{(cardIndex % Math.max(studyTerms.length, 1)) + 1} <i>/</i> {studyTerms.length}</span></div><div className="card-center" key={`${current[0]}-${revealed}`}><div className="card-prompt">{revealed ? 'EXPLANATION + KEY IDEAS' : 'CAN YOU EXPLAIN THIS?'}</div><h3>{pretty(current[0])}</h3>{revealed && <span className="card-subtitle">Read the explanation, then review its keywords.</span>}{revealed && <><p className="explanation-text">{details[current[0]]?.explanation ?? 'Loading explanation…'}</p><div className="keyword-list">{(details[current[0]]?.keywords ?? []).map((word, i) => <span key={word} className="keyword-chip"><b>{String(i + 1).padStart(2, '0')}</b>{word}</span>)}</div></>}</div><div className="card-footer"><span><Command size={12}/> Space / Enter to toggle</span><div><button className="round-arrow" aria-label="Previous card" onClick={() => navigateCard('previous')}><ArrowLeft size={16}/></button><button className="round-arrow" aria-label="Next card" onClick={() => navigateCard('next')}><ArrowRight size={16}/></button></div></div></div>{!revealed ? <button className="reveal-button" onClick={() => setRevealed(true)}>Reveal explanation + keywords <ArrowRight size={16}/></button> : <div className="rating-row"><span>How well did you know it?</span><div><button className="rate again" onClick={() => changeRating('again')}>Again <small>↺</small></button><button className="rate hard" onClick={() => changeRating('hard')}>Hard</button><button className="rate good" onClick={() => changeRating('good')}>Good</button><button className="rate easy" onClick={() => changeRating('easy')}>Easy <small>→</small></button></div></div>}</div></section>}

        {mode === 'quiz' && <section className="quiz-panel"><div className="quiz-head"><div><div className="section-kicker">KEYWORD RECALL</div><h2>What belongs to this concept?</h2></div><span className="topic-pill">Mixed topics</span></div><div className="quiz-body"><div className="quiz-number">CONCEPT</div><h3>{pretty(quizTerm)}</h3><p>Write one or more keywords you associate with this term.</p><textarea value={quizInput} onChange={e => setQuizInput(e.target.value)} placeholder="Type your keywords here…" rows={3} disabled={quizResult !== null}/>{quizResult && <div className={`quiz-feedback ${quizResult}`}>{quizResult === 'right' ? 'Nice recall — that keyword is in your set.' : 'Not quite. Review the keyword set below, then try another.'}<div className="quiz-answer">{(details[quizTerm]?.keywords ?? []).map(w => <span key={w}>{w}</span>)}</div></div>}<div className="quiz-actions"><span>Answers are checked against the saved keyword set.</span>{quizResult ? <button className="primary-button" onClick={nextQuiz}>Next question <ArrowRight size={15}/></button> : <button className="primary-button" disabled={!quizInput.trim() || !details[quizTerm]} onClick={checkQuiz}>Check answer <Check size={15}/></button>}</div></div><button className="shuffle-quiz" onClick={nextQuiz}><Shuffle size={14}/> Skip this concept</button></section>}

        {mode === 'library' && <section className="library-panel"><div className="library-head"><div><div className="section-kicker">YOUR REFERENCE</div><h2>All concepts <span>{libraryTotal}</span></h2></div><label className="search-box"><Search size={16}/><input id="term-search" value={search} onChange={e => { setSearch(e.target.value); setLibraryPage(0) }} placeholder="Search concepts or keywords"/><kbd>⌘ K</kbd></label></div><div className="library-filters"><select value={topic} onChange={e => { setTopic(e.target.value); setLibraryPage(0) }}>{topics.map(item => <option key={item}>{item}</option>)}</select><span>{libraryLoading ? 'Loading…' : `Showing ${libraryTerms.length ? libraryPage * libraryPageSize + 1 : 0}–${libraryPage * libraryPageSize + libraryTerms.length} of ${libraryTotal} concepts`}</span></div><div className="term-grid">{filtered.map(term => { const key = term.id; return <button className="term-card" key={key} onClick={() => { setQuizTerm(key); setMode('study'); setTopic(term.topic); setCardIndex(Math.max(0, studyTerms.findIndex(([item]) => item === key))); setRevealed(false) }}><div className="term-card-top"><span className="topic-pill">{term.topic}</span>{progress[key]?.streak >= 2 && <Check size={15} className="mastered-check"/>}</div><strong>{term.displayName || pretty(key)}</strong><span className="term-keywords">{term.keywords.slice(0, 3).join(' · ')}</span></button> })}</div><div className="library-filters"><button disabled={libraryPage === 0 || libraryLoading} onClick={() => setLibraryPage(page => page - 1)}>Previous</button><button disabled={(libraryPage + 1) * libraryPageSize >= libraryTotal || libraryLoading} onClick={() => setLibraryPage(page => page + 1)}>Next</button></div></section>}
        <footer className="page-footer"><span>One idea at a time adds up.</span><span>Built for curious minds <span className="footer-star">✳</span></span></footer>
      </div>
    </main>
  </div>
}

export default function App() {
  const [dataset, setDataset] = useState<StudyData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 20_000)
    fetch('/api/study-data', { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error(`Study data request failed (${response.status}). Check the API server and database.`); return response.json() as Promise<StudyData> })
      .then(data => {
        if (!data.terms?.length) throw new Error('The database has no study terms yet. Run npm run db:seed.')
        setDataset(data)
      })
      .catch(reason => setError(reason instanceof DOMException && reason.name === 'AbortError'
        ? 'The study database did not respond within 20 seconds. Check that the API server is running and can reach Neon, then try again.'
        : reason instanceof Error ? reason.message : 'Could not load study data.'))
      .finally(() => window.clearTimeout(timeout))
    return () => { window.clearTimeout(timeout); controller.abort() }
  }, [])

  if (error) return <main className="load-state"><div className="load-mark">!</div><h1>Couldn’t connect to your study database</h1><p>{error}</p><button onClick={() => location.reload()}>Try again</button></main>
  if (!dataset) return <main className="load-state"><div className="loading-spinner"/><h1>Loading your study cards</h1><p>Connecting to your Neon database…</p></main>
  return <StudyApp dataset={dataset}/>
}
