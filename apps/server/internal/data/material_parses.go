package data

import (
	"context"
	"encoding/json"

	"github.com/LanternCX/zhiya/apps/server/internal/identifier"
	"github.com/jackc/pgx/v5"
)

type MaterialParse struct {
	MaterialID string
	Revision   int
	Status     string
	Document   json.RawMessage
	Error      string
	Token      string
	Name       string
	ObjectKey  string
}

func (m MaterialModel) Parse(ctx context.Context, materialID string, revision int) (MaterialParse, error) {
	p := MaterialParse{MaterialID: materialID, Revision: revision}
	err := m.db.QueryRow(ctx, `SELECT status,document,error FROM course_material_parses WHERE material_id=$1 AND revision=$2`, materialID, revision).Scan(&p.Status, &p.Document, &p.Error)
	if err == pgx.ErrNoRows {
		err = ErrMaterialNotFound
	}
	return p, err
}

// ClaimParse leases work in one statement; no transaction stays open during conversion or inference.
func (m MaterialModel) ClaimParse(ctx context.Context) (MaterialParse, error) {
	return m.claimParse(ctx, "", 0)
}

func (m MaterialModel) ClaimMaterialParse(ctx context.Context, materialID string, revision int) (MaterialParse, error) {
	return m.claimParse(ctx, materialID, revision)
}

func (m MaterialModel) claimParse(ctx context.Context, materialID string, revision int) (MaterialParse, error) {
	p := MaterialParse{Token: identifier.New()}
	err := m.db.QueryRow(ctx, `WITH job AS (
 SELECT material_id,revision FROM course_material_parses
 WHERE (status='pending' OR (status='processing' AND lease_until<now()))
 AND ($2='' OR (material_id::text=$2 AND revision=$3))
 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
), claimed AS (
 UPDATE course_material_parses p SET status='processing',lease_token=$1,lease_until=now()+interval '16 minutes'
 FROM job WHERE p.material_id=job.material_id AND p.revision=job.revision
 RETURNING p.material_id,p.revision
) SELECT c.material_id,c.revision,m.name,m.object_key FROM claimed c JOIN course_materials m ON m.id=c.material_id`, p.Token, materialID, revision).Scan(&p.MaterialID, &p.Revision, &p.Name, &p.ObjectKey)
	return p, err
}

func (m MaterialModel) FinishParse(ctx context.Context, p MaterialParse) error {
	_, err := m.db.Exec(ctx, `UPDATE course_material_parses SET status=$4,document=$5,error=$6,lease_token=NULL,lease_until=NULL
 WHERE material_id=$1 AND revision=$2 AND lease_token=$3 AND status='processing'`, p.MaterialID, p.Revision, p.Token, p.Status, p.Document, p.Error)
	return err
}

func (m MaterialModel) ReleaseParse(ctx context.Context, p MaterialParse) error {
	_, err := m.db.Exec(ctx, `UPDATE course_material_parses SET status='pending',lease_token=NULL,lease_until=NULL
 WHERE material_id=$1 AND revision=$2 AND lease_token=$3 AND status='processing'`, p.MaterialID, p.Revision, p.Token)
	return err
}

func (m MaterialModel) CompleteTextParse(ctx context.Context, materialID string, document json.RawMessage) error {
	_, err := m.db.Exec(ctx, `UPDATE course_material_parses SET status='ready',document=$2 WHERE material_id=$1 AND revision=1 AND status='pending'`, materialID, document)
	return err
}

// Called inside the owner's transaction. Concurrent retries reuse pending work.
func (m MaterialModel) RetryParse(ctx context.Context, materialID string) (int, error) {
	var revision int
	if err := m.db.QueryRow(ctx, `SELECT parse_revision FROM course_materials WHERE id=$1 FOR UPDATE`, materialID).Scan(&revision); err != nil {
		return 0, err
	}
	p, err := m.Parse(ctx, materialID, revision)
	if err != nil {
		return 0, err
	}
	if p.Status == "pending" || p.Status == "processing" {
		return revision, nil
	}
	revision++
	if _, err = m.db.Exec(ctx, `INSERT INTO course_material_parses(material_id,revision) VALUES($1,$2)`, materialID, revision); err != nil {
		return 0, err
	}
	_, err = m.db.Exec(ctx, `UPDATE course_materials SET parse_revision=$2 WHERE id=$1`, materialID, revision)
	return revision, err
}
