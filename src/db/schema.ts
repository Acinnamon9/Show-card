import { integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

export const topics = pgTable('topics', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  position: integer('position').notNull().unique(),
})

export const terms = pgTable('terms', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  explanation: text('explanation').notNull(),
  topicId: text('topic_id').notNull().references(() => topics.id, { onDelete: 'restrict' }),
  position: integer('position').notNull().unique(),
  colorLight: text('color_light').notNull(),
  colorDark: text('color_dark').notNull(),
  colorAccent: text('color_accent').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const termKeywords = pgTable('term_keywords', {
  termId: text('term_id').notNull().references(() => terms.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  keyword: text('keyword').notNull(),
}, table => [primaryKey({ columns: [table.termId, table.position] })])

export const studyProgress = pgTable('study_progress', {
  learnerId: text('learner_id').notNull(),
  termId: text('term_id').notNull().references(() => terms.id, { onDelete: 'cascade' }),
  seen: integer('seen').notNull().default(0),
  streak: integer('streak').notNull().default(0),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull().defaultNow(),
  lastRating: text('last_rating').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.learnerId, table.termId] })])
