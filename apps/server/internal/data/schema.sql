CREATE TABLE IF NOT EXISTS users (
 id text PRIMARY KEY,
 email text NOT NULL UNIQUE,
 password_hash text NOT NULL,
 nickname text NOT NULL,
 avatar bytea,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS socket_tickets (
 token_hash text PRIMARY KEY,
 session_hash text NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS challenges (
 id text PRIMARY KEY,
 purpose text NOT NULL,
 email text NOT NULL,
 new_email text NOT NULL DEFAULT '',
 user_id text REFERENCES users(id) ON DELETE CASCADE,
 code_hash text NOT NULL,
 new_code_hash text NOT NULL DEFAULT '',
 attempts integer NOT NULL DEFAULT 0,
 expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS challenges_user ON challenges(user_id);
CREATE TABLE IF NOT EXISTS auth_limits (
 key text PRIMARY KEY,
 count integer NOT NULL,
 expires_at timestamptz NOT NULL
);

-- Defaults controlled by configuration are supplied explicitly by the application.
ALTER TABLE sessions ALTER COLUMN expires_at DROP DEFAULT;
ALTER TABLE challenges ALTER COLUMN expires_at DROP DEFAULT;
ALTER TABLE users ALTER COLUMN nickname DROP DEFAULT;

CREATE TABLE IF NOT EXISTS conversations (
 id uuid PRIMARY KEY,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 purpose text NOT NULL,
 state jsonb NOT NULL,
 UNIQUE(user_id, purpose)
);
CREATE TABLE IF NOT EXISTS conversation_messages (
 conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 sequence integer NOT NULL,
 message jsonb NOT NULL,
 PRIMARY KEY(conversation_id, sequence)
);
CREATE TABLE IF NOT EXISTS conversation_requests (
 conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 request_id text NOT NULL,
 response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(conversation_id, request_id)
);
CREATE TABLE IF NOT EXISTS student_memories (
 user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 content text NOT NULL DEFAULT '',
 version integer NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS courses (
 id uuid PRIMARY KEY,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title text NOT NULL,
 topic text NOT NULL,
 cover_motif text NOT NULL,
 cover_palette text NOT NULL,
 cover_label text NOT NULL,
 status text NOT NULL DEFAULT 'active',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS courses_user_updated ON courses(user_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS course_sections (
 id uuid PRIMARY KEY,
 course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 title text NOT NULL,
 objective text NOT NULL,
 position integer NOT NULL,
 status text NOT NULL DEFAULT 'planned',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(course_id,position)
);
CREATE INDEX IF NOT EXISTS course_sections_course ON course_sections(course_id,position);
CREATE TABLE IF NOT EXISTS course_conversations (
 id uuid PRIMARY KEY,
 course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 section_id uuid NOT NULL REFERENCES course_sections(id) ON DELETE CASCADE,
 title text NOT NULL,
 state jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS course_conversations_section ON course_conversations(section_id,created_at);
CREATE INDEX IF NOT EXISTS course_conversations_course_updated ON course_conversations(course_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS course_materials (
 id uuid PRIMARY KEY,
 course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 name text NOT NULL,
 media_type text NOT NULL,
 object_key text NOT NULL UNIQUE,
 size_bytes bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS course_materials_course_created ON course_materials(course_id,created_at DESC);
CREATE TABLE IF NOT EXISTS course_material_uploads (
 id uuid PRIMARY KEY,
 course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 name text NOT NULL,
 media_type text NOT NULL,
 object_key text NOT NULL UNIQUE,
 size_bytes bigint NOT NULL,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS course_material_uploads_expiry ON course_material_uploads(expires_at);
