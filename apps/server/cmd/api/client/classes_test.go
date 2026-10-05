package client

import (
	"net/http"
	"testing"
)

func (a *testApp) registerRole(email, role string) *http.Client {
	a.t.Helper()
	c := a.client()
	flow := a.request(c, "POST", "/auth/register/start", map[string]string{"email": email}, 200)["flow"].(string)
	a.request(c, "POST", "/auth/register/complete", map[string]string{"flow": flow, "code": a.mail[email+":register"], "password": testPassword, "role": role}, 200)
	a.request(c, "POST", "/auth/login", map[string]string{"email": email, "password": testPassword}, 200)
	return c
}

func TestRegistrationRequiresOneIdentityAndProvidesItToAgent(t *testing.T) {
	a := setupAccountTest(t)
	c := a.client()
	flow := a.request(c, "POST", "/auth/register/start", map[string]string{"email": "identity@example.com"}, 200)["flow"].(string)
	for _, role := range []string{"", "both", "head_teacher"} {
		a.request(c, "POST", "/auth/register/complete", map[string]string{"flow": flow, "code": a.mail["identity@example.com:register"], "password": testPassword, "role": role}, 400)
	}
	a.request(c, "POST", "/auth/register/complete", map[string]string{"flow": flow, "code": a.mail["identity@example.com:register"], "password": testPassword, "role": "teacher"}, 200)
	a.request(c, "POST", "/auth/login", map[string]string{"email": "identity@example.com", "password": testPassword}, 200)
	if got := a.request(c, "GET", "/me", nil, 200)["role"]; got != "teacher" {
		t.Fatalf("account identity = %v", got)
	}
	for _, kind := range []string{"profile", "course"} {
		state := a.request(c, "POST", "/agent/sessions", map[string]string{"kind": kind}, 201)["state"].(map[string]any)
		if state["role"] != "teacher" {
			t.Fatalf("%s agent identity = %v", kind, state["role"])
		}
	}
}

func TestTeacherCreatesClassAndMembersJoinByAccountIdentity(t *testing.T) {
	a := setupAccountTest(t)
	head := a.registerRole("head@example.com", "teacher")
	teacher := a.registerRole("teacher@example.com", "teacher")
	student := a.registerRole("student@example.com", "student")
	a.request(student, "POST", "/classes", map[string]string{"name": "学生建班"}, 403)
	class := a.request(head, "POST", "/classes", map[string]string{"name": "  人工智能一班  "}, 201)["class"].(map[string]any)
	id := class["id"].(string)
	if class["name"] != "人工智能一班" || class["memberCount"] != float64(1) {
		t.Fatalf("created class = %v", class)
	}
	code := a.request(head, "GET", "/classes/"+id+"/invitation", nil, 200)["code"].(string)
	for _, member := range []*http.Client{teacher, student, student} {
		a.request(member, "POST", "/classes/join", map[string]string{"code": code}, 200)
	}
	detail := a.request(student, "GET", "/classes/"+id, nil, 200)["class"].(map[string]any)
	members := detail["members"].([]any)
	if len(members) != 3 {
		t.Fatalf("members = %v", members)
	}
	roles := map[string]int{}
	for _, member := range members {
		m := member.(map[string]any)
		roles[m["role"].(string)]++
		if _, exists := m["email"]; exists {
			t.Fatal("member exposes email")
		}
	}
	if roles["head_teacher"] != 1 || roles["teacher"] != 1 || roles["student"] != 1 {
		t.Fatalf("member roles = %v", roles)
	}
	if len(a.request(teacher, "GET", "/classes", nil, 200)["classes"].([]any)) != 1 {
		t.Fatal("joined class is missing")
	}
}

func TestClassInvitationRotationAndPrivateDataBoundaries(t *testing.T) {
	a := setupAccountTest(t)
	head := a.registerRole("invite-head@example.com", "teacher")
	teacher := a.registerRole("invite-teacher@example.com", "teacher")
	student := a.registerRole("invite-student@example.com", "student")
	outsider := a.registerRole("invite-outsider@example.com", "teacher")
	id := a.request(head, "POST", "/classes", map[string]string{"name": "邀请班级"}, 201)["class"].(map[string]any)["id"].(string)
	path := "/classes/" + id
	code := a.request(head, "GET", path+"/invitation", nil, 200)["code"].(string)
	for _, c := range []*http.Client{teacher, student} {
		a.request(c, "POST", "/classes/join", map[string]string{"code": code}, 200)
		a.request(c, "GET", path+"/invitation", nil, 403)
		a.request(c, "POST", path+"/invitation", nil, 403)
	}
	a.request(outsider, "GET", path, nil, 404)
	a.request(outsider, "GET", "/classes/not-a-uuid", nil, 404)
	a.request(outsider, "GET", path+"/invitation", nil, 403)
	a.request(a.client(), "GET", path, nil, 401)
	a.request(student, "PATCH", "/me", map[string]string{"role": "teacher"}, 400)
	if a.request(student, "GET", "/me", nil, 200)["role"] != "student" {
		t.Fatal("identity changed")
	}
	newCode := a.request(head, "POST", path+"/invitation", nil, 200)["code"].(string)
	if newCode == code {
		t.Fatal("rotation reused code")
	}
	a.request(outsider, "POST", "/classes/join", map[string]string{"code": code}, 400)
	if a.request(student, "GET", path, nil, 200)["class"].(map[string]any)["memberCount"] != float64(3) {
		t.Fatal("rotation removed members")
	}
	a.request(outsider, "POST", "/classes/join", map[string]string{"code": newCode}, 200)
	courseID, _ := a.createCourseConversation(head)
	a.request(student, "GET", "/courses/"+courseID, nil, 404)
	a.request(teacher, "GET", "/courses/"+courseID, nil, 404)
}
