package data

import "context"

type DeliverableShare struct {
	Token         string `json:"token"`
	Visibility    string `json:"visibility"`
	CourseID      string `json:"-"`
	DeliverableID string `json:"-"`
	OwnerID       string `json:"-"`
}

func (m DeliverableModel) Share(ctx context.Context, course, id string) (share DeliverableShare, err error) {
	err = m.db.QueryRow(ctx, `SELECT token, visibility FROM deliverable_shares WHERE course_id::text=$1 AND deliverable_id=$2`, course, id).Scan(&share.Token, &share.Visibility)
	return
}

func (m DeliverableModel) SetShare(ctx context.Context, course, id, token, visibility string) (share DeliverableShare, err error) {
	err = m.db.QueryRow(ctx, `INSERT INTO deliverable_shares(course_id,deliverable_id,token,visibility) VALUES($1,$2,$3,$4)
 ON CONFLICT(course_id,deliverable_id) DO UPDATE SET visibility=EXCLUDED.visibility RETURNING token,visibility`, course, id, token, visibility).Scan(&share.Token, &share.Visibility)
	return
}

func (m DeliverableModel) ShareByToken(ctx context.Context, token string) (share DeliverableShare, err error) {
	err = m.db.QueryRow(ctx, `SELECT s.token,s.visibility,s.course_id,s.deliverable_id,c.user_id FROM deliverable_shares s JOIN courses c ON c.id=s.course_id WHERE s.token=$1`, token).Scan(&share.Token, &share.Visibility, &share.CourseID, &share.DeliverableID, &share.OwnerID)
	return
}
