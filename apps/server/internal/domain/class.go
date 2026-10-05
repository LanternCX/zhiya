package domain

type Class struct {
	ID              string        `json:"id"`
	Name            string        `json:"name"`
	HeadTeacherID   string        `json:"headTeacherId"`
	HeadTeacherName string        `json:"headTeacherName"`
	MemberCount     int           `json:"memberCount"`
	Members         []ClassMember `json:"members,omitempty"`
}

type ClassMember struct {
	ID       string `json:"id"`
	Nickname string `json:"nickname"`
	Avatar   string `json:"avatar"`
	Role     string `json:"role"`
}
