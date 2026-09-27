package data

import (
	"context"
	"encoding/json"
	"time"

	"github.com/LanternCX/zhiya/apps/server/internal/domain"
	"github.com/LanternCX/zhiya/apps/server/internal/identifier"
	"github.com/jackc/pgx/v5"
)

type Course = domain.Course
type CourseSection = domain.CourseSection
type CourseConversation = domain.CourseConversation
type CourseCover = domain.CourseCover
type OutlineSection = domain.OutlineSection
type OutlineReorganization = domain.OutlineReorganization

type CourseModel struct{ db database }

var emptyCourseState = json.RawMessage(`{"messages":[],"pages":[],"presentations":[],"currentPresentationId":""}`)

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
	courseID := identifier.New()
	if _, err := m.db.Exec(ctx, `INSERT INTO courses(id,user_id,title,topic,cover_motif,cover_palette,cover_label) VALUES($1,$2,$3,$4,$5,$6,$7)`, courseID, user, title, topic, cover.Motif, cover.Palette, cover.Label); err != nil {
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
	return m.replaceOutline(ctx, user, courseID, outline, false, true)
}

func (m CourseModel) replaceOutline(ctx context.Context, user, courseID string, outline []OutlineSection, preserveNewIDs, deleteObsolete bool) (Course, error) {
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
			if !preserveNewIDs || id == "" {
				id = identifier.New()
			}
			if _, err := m.db.Exec(ctx, `INSERT INTO course_sections(id,course_id,title,objective,position,status) VALUES($1,$2,$3,$4,$5,$6)`, id, courseID, item.Title, item.Objective, index, status); err != nil {
				return Course{}, err
			}
		}
	}
	if deleteObsolete {
		for _, section := range current.Sections {
			if used[section.ID] {
				continue
			}
			if _, err := m.db.Exec(ctx, `DELETE FROM course_sections WHERE id=$1 AND course_id=$2`, section.ID, courseID); err != nil {
				return Course{}, err
			}
		}
	}
	if _, err := m.db.Exec(ctx, `UPDATE courses SET updated_at=now() WHERE id=$1`, courseID); err != nil {
		return Course{}, err
	}
	return m.Get(ctx, user, courseID)
}

func (m CourseModel) BeginOutlineReorganization(ctx context.Context, user, courseID string, outline []OutlineSection) (OutlineReorganization, error) {
	current, err := m.Get(ctx, user, courseID)
	if err != nil {
		return OutlineReorganization{}, err
	}
	existing := make(map[string]CourseSection, len(current.Sections))
	for _, section := range current.Sections {
		existing[section.ID] = section
	}
	for index := range outline {
		section, ok := existing[outline[index].ID]
		if !ok {
			outline[index].ID = identifier.New()
		} else if outline[index].Status == "" {
			outline[index].Status = section.Status
		}
		if outline[index].Status == "" {
			outline[index].Status = "planned"
		}
	}
	raw, err := json.Marshal(outline)
	if err != nil {
		return OutlineReorganization{}, err
	}
	if _, err := m.db.Exec(ctx, `DELETE FROM course_outline_reorganizations WHERE course_id=$1`, courseID); err != nil {
		return OutlineReorganization{}, err
	}
	id := identifier.New()
	if _, err := m.db.Exec(ctx, `INSERT INTO course_outline_reorganizations(id,course_id,sections) VALUES($1,$2,$3)`, id, courseID, raw); err != nil {
		return OutlineReorganization{}, err
	}
	if _, err := m.db.Exec(ctx, `INSERT INTO course_outline_assignments(reorganization_id,conversation_id,conversation_updated_at)
		SELECT $1,id,updated_at FROM course_conversations WHERE course_id=$2`, id, courseID); err != nil {
		return OutlineReorganization{}, err
	}
	return m.loadOutlineReorganization(ctx, user, courseID, false)
}

func (m CourseModel) GetOutlineReorganization(ctx context.Context, user, courseID string) (OutlineReorganization, error) {
	return m.loadOutlineReorganization(ctx, user, courseID, true)
}

func (m CourseModel) InspectOutlineReorganization(ctx context.Context, user, courseID string) (OutlineReorganization, error) {
	return m.loadOutlineReorganization(ctx, user, courseID, false)
}

func (m CourseModel) loadOutlineReorganization(ctx context.Context, user, courseID string, refresh bool) (OutlineReorganization, error) {
	if _, err := m.Get(ctx, user, courseID); err != nil {
		return OutlineReorganization{}, err
	}
	var result OutlineReorganization
	var raw json.RawMessage
	err := m.db.QueryRow(ctx, `SELECT id,sections FROM course_outline_reorganizations WHERE course_id=$1`, courseID).Scan(&result.ID, &raw)
	if err == pgx.ErrNoRows {
		return OutlineReorganization{}, ErrOutlineReorganizationNotFound
	}
	if err != nil {
		return OutlineReorganization{}, err
	}
	if err := json.Unmarshal(raw, &result.Sections); err != nil {
		return OutlineReorganization{}, err
	}
	if refresh {
		if _, err := m.db.Exec(ctx, `INSERT INTO course_outline_assignments(reorganization_id,conversation_id,conversation_updated_at)
			SELECT $1,c.id,c.updated_at FROM course_conversations c
			WHERE c.course_id=$2 ON CONFLICT(reorganization_id,conversation_id) DO NOTHING`, result.ID, courseID); err != nil {
			return OutlineReorganization{}, err
		}
		if _, err := m.db.Exec(ctx, `UPDATE course_outline_assignments a
			SET conversation_updated_at=c.updated_at,target_section_id=NULL,reason=''
			FROM course_conversations c
			WHERE a.reorganization_id=$1 AND a.conversation_id=c.id AND a.conversation_updated_at<>c.updated_at`, result.ID); err != nil {
			return OutlineReorganization{}, err
		}
	}
	rows, err := m.db.Query(ctx, `SELECT c.id,c.section_id,c.title,c.state,c.created_at,c.updated_at
		FROM course_outline_assignments a JOIN course_conversations c ON c.id=a.conversation_id
		WHERE a.reorganization_id=$1 AND a.target_section_id IS NULL ORDER BY c.updated_at,c.id`, result.ID)
	if err != nil {
		return OutlineReorganization{}, err
	}
	defer rows.Close()
	result.Pending = []CourseConversation{}
	for rows.Next() {
		var conversation CourseConversation
		if err := rows.Scan(&conversation.ID, &conversation.SectionID, &conversation.Title, &conversation.State, &conversation.CreatedAt, &conversation.UpdatedAt); err != nil {
			return OutlineReorganization{}, err
		}
		result.Pending = append(result.Pending, conversation)
	}
	result.PendingCount = len(result.Pending)
	return result, rows.Err()
}

func (m CourseModel) AssignOutlineConversation(ctx context.Context, user, courseID, reorganizationID, conversationID, sectionID, reason string, conversationUpdatedAt time.Time, newSection *OutlineSection) (Course, *OutlineReorganization, error) {
	var storedCourseID string
	var raw json.RawMessage
	err := m.db.QueryRow(ctx, `SELECT r.course_id,r.sections FROM course_outline_reorganizations r JOIN courses c ON c.id=r.course_id WHERE r.id=$1 AND r.course_id=$2 AND c.user_id=$3 FOR UPDATE`, reorganizationID, courseID, user).Scan(&storedCourseID, &raw)
	if err == pgx.ErrNoRows {
		return Course{}, nil, ErrOutlineReorganizationNotFound
	}
	if err != nil {
		return Course{}, nil, err
	}
	var sections []OutlineSection
	if err := json.Unmarshal(raw, &sections); err != nil {
		return Course{}, nil, err
	}
	if newSection != nil {
		if len(sections) >= domain.CourseOutlineMaxSections {
			return Course{}, nil, ErrCourseOutlineLimit
		}
		newSection.ID = identifier.New()
		newSection.Status = "archived"
		sections = append(sections, *newSection)
		sectionID = newSection.ID
		raw, _ = json.Marshal(sections)
		if _, err := m.db.Exec(ctx, `UPDATE course_outline_reorganizations SET sections=$1 WHERE id=$2`, raw, reorganizationID); err != nil {
			return Course{}, nil, err
		}
	} else {
		found := false
		for _, section := range sections {
			found = found || section.ID == sectionID
		}
		if !found {
			return Course{}, nil, ErrOutlineTargetSectionNotFound
		}
	}
	var queuedUpdatedAt, liveUpdatedAt time.Time
	err = m.db.QueryRow(ctx, `SELECT a.conversation_updated_at,c.updated_at
		FROM course_outline_assignments a JOIN course_conversations c ON c.id=a.conversation_id
		WHERE a.reorganization_id=$1 AND a.conversation_id=$2 AND c.course_id=$3`, reorganizationID, conversationID, courseID).Scan(&queuedUpdatedAt, &liveUpdatedAt)
	if err == pgx.ErrNoRows {
		return Course{}, nil, ErrConversationNotFound
	}
	if err != nil {
		return Course{}, nil, err
	}
	if !queuedUpdatedAt.Equal(conversationUpdatedAt) || !liveUpdatedAt.Equal(conversationUpdatedAt) {
		return Course{}, nil, ErrOutlineClassificationStale
	}
	if _, err := m.db.Exec(ctx, `UPDATE course_outline_assignments SET target_section_id=$1,reason=$2 WHERE reorganization_id=$3 AND conversation_id=$4`, sectionID, reason, reorganizationID, conversationID); err != nil {
		return Course{}, nil, err
	}
	pending, err := m.loadOutlineReorganization(ctx, user, courseID, true)
	if err != nil {
		return Course{}, nil, err
	}
	if pending.PendingCount > 0 {
		return Course{}, &pending, nil
	}
	course, err := m.replaceOutline(ctx, user, courseID, sections, true, false)
	if err != nil {
		return Course{}, nil, err
	}
	if _, err := m.db.Exec(ctx, `UPDATE course_conversations c SET section_id=a.target_section_id
		FROM course_outline_assignments a WHERE a.reorganization_id=$1 AND a.conversation_id=c.id`, reorganizationID); err != nil {
		return Course{}, nil, err
	}
	retained := make(map[string]bool, len(sections))
	for _, section := range sections {
		retained[section.ID] = true
	}
	for _, section := range course.Sections {
		if retained[section.ID] {
			continue
		}
		if _, err := m.db.Exec(ctx, `DELETE FROM course_sections WHERE id=$1 AND course_id=$2`, section.ID, courseID); err != nil {
			return Course{}, nil, err
		}
	}
	if _, err := m.db.Exec(ctx, `DELETE FROM course_outline_reorganizations WHERE id=$1`, reorganizationID); err != nil {
		return Course{}, nil, err
	}
	course, err = m.Get(ctx, user, courseID)
	return course, nil, err
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
	id := identifier.New()
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
