import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import { termKeywords, terms, topics } from '../src/db/schema'

const keywordsByTerm = JSON.parse(readFileSync(resolve('cs_explanation_keywords.json'), 'utf8')) as Record<string, string[]>
const explanations = JSON.parse(readFileSync(resolve('cs_explanations.json'), 'utf8')) as Record<string, string>
const colorsByTerm = JSON.parse(readFileSync(resolve('cs_card_colors.json'), 'utf8')) as Record<string, { light: string; dark: string; accent: string }>

const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
if (!databaseUrl) throw new Error('Set DATABASE_URL_UNPOOLED (preferred) or DATABASE_URL before seeding.')

const topicStarts: [string, string][] = [
  ['program', 'Programming'], ['array', 'Data structures'], ['binary_search', 'Algorithms'],
  ['time_complexity', 'Complexity'], ['operating_system', 'Operating systems'], ['cpu', 'Computer architecture'],
  ['network', 'Networking'], ['frontend', 'Web & APIs'], ['database', 'Databases'],
  ['distributed_system', 'Distributed systems'], ['scalability', 'System design'], ['cloud_computing', 'Cloud & DevOps'],
  ['version_control', 'Git'], ['object', 'Object-oriented design'], ['async', 'Asynchronous programming'],
  ['cybersecurity', 'Security'], ['artificial_intelligence', 'Machine learning'], ['transformer', 'Generative AI'],
  ['bit', 'Memory & data'], ['shell', 'Shell & processes'],
]
const topicIds = new Map(topicStarts.map(([term], index) => [term, `topic_${index + 1}`]))
const topicNames = new Map(topicStarts.map(([term, name]) => [term, name]))
const allTerms = Object.entries(keywordsByTerm)
const dataKeys = [new Set(Object.keys(explanations)), new Set(Object.keys(colorsByTerm))]
for (const keys of dataKeys) {
  const missing = allTerms.map(([term]) => term).filter(term => !keys.has(term))
  if (missing.length) throw new Error(`Data is missing ${missing.length} entries, including ${missing.slice(0, 5).join(', ')}`)
}

const dbTopics: { id: string; name: string; position: number }[] = []
let currentTopicId = 'topic_1'
let currentTopicName = topicStarts[0][1]
const termRows = allTerms.map(([id, termKeywordsList], position) => {
  const startName = topicNames.get(id)
  const startId = topicIds.get(id)
  if (startName && startId) {
    currentTopicName = startName
    currentTopicId = startId
    dbTopics.push({ id: startId, name: startName, position: dbTopics.length })
  }
  const palette = colorsByTerm[id]
  return {
    id,
    displayName: id.split('_').map(part => part.length <= 3 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)).join(' '),
    explanation: explanations[id],
    topicId: currentTopicId,
    position,
    colorLight: palette.light,
    colorDark: palette.dark,
    colorAccent: palette.accent,
  }
})
const keywordRows = allTerms.flatMap(([termId, words]) => words.map((keyword, position) => ({ termId, keyword, position })))

const pool = new pg.Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } })
const db = drizzle(pool)
try {
  await db.transaction(async tx => {
    await tx.insert(topics).values(dbTopics).onConflictDoUpdate({
      target: topics.id,
      set: { name: sql`excluded.name`, position: sql`excluded.position` },
    })
    await tx.insert(terms).values(termRows).onConflictDoUpdate({
      target: terms.id,
      set: {
        displayName: sql`excluded.display_name`, explanation: sql`excluded.explanation`,
        topicId: sql`excluded.topic_id`, position: sql`excluded.position`, colorLight: sql`excluded.color_light`,
        colorDark: sql`excluded.color_dark`, colorAccent: sql`excluded.color_accent`, updatedAt: new Date(),
      },
    })
    await tx.delete(termKeywords)
    await tx.insert(termKeywords).values(keywordRows)
  })
  console.log(`Seeded ${termRows.length} terms, ${keywordRows.length} keywords, and ${dbTopics.length} topics.`)
} finally {
  await pool.end()
}
