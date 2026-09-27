CREATE TABLE "study_progress" (
	"learner_id" text NOT NULL,
	"term_id" text NOT NULL,
	"seen" integer DEFAULT 0 NOT NULL,
	"streak" integer DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_rating" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_progress_learner_id_term_id_pk" PRIMARY KEY("learner_id","term_id")
);
--> statement-breakpoint
CREATE TABLE "term_keywords" (
	"term_id" text NOT NULL,
	"position" integer NOT NULL,
	"keyword" text NOT NULL,
	CONSTRAINT "term_keywords_term_id_position_pk" PRIMARY KEY("term_id","position")
);
--> statement-breakpoint
CREATE TABLE "terms" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"explanation" text NOT NULL,
	"topic_id" text NOT NULL,
	"position" integer NOT NULL,
	"color_light" text NOT NULL,
	"color_dark" text NOT NULL,
	"color_accent" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "terms_position_unique" UNIQUE("position")
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "topics_name_unique" UNIQUE("name"),
	CONSTRAINT "topics_position_unique" UNIQUE("position")
);
--> statement-breakpoint
ALTER TABLE "study_progress" ADD CONSTRAINT "study_progress_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term_keywords" ADD CONSTRAINT "term_keywords_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE restrict ON UPDATE no action;