import 'dotenv/config'
import express from 'express'
import pg from 'pg'
import { resolve } from 'node:path'
import { and, asc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { studyProgress, termKeywords, terms, topics } from '../src/db/schema'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('Set DATABASE_URL to the pooled Neon connection string.')

const pool = new pg.Pool({ connectionString, max: 5 })
const db = drizzle(pool)
const app = express()
app.use(express.json({ limit: '32kb' }))

const STUDY_DATA_CACHE_MS = 60_000
const STUDY_DATA_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=300'
type StudyData = {
  terms: {
    id: string; displayName: string; topic: string; position: number
    colors: { light: string; dark: string; accent: string }
  }[]
  topics: string[]
}
let studyDataCache: { data: StudyData; expiresAt: number } | undefined
let studyDataRefresh: Promise<StudyData> | undefined
type LibraryResult = {
  id: string; displayName: string; topic: string; position: number
  colors: { light: string; dark: string; accent: string }; keywords: string[]
}

app.get('/api/study-data', async (_request, response) => {
  try {
    response.set('Cache-Control', STUDY_DATA_CACHE_CONTROL)
    if (studyDataCache && studyDataCache.expiresAt > Date.now()) {
      return response.json(studyDataCache.data)
    }

    // Coalesce simultaneous cold/expired requests into one database query.
    studyDataRefresh ??= (async () => {
    const rows = await db.select({
      id: terms.id,
      displayName: terms.displayName,
      topic: topics.name,
      position: terms.position,
      colorLight: terms.colorLight,
      colorDark: terms.colorDark,
      colorAccent: terms.colorAccent,
    }).from(terms)
      .innerJoin(topics, eq(terms.topicId, topics.id))
      .orderBy(asc(terms.position))

    const byId = new Map<string, {
      id: string; displayName: string; topic: string; position: number
      colors: { light: string; dark: string; accent: string }
    }>()
    for (const row of rows) {
      let term = byId.get(row.id)
      if (!term) {
        term = {
          id: row.id,
          displayName: row.displayName,
          topic: row.topic,
          position: row.position,
          colors: { light: row.colorLight, dark: row.colorDark, accent: row.colorAccent },
        }
        byId.set(row.id, term)
      }
    }

    const result = [...byId.values()]
    return { terms: result, topics: [...new Set(result.map(term => term.topic))] }
    })()
    const data = await studyDataRefresh
    studyDataCache = { data, expiresAt: Date.now() + STUDY_DATA_CACHE_MS }
    response.json(data)
  } catch (error) {
    console.error('Failed to load study data from Neon:', error)
    response.status(503).json({ error: 'Study data is temporarily unavailable.' })
  } finally {
    studyDataRefresh = undefined
  }
})

app.get('/api/terms/:termId', async (request, response) => {
  try {
    const [term] = await db.select({ id: terms.id, explanation: terms.explanation })
      .from(terms).where(eq(terms.id, request.params.termId)).limit(1)
    if (!term) return response.status(404).json({ error: 'Term not found.' })
    const keywords = await db.select({ keyword: termKeywords.keyword }).from(termKeywords)
      .where(eq(termKeywords.termId, term.id)).orderBy(asc(termKeywords.position))
    response.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600')
    response.json({ ...term, keywords: keywords.map(row => row.keyword) })
  } catch (error) {
    console.error('Failed to load term details from Neon:', error)
    response.status(503).json({ error: 'Term details are temporarily unavailable.' })
  }
})

app.get('/api/library', async (request, response) => {
  const q = typeof request.query.q === 'string' ? request.query.q.trim().slice(0, 100) : ''
  const topic = typeof request.query.topic === 'string' ? request.query.topic : ''
  const parsedOffset = Number(request.query.offset ?? 0)
  const offset = Number.isSafeInteger(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0
  const parsedLimit = Number(request.query.limit ?? 30)
  const limit = Number.isSafeInteger(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 30
  const conditions = []
  if (topic && topic !== 'All topics') conditions.push(eq(topics.name, topic))
  if (q) conditions.push(or(
    ilike(terms.id, `%${q}%`), ilike(terms.displayName, `%${q}%`),
    sql`exists (select 1 from ${termKeywords} where ${termKeywords.termId} = ${terms.id} and ${termKeywords.keyword} ilike ${`%${q}%`})`,
  )!)
  const where = conditions.length ? and(...conditions) : undefined
  try {
    const [count] = await db.select({ total: sql<number>`count(*)::int` }).from(terms)
      .innerJoin(topics, eq(terms.topicId, topics.id)).where(where)
    const pageRows = await db.select({
      id: terms.id, displayName: terms.displayName, topic: topics.name,
      position: terms.position, colorLight: terms.colorLight, colorDark: terms.colorDark,
      colorAccent: terms.colorAccent,
    }).from(terms).innerJoin(topics, eq(terms.topicId, topics.id))
      .where(where).orderBy(asc(terms.position)).limit(limit).offset(offset)
    const pageIds = pageRows.map(row => row.id)
    const keywordRows = pageIds.length ? await db.select({ termId: termKeywords.termId, keyword: termKeywords.keyword })
      .from(termKeywords).where(inArray(termKeywords.termId, pageIds))
      .orderBy(asc(termKeywords.termId), asc(termKeywords.position)) : []
    const keywordsById = new Map<string, string[]>()
    for (const row of keywordRows) {
      const words = keywordsById.get(row.termId) ?? []
      if (words.length < 3) words.push(row.keyword)
      keywordsById.set(row.termId, words)
    }
    response.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60')
    response.json({ total: count.total, terms: pageRows.map(row => ({
      id: row.id, displayName: row.displayName, topic: row.topic, position: row.position,
      colors: { light: row.colorLight, dark: row.colorDark, accent: row.colorAccent },
      keywords: keywordsById.get(row.id) ?? [],
    })) })
  } catch (error) {
    console.error('Failed to search study terms:', error)
    response.status(503).json({ error: 'The library is temporarily unavailable.' })
  }
})

const validLearnerId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const ratings = new Set(['again', 'hard', 'good', 'easy'])

app.get('/api/progress/:learnerId', async (request, response) => {
  const { learnerId } = request.params
  if (!validLearnerId(learnerId)) return response.status(400).json({ error: 'Invalid learner ID.' })
  try {
    const rows = await db.select().from(studyProgress).where(eq(studyProgress.learnerId, learnerId))
    response.json(Object.fromEntries(rows.map(row => [row.termId, {
      seen: row.seen,
      streak: row.streak,
      due: row.dueAt.getTime(),
      lastRating: row.lastRating,
    }])))
  } catch (error) {
    console.error('Failed to load study progress from Neon:', error)
    response.status(503).json({ error: 'Study progress is temporarily unavailable.' })
  }
})

app.put('/api/progress/:learnerId/:termId', async (request, response) => {
  const { learnerId, termId } = request.params
  const { seen, streak, due, lastRating } = request.body ?? {}
  if (!validLearnerId(learnerId)) return response.status(400).json({ error: 'Invalid learner ID.' })
  if (!Number.isSafeInteger(seen) || seen < 1 || !Number.isSafeInteger(streak) || streak < 0 ||
      !Number.isSafeInteger(due) || due < 0 || !ratings.has(lastRating)) {
    return response.status(400).json({ error: 'Invalid progress record.' })
  }
  try {
    await db.insert(studyProgress).values({
      learnerId, termId, seen, streak, dueAt: new Date(due), lastRating,
    }).onConflictDoUpdate({
      target: [studyProgress.learnerId, studyProgress.termId],
      set: { seen, streak, dueAt: new Date(due), lastRating, updatedAt: new Date() },
    })
    response.status(204).end()
  } catch (error) {
    console.error('Failed to save study progress to Neon:', error)
    response.status(503).json({ error: 'Study progress could not be saved.' })
  }
})

app.delete('/api/progress/:learnerId', async (request, response) => {
  const { learnerId } = request.params
  if (!validLearnerId(learnerId)) return response.status(400).json({ error: 'Invalid learner ID.' })
  try {
    await db.delete(studyProgress).where(eq(studyProgress.learnerId, learnerId))
    response.status(204).end()
  } catch (error) {
    console.error('Failed to reset study progress in Neon:', error)
    response.status(503).json({ error: 'Study progress could not be reset.' })
  }
})

if (process.env.NODE_ENV === 'production') {
  const dist = resolve(process.cwd(), 'dist')
  app.use(express.static(dist))
  app.get(/.*/, (_request, response) => response.sendFile(resolve(dist, 'index.html')))
}

const port = Number(process.env.API_PORT || 3001)
const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'
const server = app.listen(port, host, () => console.log(`Study API listening on ${host}:${port}`))
const shutdown = () => server.close(() => { void pool.end().finally(() => process.exit(0)) })
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
