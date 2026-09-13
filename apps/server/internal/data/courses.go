package data

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
)

type Course struct {
	ID             string          `json:"id"`
	ConversationID string          `json:"conversationId"`
	Title          string          `json:"title"`
	Topic          string          `json:"topic"`
	Cover          CourseCover     `json:"cover"`
	Status         string          `json:"status"`
	State          json.RawMessage `json:"state"`
	Sections       []CourseSection `json:"sections"`
	CreatedAt      time.Time       `json:"createdAt"`
	UpdatedAt      time.Time       `json:"updatedAt"`
}

type CourseSection struct {
	ID            string               `json:"id"`
	Title         string               `json:"title"`
	Objective     string               `json:"objective"`
	Position      int                  `json:"position"`
	Status        string               `json:"status"`
	Conversations []CourseConversation `json:"conversations"`
}

type CourseConversation struct {
	ID        string          `json:"id"`
	SectionID string          `json:"sectionId"`
	Title     string          `json:"title"`
	State     json.RawMessage `json:"state"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

type CourseCover struct {
	Motif   string `json:"motif"`
	Palette string `json:"palette"`
	Label   string `json:"label"`
}

type OutlineSection struct {
	ID        string
	Title     string
	Objective string
	Status    string
}

type CourseModel struct{ db database }

var emptyCourseState = json.RawMessage(`{"messages":[],"pages":[],"presentedPageIds":[],"currentPageId":""}`)

func scanCourse(row pgx.Row) (Course, error) {
	var course Course
	err := row.Scan(&course.ID, &course.Title, &course.Topic, &course.Cover.Motif, &course.Cover.Palette, &course.Cover.Label, &course.Status, &course.CreatedAt, &course.UpdatedAt)
	if err == pgx.ErrNoRows {
		return Course{}, ErrCourseNotFound
	}
	return course, err
}

const courseSelect = `SELECT id,title,topic,cover_motif,cover_palette,cover_label,status,created_at,updated_at FROM courses`

func (m CourseModel) load(ctx context.Context, course Course) (Course, error) {
	rows, err := m.db.Query(ctx, `SELECT s.id,s.title,s.objective,s.position,s.status,
	 cc.id,cc.title,cc.state,cc.created_at,cc.updated_at
	 FROM course_sections s LEFT JOIN course_conversations cc ON cc.section_id=s.id
	 WHERE s.course_id=$1 ORDER BY s.position,cc.created_at`, course.ID)
	if err != nil {
		return Course{}, err
	}
	defer rows.Close()
	course.Sections = []CourseSection{}
	course.State = emptyCourseState
	byID := map[string]int{}
	var latest time.Time
	for rows.Next() {
		var section CourseSection
		var conversationID, conversationTitle *string
		var state json.RawMessage
		var createdAt, updatedAt *time.Time
		if err := rows.Scan(&section.ID, &section.Title, &section.Objective, &section.Position, &section.Status, &conversationID, &conversationTitle, &state, &createdAt, &updatedAt); err != nil {
			return Course{}, err
		}
		index, ok := byID[section.ID]
		if !ok {
			section.Conversations = []CourseConversation{}
			course.Sections = append(course.Sections, section)
			index = len(course.Sections) - 1
			byID[section.ID] = index
		}
		if conversationID != nil {
			conversation := CourseConversation{ID: *conversationID, SectionID: section.ID, Title: *conversationTitle, State: state, CreatedAt: *createdAt, UpdatedAt: *updatedAt}
			course.Sections[index].Conversations = append(course.Sections[index].Conversations, conversation)
			if course.ConversationID == "" || conversation.UpdatedAt.After(latest) {
				course.ConversationID, course.State, latest = conversation.ID, conversation.State, conversation.UpdatedAt
			}
		}
	}
	return course, rows.Err()
}

func (m CourseModel) Create(ctx context.Context, user, title, topic string, cover CourseCover) (Course, error) {
	courseID, sectionID, conversationID := UUID(), UUID(), UUID()
	if _, err := m.db.Exec(ctx, `INSERT INTO courses(id,user_id,title,topic,cover_motif,cover_palette,cover_label) VALUES($1,$2,$3,$4,$5,$6,$7)`, courseID, user, title, topic, cover.Motif, cover.Palette, cover.Label); err != nil {
		return Course{}, err
	}
	if _, err := m.db.Exec(ctx, `INSERT INTO course_sections(id,course_id,title,objective,position) VALUES($1,$2,$3,$4,0)`, sectionID, courseID, "开始学习", topic); err != nil {
		return Course{}, err
	}
	if _, err := m.db.Exec(ctx, `INSERT INTO course_conversations(id,course_id,section_id,title,state) VALUES($1,$2,$3,$4,$5)`, conversationID, courseID, sectionID, "开始学习", emptyCourseState); err != nil {
		return Course{}, err
	}
	return m.Get(ctx, user, courseID)
}

func (m CourseModel) List(ctx context.Context, user string) ([]Course, error) {
	rows, err := m.db.Query(ctx, courseSelect+` WHERE user_id=$1 ORDER BY updated_at DESC`, user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	courses := []Course{}
	for rows.Next() {
		course, err := scanCourse(rows)
		if err != nil {
			return nil, err
		}
		courses = append(courses, course)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	for index := range courses {
		courses[index], err = m.load(ctx, courses[index])
		if err != nil {
			return nil, err
		}
	}
	return courses, nil
}

func (m CourseModel) Get(ctx context.Context, user, id string) (Course, error) {
	course, err := scanCourse(m.db.QueryRow(ctx, courseSelect+` WHERE user_id=$1 AND id=$2`, user, id))
	if err != nil {
		return Course{}, err
	}
	return m.load(ctx, course)
}

func (m CourseModel) Update(ctx context.Context, user, id, title, topic string) (Course, error) {
	tag, err := m.db.Exec(ctx, `UPDATE courses SET title=$1,topic=$2,updated_at=now() WHERE user_id=$3 AND id=$4`, title, topic, user, id)
	if err != nil {
		return Course{}, err
	}
	if tag.RowsAffected() == 0 {
		return Course{}, ErrCourseNotFound
	}
	return m.Get(ctx, user, id)
}

func (m CourseModel) ReplaceOutline(ctx context.Context, user, courseID string, outline []OutlineSection) (Course, error) {
	current, err := m.Get(ctx, user, courseID)
	if err != nil {
		return Course{}, err
	}
	if _, err := m.db.Exec(ctx, `UPDATE course_sections SET position=position+1000 WHERE course_id=$1`, courseID); err != nil {
		return Course{}, err
	}
	existing := map[string]CourseSection{}
	for _, section := range current.Sections {
		existing[section.ID] = section
	}
	used := map[string]bool{}
	for index, item := range outline {
		id := item.ID
		if id == "" && index == 0 && len(current.Sections) == 1 && current.Sections[0].Title == "开始学习" {
			id = current.Sections[0].ID
		}
		status := item.Status
		if status == "" {
			if section, ok := existing[id]; ok {
				status = section.Status
			} else {
				status = "planned"
			}
		}
		if _, ok := existing[id]; ok {
			if _, err := m.db.Exec(ctx, `UPDATE course_sections SET title=$1,objective=$2,position=$3,status=$4,updated_at=now() WHERE id=$5 AND course_id=$6`, item.Title, item.Objective, index, status, id, courseID); err != nil {
				return Course{}, err
			}
			used[id] = true
		} else {
			id = UUID()
			if _, err := m.db.Exec(ctx, `INSERT INTO course_sections(id,course_id,title,objective,position,status) VALUES($1,$2,$3,$4,$5,$6)`, id, courseID, item.Title, item.Objective, index, status); err != nil {
				return Course{}, err
			}
		}
	}
	position := len(outline)
	for _, section := range current.Sections {
		if used[section.ID] {
			continue
		}
		if _, err := m.db.Exec(ctx, `UPDATE course_sections SET position=$1,status='archived',updated_at=now() WHERE id=$2`, position, section.ID); err != nil {
			return Course{}, err
		}
		position++
	}
	if _, err := m.db.Exec(ctx, `UPDATE courses SET updated_at=now() WHERE id=$1`, courseID); err != nil {
		return Course{}, err
	}
	return m.Get(ctx, user, courseID)
}

func (m CourseModel) CreateConversation(ctx context.Context, user, courseID, sectionID, title string) (CourseConversation, error) {
	if _, err := m.Get(ctx, user, courseID); err != nil {
		return CourseConversation{}, err
	}
	var exists bool
	if err := m.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM course_sections WHERE id=$1 AND course_id=$2)`, sectionID, courseID).Scan(&exists); err != nil {
		return CourseConversation{}, err
	}
	if !exists {
		return CourseConversation{}, ErrSectionNotFound
	}
	id := UUID()
	var result CourseConversation
	err := m.db.QueryRow(ctx, `INSERT INTO course_conversations(id,course_id,section_id,title,state) VALUES($1,$2,$3,$4,$5)
	 RETURNING id,section_id,title,state,created_at,updated_at`, id, courseID, sectionID, title, emptyCourseState).Scan(&result.ID, &result.SectionID, &result.Title, &result.State, &result.CreatedAt, &result.UpdatedAt)
	return result, err
}

func (m CourseModel) SaveConversation(ctx context.Context, user, courseID, conversationID string, state json.RawMessage) error {
	tag, err := m.db.Exec(ctx, `UPDATE course_conversations cc SET state=$1,updated_at=now() FROM courses c WHERE cc.course_id=c.id AND c.user_id=$2 AND c.id=$3 AND cc.id=$4`, state, user, courseID, conversationID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrCourseNotFound
	}
	_, err = m.db.Exec(ctx, `UPDATE courses SET updated_at=now() WHERE user_id=$1 AND id=$2`, user, courseID)
	return err
}

func (m CourseModel) DeleteConversation(ctx context.Context, user, courseID, sectionID, conversationID string) (Course, error) {
	tag, err := m.db.Exec(ctx, `DELETE FROM course_conversations cc USING courses c
	 WHERE cc.course_id=c.id AND c.user_id=$1 AND c.id=$2 AND cc.section_id=$3 AND cc.id=$4`, user, courseID, sectionID, conversationID)
	if err != nil {
		return Course{}, err
	}
	if tag.RowsAffected() == 0 {
		return Course{}, ErrConversationNotFound
	}
	if _, err := m.db.Exec(ctx, `UPDATE courses SET updated_at=now() WHERE user_id=$1 AND id=$2`, user, courseID); err != nil {
		return Course{}, err
	}
	return m.Get(ctx, user, courseID)
}

func (m CourseModel) Delete(ctx context.Context, user, id string) error {
	tag, err := m.db.Exec(ctx, `DELETE FROM courses WHERE user_id=$1 AND id=$2`, user, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrCourseNotFound
	}
	return nil
}
