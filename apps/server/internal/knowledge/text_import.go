package knowledge

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/jackc/pgx/v5"
)

// ReplaceTextEmbeddings streams completed vectors into the active corpus.
// Original blocks and assets remain stable; failed replacements roll back.
func ReplaceTextEmbeddings(ctx context.Context, repository *Repository, reader io.Reader, progress func(int)) (ImportResult, error) {
	var result ImportResult
	decoder := json.NewDecoder(reader)
	var profile Index
	if err := decoder.Decode(&profile); err != nil {
		return result, err
	}
	if profile.ID == "" || profile.Model != "Qwen/Qwen3-Embedding-8B" || profile.Route != "text" ||
		profile.Dimension != Dimension || !profile.Normalized || profile.Count < 1 ||
		len(profile.Revision) != 40 || profile.Instruction != "" {
		return result, fmt.Errorf("需要已完成的 Qwen3-Embedding-8B 原生 4096 维文本向量")
	}
	if repository == nil {
		return result, fmt.Errorf("知识库未配置")
	}
	tx, err := repository.Pool.Begin(ctx)
	if err != nil {
		return result, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(850001)`); err != nil {
		return result, err
	}
	if err = tx.QueryRow(ctx, `SELECT id FROM corpus_versions WHERE active AND status='ready'`).Scan(&result.Version); err != nil {
		return result, fmt.Errorf("需要先导入可用的资料目录：%w", err)
	}
	// COPY uses real[] to avoid retaining vectors in Go memory or decimal text on disk.
	if _, err = tx.Exec(ctx, `CREATE TEMP TABLE replacement_text_vectors (
 id text PRIMARY KEY, document_id text NOT NULL, embedding real[] NOT NULL
 ) ON COMMIT DROP`); err != nil {
		return result, err
	}
	count := 0
	rows := pgx.CopyFromFunc(func() ([]any, error) {
		var vector storedVector
		if err := decoder.Decode(&vector); err == io.EOF {
			return nil, nil
		} else if err != nil {
			return nil, err
		}
		if strings.TrimSpace(vector.ChunkID) == "" || vector.DocumentID == "" || vector.Modality != "text" {
			return nil, fmt.Errorf("文本向量的来源标识或类型无效")
		}
		values, err := normalize(vector.Embedding, Dimension)
		if err != nil {
			return nil, err
		}
		compact := make([]float32, len(values))
		for i, value := range values {
			compact[i] = float32(value)
		}
		count++
		if progress != nil && count%5000 == 0 {
			progress(count)
		}
		return []any{vector.ChunkID, vector.DocumentID, compact}, nil
	})
	if _, err = tx.CopyFrom(ctx, pgx.Identifier{"replacement_text_vectors"}, []string{"id", "document_id", "embedding"}, rows); err != nil {
		return result, err
	}
	if count != profile.Count {
		return result, fmt.Errorf("文本向量数量与任务清单不一致")
	}
	var invalid bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS (
 SELECT 1 FROM replacement_text_vectors t LEFT JOIN corpus_blocks b ON b.version=$1 AND b.id=t.id
 WHERE b.id IS NULL OR b.document_id<>t.document_id OR b.metadata->>'modality'<>'text'
 OR b.metadata->>'default_embedding_candidate' IS DISTINCT FROM 'true'
 ) OR EXISTS (
 SELECT 1 FROM corpus_blocks b LEFT JOIN replacement_text_vectors t ON b.id=t.id
 WHERE b.version=$1 AND b.metadata->>'modality'='text'
 AND b.metadata->>'default_embedding_candidate'='true' AND t.id IS NULL
 )`, result.Version).Scan(&invalid); err != nil {
		return result, err
	}
	if invalid {
		return result, fmt.Errorf("文本向量与已上传资料的 block 或文档不匹配，或缺少已选文本")
	}
	raw, err := json.Marshal(profile)
	if err != nil {
		return result, err
	}
	if _, err = tx.Exec(ctx, `UPDATE corpus_blocks b SET embedding=NULL,index_id=NULL
	 FROM corpus_indexes i WHERE b.version=$1 AND i.version=b.version AND i.id=b.index_id AND i.route='text'`, result.Version); err != nil {
		return result, err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM corpus_indexes WHERE version=$1 AND route='text'`, result.Version); err != nil {
		return result, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO corpus_indexes(version,id,model,revision,route,dimension,instruction,metadata)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, result.Version, profile.ID, profile.Model, profile.Revision,
		profile.Route, profile.Dimension, profile.Instruction, raw); err != nil {
		return result, err
	}
	if _, err = tx.Exec(ctx, `UPDATE corpus_blocks b SET embedding=t.embedding::vector,index_id=$2
 FROM replacement_text_vectors t WHERE b.version=$1 AND b.id=t.id`, result.Version, profile.ID); err != nil {
		return result, err
	}
	if err = tx.Commit(ctx); err != nil {
		return result, err
	}
	result.Vectors, result.Active = count, true
	return result, nil
}
