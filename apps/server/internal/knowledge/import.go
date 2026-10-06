package knowledge

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/LanternCX/zhiya/apps/server/internal/objectstore"
	"github.com/jackc/pgx/v5"
)

type Index struct {
	ID          string `json:"id"`
	Model       string `json:"model"`
	Revision    string `json:"revision"`
	Route       string `json:"route"`
	Dimension   int    `json:"dimension"`
	Instruction string `json:"instruction"`
	Count       int    `json:"count"`
	Normalized  bool   `json:"normalized"`
}
type ImportOptions struct {
	CatalogPath string
	Embeddings  []io.Reader
	Progress    func(string, int, int)
}
type ImportResult struct {
	Version     string `json:"version"`
	Documents   int    `json:"documents"`
	Blocks      int    `json:"blocks"`
	Vectors     int    `json:"vectors"`
	PendingText int    `json:"pendingText"`
	Active      bool   `json:"active"`
}
type CatalogFile struct {
	Path   string `json:"path"`
	Key    string `json:"key"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}
type storedVector struct {
	ChunkID    string    `json:"chunk_id"`
	DocumentID string    `json:"document_id"`
	Modality   string    `json:"modality"`
	Embedding  []float64 `json:"embedding"`
	IndexID    string
}

func readJSONL[T any](path string) ([]T, [][]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, nil, err
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 65536), 8<<20)
	var rows []T
	var raw [][]byte
	for scanner.Scan() {
		line := append([]byte(nil), scanner.Bytes()...)
		var row T
		if err = json.Unmarshal(line, &row); err != nil {
			return nil, nil, err
		}
		rows = append(rows, row)
		raw = append(raw, line)
	}
	return rows, raw, scanner.Err()
}

// Import links pre-uploaded objects and existing vectors. It never runs inference.
// Validation precedes a single transaction, so failed imports remain invisible.
func Import(ctx context.Context, root string, repository *Repository, objects objectstore.Store, options ImportOptions) (ImportResult, error) {
	var result ImportResult
	docs, docRaw, err := readJSONL[Document](filepath.Join(root, "documents.jsonl"))
	if err != nil {
		return result, err
	}
	blocks, blockRaw, err := readJSONL[Block](filepath.Join(root, "chunks.jsonl"))
	if err != nil {
		return result, err
	}
	if len(docs) == 0 || len(blocks) == 0 {
		return result, fmt.Errorf("资料集不能为空")
	}
	docIDs := map[string]bool{}
	byID := map[string]Block{}
	for _, doc := range docs {
		if doc.ID == "" || docIDs[doc.ID] {
			return result, fmt.Errorf("文档 ID 缺失或重复")
		}
		docIDs[doc.ID] = true
	}
	for _, block := range blocks {
		if block.ID == "" || byID[block.ID].ID != "" || !docIDs[block.DocumentID] {
			return result, fmt.Errorf("block ID 或文档关联无效：%s", block.ID)
		}
		byID[block.ID] = block
	}
	for _, block := range blocks {
		for _, id := range block.Associated {
			if byID[id].ID == "" {
				return result, fmt.Errorf("关联文本缺失：%s", id)
			}
		}
	}
	content, err := os.ReadFile(options.CatalogPath)
	if err != nil {
		return result, fmt.Errorf("需要已上传对象的目录清单：%w", err)
	}
	checksum := sha256.Sum256(content)
	result.Version = hex.EncodeToString(checksum[:])
	var catalog struct {
		Format string        `json:"format"`
		Files  []CatalogFile `json:"files"`
	}
	if err = json.Unmarshal(content, &catalog); err != nil || catalog.Format != "zhiya-knowledge-object-catalog-v1" {
		return result, fmt.Errorf("对象目录清单格式无效")
	}
	assets := map[string]CatalogFile{}
	for _, file := range catalog.Files {
		if !strings.HasPrefix(file.Path, "knowledge/") {
			continue
		}
		path := strings.TrimPrefix(file.Path, "knowledge/")
		if !filepath.IsLocal(path) || file.Size < 0 || len(file.SHA256) != 64 || file.Key != "blobs/sha256/"+file.SHA256 || assets[path].Path != "" {
			return result, fmt.Errorf("对象路径或指纹无效")
		}
		assets[path] = file
	}
	for _, doc := range docs {
		file, ok := assets[doc.OriginalPath]
		if !ok || doc.SHA256 != "" && doc.SHA256 != file.SHA256 {
			return result, fmt.Errorf("原文件关联或指纹无效：%s", doc.ID)
		}
	}
	for _, block := range blocks {
		paths := append([]string{}, block.Frames...)
		if block.AssetPath != "" {
			paths = append(paths, block.AssetPath)
		}
		for _, path := range paths {
			if _, ok := assets[path]; !ok {
				return result, fmt.Errorf("block 文件缺失：%s", block.ID)
			}
		}
	}
	for name, local := range map[string][]byte{"documents.jsonl": joinJSONL(docRaw), "chunks.jsonl": joinJSONL(blockRaw)} {
		sum := sha256.Sum256(local)
		file, ok := assets[name]
		if !ok || file.SHA256 != hex.EncodeToString(sum[:]) {
			return result, fmt.Errorf("资料清单与桶中目录不一致：%s", name)
		}
	}
	vectors := map[string]storedVector{}
	var profiles []Index
	var profileRaw [][]byte
	routes := map[string]bool{}
	for _, reader := range options.Embeddings {
		decoder := json.NewDecoder(reader)
		var profile Index
		if err = decoder.Decode(&profile); err != nil {
			return result, err
		}
		if profile.ID == "" || !profile.Normalized || profile.Count < 1 || strings.TrimSpace(profile.Revision) == "" || routes[profile.Route] ||
			(profile.Route == "visual" && (profile.Model != "Qwen/Qwen3-VL-Embedding-8B" || profile.Dimension != Dimension || len(profile.Revision) != 40 || profile.Instruction != "Represent the user's input.")) ||
			(profile.Route == "text" && (profile.Model != "Qwen/Qwen3-Embedding-8B" || profile.Dimension != Dimension || len(profile.Revision) != 40 || profile.Instruction != "")) ||
			(profile.Route != "text" && profile.Route != "visual") {
			return result, fmt.Errorf("不支持的离线向量配置")
		}
		routes[profile.Route] = true
		count := 0
		for {
			var vector storedVector
			if err = decoder.Decode(&vector); err == io.EOF {
				break
			}
			if err != nil {
				return result, err
			}
			block, ok := byID[vector.ChunkID]
			if !ok || !block.Candidate || block.DocumentID != vector.DocumentID || block.Modality != vector.Modality || vectors[vector.ChunkID].ChunkID != "" ||
				(profile.Route == "text" && block.Modality != "text") || (profile.Route == "visual" && block.Modality != "image" && block.Modality != "video") {
				return result, fmt.Errorf("向量与资料 block 不匹配：%s", vector.ChunkID)
			}
			vector.Embedding, err = normalize(vector.Embedding, profile.Dimension)
			if err != nil {
				return result, err
			}
			vector.IndexID = profile.ID
			vectors[vector.ChunkID] = vector
			count++
		}
		if count != profile.Count {
			return result, fmt.Errorf("向量数量与任务清单不一致")
		}
		profiles = append(profiles, profile)
		raw, _ := json.Marshal(profile)
		profileRaw = append(profileRaw, raw)
	}
	if len(profiles) == 0 {
		return result, fmt.Errorf("必须提供现有离线向量；导入不会重新编码")
	}
	for _, block := range blocks {
		if !block.Candidate {
			continue
		}
		if _, ok := vectors[block.ID]; !ok {
			if block.Modality == "text" && !routes["text"] {
				result.PendingText++
				continue
			}
			return result, fmt.Errorf("已选输入缺少离线向量：%s", block.ID)
		}
	}
	if repository == nil || objects == nil {
		return result, fmt.Errorf("导入服务未配置")
	}
	body, _, err := objects.Open(ctx, "corpus/"+result.Version+"/catalog.json")
	if err != nil {
		return result, fmt.Errorf("桶中资料目录不可读取：%w", err)
	}
	remote, err := io.ReadAll(io.LimitReader(body, int64(len(content))+1))
	body.Close()
	if err != nil || string(remote) != string(content) {
		return result, fmt.Errorf("桶中目录与本地目录不一致")
	}
	tx, err := repository.Pool.Begin(ctx)
	if err != nil {
		return result, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(850001)`); err != nil {
		return result, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO corpus_versions(id,model,status) VALUES($1,'offline-indices','importing') ON CONFLICT DO NOTHING`, result.Version); err != nil {
		return result, err
	}
	for i, profile := range profiles {
		if _, err = tx.Exec(ctx, `INSERT INTO corpus_indexes(version,id,model,revision,route,dimension,instruction,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`, result.Version, profile.ID, profile.Model, profile.Revision, profile.Route, profile.Dimension, profile.Instruction, profileRaw[i]); err != nil {
			return result, err
		}
	}
	for _, table := range []string{"corpus_documents", "corpus_assets", "corpus_blocks"} {
		if _, err = tx.Exec(ctx, `CREATE TEMP TABLE import_`+table+` (LIKE `+table+` INCLUDING DEFAULTS) ON COMMIT DROP`); err != nil {
			return result, err
		}
	}
	_, err = tx.CopyFrom(ctx, pgx.Identifier{"import_corpus_documents"}, []string{"version", "id", "metadata"}, pgx.CopyFromSlice(len(docs), func(i int) ([]any, error) { return []any{result.Version, docs[i].ID, docRaw[i]}, nil }))
	if err != nil {
		return result, err
	}
	var files []CatalogFile
	for path, file := range assets {
		file.Path = path
		files = append(files, file)
	}
	_, err = tx.CopyFrom(ctx, pgx.Identifier{"import_corpus_assets"}, []string{"version", "path", "object_key", "sha256", "size_bytes", "media_type"}, pgx.CopyFromSlice(len(files), func(i int) ([]any, error) {
		file := files[i]
		media := mime.TypeByExtension(filepath.Ext(file.Path))
		if media == "" {
			media = "application/octet-stream"
		}
		return []any{result.Version, file.Path, file.Key, file.SHA256, file.Size, media}, nil
	}))
	if err != nil {
		return result, err
	}
	_, err = tx.CopyFrom(ctx, pgx.Identifier{"import_corpus_blocks"}, []string{"version", "id", "document_id", "metadata", "index_id"}, pgx.CopyFromSlice(len(blocks), func(i int) ([]any, error) {
		var index any
		if vector, ok := vectors[blocks[i].ID]; ok {
			index = vector.IndexID
		}
		return []any{result.Version, blocks[i].ID, blocks[i].DocumentID, blockRaw[i], index}, nil
	}))
	if err != nil {
		return result, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO corpus_documents SELECT * FROM import_corpus_documents ON CONFLICT(version,id) DO UPDATE SET metadata=EXCLUDED.metadata;
 INSERT INTO corpus_assets SELECT * FROM import_corpus_assets ON CONFLICT(version,path) DO NOTHING;
 INSERT INTO corpus_blocks SELECT * FROM import_corpus_blocks ON CONFLICT(version,id) DO UPDATE SET metadata=EXCLUDED.metadata,index_id=EXCLUDED.index_id`); err != nil {
		return result, err
	}
	batch := &pgx.Batch{}
	for id, vector := range vectors {
		batch.Queue(`UPDATE corpus_blocks SET embedding=$3::vector WHERE version=$1 AND id=$2`, result.Version, id, vectorLiteral(vector.Embedding))
	}
	if err = tx.SendBatch(ctx, batch).Close(); err != nil {
		return result, err
	}
	if _, err = tx.Exec(ctx, `UPDATE corpus_versions SET active=false WHERE active`); err != nil {
		return result, err
	}
	if _, err = tx.Exec(ctx, `UPDATE corpus_versions SET active=true,status='ready' WHERE id=$1`, result.Version); err != nil {
		return result, err
	}
	if err = tx.Commit(ctx); err != nil {
		return result, err
	}
	result.Documents = len(docs)
	result.Blocks = len(blocks)
	result.Vectors = len(vectors)
	result.Active = true
	if options.Progress != nil {
		options.Progress("imported", result.Vectors, result.Vectors)
	}
	return result, nil
}

func joinJSONL(lines [][]byte) []byte {
	var result []byte
	for _, line := range lines {
		result = append(result, line...)
		result = append(result, '\n')
	}
	return result
}

// OpenDatabase uses the existing PostgreSQL instance and an isolated database.
func OpenDatabase(ctx context.Context, connectionURL string) (*Repository, error) {
	parsed, err := url.Parse(connectionURL)
	if err != nil {
		return nil, err
	}
	name := strings.TrimPrefix(parsed.Path, "/")
	if name == "" {
		return nil, fmt.Errorf("knowledge database name is required")
	}
	parsed.Path = "/postgres"
	admin, err := pgx.Connect(ctx, parsed.String())
	if err != nil {
		return nil, fmt.Errorf("cannot connect to PostgreSQL")
	}
	var exists bool
	err = admin.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname=$1)`, name).Scan(&exists)
	if err == nil && !exists {
		_, err = admin.Exec(ctx, `CREATE DATABASE `+pgx.Identifier{name}.Sanitize())
	}
	admin.Close(ctx)
	if err != nil {
		return nil, err
	}
	return connectRepository(ctx, connectionURL)
}
