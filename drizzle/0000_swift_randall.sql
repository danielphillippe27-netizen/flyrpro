CREATE TABLE IF NOT EXISTS "editor_project" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"userId" uuid NOT NULL,
	"json" text NOT NULL,
	"height" integer NOT NULL,
	"width" integer NOT NULL,
	"thumbnailUrl" text,
	"isTemplate" boolean DEFAULT false,
	"isPro" boolean DEFAULT false,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
