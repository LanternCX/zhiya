CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS corpus_versions (
 id text PRIMARY KEY, model text NOT NULL, status text NOT NULL DEFAULT 'importing',
 created_at timestamptz NOT NULL DEFAULT now(), active boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_corpus ON corpus_versions(active) WHERE active;
CREATE TABLE IF NOT EXISTS corpus_documents (
 version text REFERENCES corpus_versions(id), id text NOT NULL, metadata jsonb NOT NULL,
 PRIMARY KEY(version,id)
);
CREATE TABLE IF NOT EXISTS corpus_assets (
 version text REFERENCES corpus_versions(id), path text NOT NULL, object_key text NOT NULL,
 sha256 text NOT NULL, size_bytes bigint NOT NULL, media_type text NOT NULL,
 PRIMARY KEY(version,path)
);
CREATE TABLE IF NOT EXISTS corpus_blocks (
 version text NOT NULL, id text NOT NULL, document_id text NOT NULL,
 metadata jsonb NOT NULL, embedding vector, visual_description jsonb,
 PRIMARY KEY(version,id), FOREIGN KEY(version,document_id) REFERENCES corpus_documents(version,id)
);
CREATE TABLE IF NOT EXISTS corpus_indexes (
 version text REFERENCES corpus_versions(id), id text NOT NULL, model text NOT NULL,
 revision text NOT NULL, route text NOT NULL CHECK(route IN ('text','visual')),
 dimension integer NOT NULL CHECK(dimension=4096), instruction text NOT NULL,
 metadata jsonb NOT NULL, PRIMARY KEY(version,id)
);
ALTER TABLE corpus_blocks ADD COLUMN IF NOT EXISTS index_id text;
CREATE INDEX IF NOT EXISTS corpus_block_vectors_native ON corpus_blocks USING hnsw
 ((binary_quantize(embedding)::bit(4096)) bit_hamming_ops) WHERE embedding IS NOT NULL AND vector_dims(embedding)=4096;
