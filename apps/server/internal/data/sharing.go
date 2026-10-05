package data

import "context"

type DeliverableShare struct {
	Token         string   `json:"token"`
	Visibility    string   `json:"visibility"`
	ClassIDs      []string `json:"classIds"`
	CourseID      string   `json:"-"`
	DeliverableID string   `json:"-"`
	OwnerID       string   `json:"-"`
}

func (m DeliverableModel) Share(ctx context.Context, course, id string) (share DeliverableShare, err error) {
	err = m.db.QueryRow(ctx, `SELECT token, visibility,ARRAY(SELECT class_id::text FROM deliverable_share_classes WHERE token=s.token ORDER BY class_id) FROM deliverable_shares s WHERE course_id::text=$1 AND deliverable_id=$2`, course, id).Scan(&share.Token, &share.Visibility, &share.ClassIDs)
	return
}

func (m DeliverableModel) SetShare(ctx context.Context, course, id, token, visibility string, classes []string) (share DeliverableShare, err error) {
	err = m.db.QueryRow(ctx, `INSERT INTO deliverable_shares(course_id,deliverable_id,token,visibility) VALUES($1,$2,$3,$4)
 ON CONFLICT(course_id,deliverable_id) DO UPDATE SET visibility=EXCLUDED.visibility RETURNING token,visibility`, course, id, token, visibility).Scan(&share.Token, &share.Visibility)
	if err != nil {
		return
	}
	if _, err = m.db.Exec(ctx, `DELETE FROM deliverable_share_classes WHERE token=$1`, share.Token); err != nil {
		return
	}
	for _, class := range classes {
		if _, err = m.db.Exec(ctx, `INSERT INTO deliverable_share_classes(token,class_id) VALUES($1,$2)`, share.Token, class); err != nil {
			return
		}
	}
	share.ClassIDs = classes
	return
}

func (m DeliverableModel) ShareByToken(ctx context.Context, token string) (share DeliverableShare, err error) {
	err = m.db.QueryRow(ctx, `SELECT s.token,s.visibility,s.course_id,s.deliverable_id,c.user_id,ARRAY(SELECT class_id::text FROM deliverable_share_classes WHERE token=s.token ORDER BY class_id) FROM deliverable_shares s JOIN courses c ON c.id=s.course_id WHERE s.token=$1`, token).Scan(&share.Token, &share.Visibility, &share.CourseID, &share.DeliverableID, &share.OwnerID, &share.ClassIDs)
	return
}

type ClassPublication struct {
	Share       DeliverableShare
	TeacherName string
}

func (m DeliverableModel) ClassPublications(ctx context.Context, class string) ([]ClassPublication, error) {
	rows, err := m.db.Query(ctx, `SELECT s.token,s.course_id,s.deliverable_id,c.user_id,u.nickname
	 FROM deliverable_shares s JOIN courses c ON c.id=s.course_id JOIN users u ON u.id=c.user_id
	 JOIN deliverable_share_classes sc ON sc.token=s.token
	 JOIN class_members cm ON cm.class_id=sc.class_id AND cm.user_id=u.id
	 WHERE sc.class_id::text=$1 AND s.visibility='class' AND u.role='teacher' ORDER BY s.token`, class)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []ClassPublication{}
	for rows.Next() {
		var item ClassPublication
		if err := rows.Scan(&item.Share.Token, &item.Share.CourseID, &item.Share.DeliverableID, &item.Share.OwnerID, &item.TeacherName); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
