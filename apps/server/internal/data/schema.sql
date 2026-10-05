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
ALTER TABLE users ADD COLUMN IF NOT EXISTS role text CHECK (role IN ('teacher','student'));
-- Development accounts without a selected identity are discarded before making identity mandatory.
DELETE FROM users WHERE role IS NULL;
ALTER TABLE users ALTER COLUMN role SET NOT NULL;
CREATE TABLE IF NOT EXISTS classes (
 id uuid PRIMARY KEY,
 name text NOT NULL,
 head_teacher_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 invitation_code text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS class_members (
 class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 joined_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(class_id,user_id)
);
CREATE INDEX IF NOT EXISTS class_members_user ON class_members(user_id);
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
CREATE TABLE IF NOT EXISTS deliverables (
 id uuid PRIMARY KEY,
 course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 content jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS deliverables_course ON deliverables(course_id);
CREATE TABLE IF NOT EXISTS deliverable_requests (
 course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 request_id text NOT NULL,
 fingerprint text NOT NULL,
 result jsonb NOT NULL,
 PRIMARY KEY(course_id, request_id)
);
CREATE TABLE IF NOT EXISTS deliverable_images (
 id uuid PRIMARY KEY,
 course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 object_key text NOT NULL
);
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
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 course_id uuid REFERENCES courses(id) ON DELETE CASCADE,
 section_id uuid REFERENCES course_sections(id) ON DELETE CASCADE,
 title text NOT NULL,
 state jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE course_conversations ADD COLUMN IF NOT EXISTS user_id text REFERENCES users(id) ON DELETE CASCADE;
UPDATE course_conversations cc SET user_id=c.user_id FROM courses c WHERE cc.course_id=c.id AND cc.user_id IS NULL;
ALTER TABLE course_conversations ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE course_conversations ALTER COLUMN course_id DROP NOT NULL;
ALTER TABLE course_conversations ALTER COLUMN section_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS course_conversations_user ON course_conversations(user_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS course_conversations_section ON course_conversations(section_id,created_at);
CREATE INDEX IF NOT EXISTS course_conversations_course_updated ON course_conversations(course_id,updated_at DESC);
-- Convert stored page navigation once; the application reads only presentations.
UPDATE course_conversations
SET state = (state - 'presentedPageIds' - 'currentPageId') || jsonb_build_object(
 'presentations', COALESCE((
   SELECT jsonb_agg(jsonb_build_object('id', page_id, 'pageId', page_id) ORDER BY position)
   FROM jsonb_array_elements_text(state->'presentedPageIds') WITH ORDINALITY AS pages(page_id, position)
 ), '[]'::jsonb),
 'currentPresentationId', COALESCE(state->>'currentPageId', ''),
 'messages', COALESCE((
   SELECT jsonb_agg(CASE
     WHEN message->>'pageId' IS NOT NULL AND (state->'presentedPageIds') ? (message->>'pageId')
     THEN message || jsonb_build_object('presentationId', message->>'pageId')
     ELSE message END ORDER BY position)
   FROM jsonb_array_elements(state->'messages') WITH ORDINALITY AS messages(message, position)
 ), '[]'::jsonb)
)
WHERE state ? 'presentedPageIds' AND NOT state ? 'presentations';
CREATE TABLE IF NOT EXISTS course_outline_reorganizations (
 id uuid PRIMARY KEY,
 course_id uuid NOT NULL UNIQUE REFERENCES courses(id) ON DELETE CASCADE,
 sections jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS course_outline_assignments (
 reorganization_id uuid NOT NULL REFERENCES course_outline_reorganizations(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL REFERENCES course_conversations(id) ON DELETE CASCADE,
 conversation_updated_at timestamptz NOT NULL,
 target_section_id uuid,
 reason text NOT NULL DEFAULT '',
 PRIMARY KEY(reorganization_id,conversation_id)
);
CREATE INDEX IF NOT EXISTS course_outline_assignments_pending ON course_outline_assignments(reorganization_id) WHERE target_section_id IS NULL;
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
ALTER TABLE course_materials ADD COLUMN IF NOT EXISTS parse_revision integer NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS course_material_parses (
 material_id uuid NOT NULL REFERENCES course_materials(id) ON DELETE CASCADE,
 revision integer NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','ready','partial','failed')),
 document jsonb,
 error text NOT NULL DEFAULT '',
 lease_token text,
 lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(material_id,revision)
);
INSERT INTO course_material_parses(material_id,revision)
 SELECT id,parse_revision FROM course_materials ON CONFLICT DO NOTHING;
CREATE INDEX IF NOT EXISTS course_material_parses_pending ON course_material_parses(created_at) WHERE status IN ('pending','processing');
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
CREATE TABLE IF NOT EXISTS course_illustrations (
 id uuid PRIMARY KEY,
 course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL REFERENCES course_conversations(id) ON DELETE CASCADE,
 page_id text NOT NULL,
 title text NOT NULL,
 alt text NOT NULL,
 prompt text NOT NULL,
 model_id text NOT NULL,
 status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','complete','failed','cancelled')),
 object_key text NOT NULL DEFAULT '',
 error text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(conversation_id,page_id)
);
ALTER TABLE course_illustrations DROP COLUMN IF EXISTS provider_task_id;
CREATE INDEX IF NOT EXISTS course_illustrations_course ON course_illustrations(course_id,created_at DESC);

CREATE TABLE IF NOT EXISTS agent_sessions (
 id uuid PRIMARY KEY,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('course','profile')),
 course_id text NOT NULL DEFAULT '',
 conversation_id text NOT NULL DEFAULT '',
 revision integer NOT NULL DEFAULT 1,
 state jsonb NOT NULL,
 grant_token text NOT NULL DEFAULT '',
 lease_until timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_sessions_conversation ON agent_sessions(user_id,kind,conversation_id) WHERE conversation_id<>'';
CREATE INDEX IF NOT EXISTS agent_sessions_user ON agent_sessions(user_id,id);
