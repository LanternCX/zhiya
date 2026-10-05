package client

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"testing"
	"time"
)

func TestConcurrentRemovalAndJoinCannotRestoreRemovedMember(t *testing.T) {
	a := setupAccountTest(t)
	head := a.registerRole("race-head@example.com", "teacher")
	student := a.registerRole("race-student@example.com", "student")
	id := a.request(head, "POST", "/classes", map[string]string{"name": "并发班级"}, 201)["class"].(map[string]any)["id"].(string)
	path := "/classes/" + id
	code := a.request(head, "GET", path+"/invitation", nil, 200)["code"].(string)
	studentID := a.request(student, "GET", "/me", nil, 200)["id"].(string)
	a.request(student, "POST", "/classes/join", map[string]string{"code": code}, 200)
	statuses := simultaneousClassRequests(t, a,
		classRequest{head, "DELETE", path + "/members/" + studentID, nil},
		classRequest{student, "POST", "/classes/join", map[string]string{"code": code}},
	)
	if statuses[0] != 200 && statuses[0] != 400 {
		t.Fatalf("removal status = %d", statuses[0])
	}
	if statuses[1] != 200 && statuses[1] != 403 {
		t.Fatalf("join status = %d", statuses[1])
	}
	// A busy member may require retry; once removal succeeds, joining cannot restore membership.
	a.request(head, "DELETE", path+"/members/"+studentID, nil, 200)
	a.request(student, "POST", "/classes/join", map[string]string{"code": code}, 403)
	a.request(student, "GET", path, nil, 404)
}

func TestConcurrentTransferAndAccountDeletionKeepClassOwned(t *testing.T) {
	a := setupAccountTest(t)
	head := a.registerRole("transfer-race-head@example.com", "teacher")
	teacher := a.registerRole("transfer-race-teacher@example.com", "teacher")
	id := a.request(head, "POST", "/classes", map[string]string{"name": "转交班级"}, 201)["class"].(map[string]any)["id"].(string)
	path := "/classes/" + id
	code := a.request(head, "GET", path+"/invitation", nil, 200)["code"].(string)
	a.request(teacher, "POST", "/classes/join", map[string]string{"code": code}, 200)
	teacherID := a.request(teacher, "GET", "/me", nil, 200)["id"].(string)
	headID := a.request(head, "GET", "/me", nil, 200)["id"].(string)
	statuses := simultaneousClassRequests(t, a,
		classRequest{head, "POST", path + "/transfer", map[string]string{"memberId": teacherID}},
		classRequest{teacher, "DELETE", "/me", map[string]any{"currentPassword": testPassword, "confirm": true}},
	)
	wantHead := headID
	if statuses[0] == 200 {
		wantHead = teacherID
		if statuses[1] != 403 {
			t.Fatalf("new head was deleted: %v", statuses)
		}
	} else if statuses[0] != 400 || statuses[1] != 200 {
		t.Fatalf("unexpected concurrent results: %v", statuses)
	}
	detail := a.request(head, "GET", path, nil, 200)["class"].(map[string]any)
	if detail["headTeacherId"] != wantHead {
		t.Fatalf("class owner = %v", detail["headTeacherId"])
	}
	heads := 0
	for _, member := range detail["members"].([]any) {
		if member.(map[string]any)["role"] == "head_teacher" {
			heads++
		}
	}
	if heads != 1 {
		t.Fatalf("head teachers = %d", heads)
	}
}

type classRequest struct {
	client       *http.Client
	method, path string
	body         any
}

func simultaneousClassRequests(t *testing.T, a *testApp, requests ...classRequest) []int {
	t.Helper()
	type result struct {
		index, status int
		err           error
		body          string
	}
	start := make(chan struct{})
	results := make(chan result, len(requests))
	for i, request := range requests {
		go func() {
			<-start
			body, _ := json.Marshal(request.body)
			req, _ := http.NewRequest(request.method, a.server.URL+"/api"+request.path, bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-Zhiya-Request", "1")
			req.Header.Set("Origin", a.server.URL)
			response, err := request.client.Do(req)
			if err != nil {
				results <- result{index: i, err: err}
				return
			}
			defer response.Body.Close()
			raw, _ := io.ReadAll(response.Body)
			results <- result{index: i, status: response.StatusCode, body: string(raw)}
		}()
	}
	close(start)
	statuses := make([]int, len(requests))
	for range requests {
		select {
		case result := <-results:
			if result.err != nil || result.status >= 500 {
				t.Fatalf("concurrent request failed: %+v", result)
			}
			statuses[result.index] = result.status
		case <-time.After(10 * time.Second):
			t.Fatal("concurrent class requests did not complete")
		}
	}
	return statuses
}

func TestOnlyHeadTeacherCanRenameClass(t *testing.T) {
	a := setupAccountTest(t)
	head := a.registerRole("rename-head@example.com", "teacher")
	student := a.registerRole("rename-student@example.com", "student")
	id := a.request(head, "POST", "/classes", map[string]string{"name": "原班级"}, 201)["class"].(map[string]any)["id"].(string)
	path := "/classes/" + id
	code := a.request(head, "GET", path+"/invitation", nil, 200)["code"].(string)
	a.request(student, "POST", "/classes/join", map[string]string{"code": code}, 200)
	a.request(student, "PATCH", path, map[string]string{"name": "越权修改"}, 403)
	a.request(head, "PATCH", path, map[string]string{"name": "   "}, 400)
	a.request(head, "PATCH", path, map[string]string{"name": "  新班级  "}, 200)
	if got := a.request(student, "GET", path, nil, 200)["class"].(map[string]any)["name"]; got != "新班级" {
		t.Fatalf("renamed class = %v", got)
	}
}

func TestHeadRemovesMembersAndControlsReadmission(t *testing.T) {
	a := setupAccountTest(t)
	head := a.registerRole("remove-head@example.com", "teacher")
	teacher := a.registerRole("remove-teacher@example.com", "teacher")
	student := a.registerRole("remove-student@example.com", "student")
	id := a.request(head, "POST", "/classes", map[string]string{"name": "成员班级"}, 201)["class"].(map[string]any)["id"].(string)
	path := "/classes/" + id
	code := a.request(head, "GET", path+"/invitation", nil, 200)["code"].(string)
	headID := a.request(head, "GET", "/me", nil, 200)["id"].(string)
	for _, c := range []*http.Client{teacher, student} {
		a.request(c, "POST", "/classes/join", map[string]string{"code": code}, 200)
	}
	studentID := a.request(student, "GET", "/me", nil, 200)["id"].(string)
	a.request(teacher, "DELETE", path+"/members/"+studentID, nil, 403)
	a.request(student, "DELETE", path+"/members/"+studentID, nil, 403)
	a.request(head, "DELETE", path+"/members/"+headID, nil, 400)
	a.request(teacher, "GET", path+"/removed-members", nil, 403)
	for _, c := range []*http.Client{student, teacher} {
		userID := a.request(c, "GET", "/me", nil, 200)["id"].(string)
		courseID, _ := a.createCourseConversation(c)
		for range 2 {
			a.request(head, "DELETE", path+"/members/"+userID, nil, 200)
		}
		a.request(c, "GET", path, nil, 404)
		if len(a.request(c, "GET", "/classes", nil, 200)["classes"].([]any)) != 0 {
			t.Fatal("removed class remains visible")
		}
		a.request(c, "POST", "/classes/join", map[string]string{"code": code}, 403)
		code = a.request(head, "POST", path+"/invitation", nil, 200)["code"].(string)
		a.request(c, "POST", "/classes/join", map[string]string{"code": code}, 403)
		removed := a.request(head, "GET", path+"/removed-members", nil, 200)["members"].([]any)
		if len(removed) != 1 || removed[0].(map[string]any)["id"] != userID {
			t.Fatalf("removed members = %v", removed)
		}
		a.request(student, "DELETE", path+"/removed-members/"+userID, nil, 403)
		for range 2 {
			a.request(head, "DELETE", path+"/removed-members/"+userID, nil, 200)
		}
		a.request(c, "GET", path, nil, 404)
		a.request(c, "POST", "/classes/join", map[string]string{"code": code}, 200)
		a.request(c, "GET", "/courses/"+courseID, nil, 200)
	}
}

func TestClassTransferLeaveAndDissolutionPreservePersonalLearning(t *testing.T) {
	a := setupAccountTest(t)
	head := a.registerRole("lifecycle-head@example.com", "teacher")
	teacher := a.registerRole("lifecycle-teacher@example.com", "teacher")
	student := a.registerRole("lifecycle-student@example.com", "student")
	outsider := a.registerRole("lifecycle-outsider@example.com", "teacher")
	id := a.request(head, "POST", "/classes", map[string]string{"name": "生命周期班级"}, 201)["class"].(map[string]any)["id"].(string)
	path := "/classes/" + id
	code := a.request(head, "GET", path+"/invitation", nil, 200)["code"].(string)
	for _, c := range []*http.Client{teacher, student} {
		a.request(c, "POST", "/classes/join", map[string]string{"code": code}, 200)
	}
	headID := a.request(head, "GET", "/me", nil, 200)["id"].(string)
	teacherID := a.request(teacher, "GET", "/me", nil, 200)["id"].(string)
	studentID := a.request(student, "GET", "/me", nil, 200)["id"].(string)
	outsiderID := a.request(outsider, "GET", "/me", nil, 200)["id"].(string)
	courseID, _ := a.createCourseConversation(student)
	a.request(head, "POST", path+"/leave", nil, 400)
	a.request(student, "POST", path+"/leave", nil, 403)
	for range 2 {
		a.request(teacher, "POST", path+"/leave", nil, 200)
	}
	a.request(teacher, "GET", path, nil, 404)
	a.request(teacher, "POST", "/classes/join", map[string]string{"code": code}, 200)
	for _, c := range []*http.Client{teacher, student, outsider} {
		a.request(c, "POST", path+"/transfer", map[string]string{"memberId": teacherID}, 403)
		a.request(c, "DELETE", path, map[string]string{"name": "生命周期班级"}, 403)
	}
	for _, target := range []string{headID, studentID, outsiderID} {
		a.request(head, "POST", path+"/transfer", map[string]string{"memberId": target}, 400)
	}
	a.request(head, "POST", path+"/transfer", map[string]string{"memberId": teacherID}, 200)
	a.request(head, "POST", path+"/transfer", map[string]string{"memberId": teacherID}, 403)
	a.request(head, "GET", path+"/invitation", nil, 403)
	a.request(head, "PATCH", path, map[string]string{"name": "旧班主任修改"}, 403)
	a.request(outsider, "POST", "/classes/join", map[string]string{"code": code}, 400)
	code = a.request(teacher, "GET", path+"/invitation", nil, 200)["code"].(string)
	detail := a.request(student, "GET", path, nil, 200)["class"].(map[string]any)
	if detail["headTeacherId"] != teacherID {
		t.Fatal("head teacher was not transferred")
	}
	for _, value := range detail["members"].([]any) {
		member := value.(map[string]any)
		if member["id"] == headID && member["role"] != "teacher" {
			t.Fatal("former head is not subject teacher")
		}
	}
	a.request(head, "POST", path+"/leave", nil, 200)
	a.request(teacher, "DELETE", path, map[string]string{"name": "错误名称"}, 400)
	a.request(teacher, "DELETE", path, map[string]string{"name": "生命周期班级"}, 200)
	for _, c := range []*http.Client{teacher, student} {
		a.request(c, "GET", path, nil, 404)
		if len(a.request(c, "GET", "/classes", nil, 200)["classes"].([]any)) != 0 {
			t.Fatal("dissolved class remains in list")
		}
	}
	a.request(outsider, "POST", "/classes/join", map[string]string{"code": code}, 400)
	a.request(student, "GET", "/courses/"+courseID, nil, 200)
}

func TestHeadTeacherMustResolveClassesBeforeDeletingAccount(t *testing.T) {
	a := setupAccountTest(t)
	head := a.registerRole("delete-head@example.com", "teacher")
	id := a.request(head, "POST", "/classes", map[string]string{"name": "待处理班级"}, 201)["class"].(map[string]any)["id"].(string)
	input := map[string]any{"currentPassword": testPassword, "confirm": true}
	a.request(head, "DELETE", "/me", input, 403)
	a.request(head, "GET", "/classes/"+id, nil, 200)
	a.request(head, "DELETE", "/classes/"+id, map[string]string{"name": "待处理班级"}, 200)
	a.request(head, "DELETE", "/me", input, 200)
	a.request(head, "GET", "/me", nil, 401)
}

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
