package client

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
)

func TestPrivateShareReadsCanRaceSettingsUpdates(t *testing.T) {
	a := setupAccountTest(t)
	owner := a.register("share-concurrent@example.com")
	course, _ := a.createCourseConversation(owner)
	settings := "/courses/" + course + "/deliverables/classroom/share"
	token := a.request(owner, "PUT", settings, map[string]any{"visibility": "public"}, 200)["token"].(string)
	a.request(owner, "PUT", settings, map[string]any{"visibility": "private"}, 200)
	for range 12 {
		var group sync.WaitGroup
		failures := make(chan string, 2)
		start := make(chan struct{})
		for _, operation := range []struct{ method, path string }{{"GET", "/shares/" + token}, {"PUT", settings}} {
			group.Add(1)
			go func() {
				defer group.Done()
				<-start
				request, _ := http.NewRequest(operation.method, a.server.URL+"/api"+operation.path, strings.NewReader(`{"visibility":"private"}`))
				request.Header.Set("X-Zhiya-Request", "1")
				request.Header.Set("Content-Type", "application/json")
				response, err := owner.Do(request)
				if err != nil {
					failures <- err.Error()
					return
				}
				defer response.Body.Close()
				body, _ := io.ReadAll(response.Body)
				if response.StatusCode != 200 {
					failures <- operation.method + " " + string(body)
				}
			}()
		}
		close(start)
		group.Wait()
		close(failures)
		for failure := range failures {
			t.Fatal(failure)
		}
	}
}

func TestSharedPicturesAreScopedAndRevokedWithContent(t *testing.T) {
	a := setupAccountTest(t)
	owner := a.register("share-images@example.com")
	user := a.request(owner, "GET", "/me", nil, 200)["id"].(string)
	course, conversation := a.createCourseConversation(owner)
	ctx := context.Background()
	var picture bytes.Buffer
	_ = png.Encode(&picture, image.NewRGBA(image.Rect(0, 0, 8, 8)))
	images := []string{}
	for _, name := range []string{"shared", "unrelated"} {
		generated, err := a.app.models.Illustrations.Create(ctx, user, course, conversation, name, name, name, name, "test")
		if err != nil {
			t.Fatal(err)
		}
		if err = a.objects.Put(ctx, name, "image/png", bytes.NewReader(picture.Bytes())); err != nil {
			t.Fatal(err)
		}
		if _, err = a.app.models.Illustrations.Complete(ctx, generated.ID, name); err != nil {
			t.Fatal(err)
		}
		images = append(images, generated.ID)
	}
	state, _ := json.Marshal(map[string]any{"messages": []any{map[string]any{"text": "private-chat"}}, "pages": []any{
		map[string]any{"id": "picture", "kind": "illustration", "title": "配图", "assetId": images[0]},
		map[string]any{"id": "quiz", "kind": "question", "title": "练习", "text": "公开题目", "selected": []string{"private-answer"}},
	}, "presentations": []any{}})
	if err := a.app.models.Conversations.Save(ctx, user, conversation, state); err != nil {
		t.Fatal(err)
	}
	settings := "/courses/" + course + "/deliverables/classroom/share"
	token := a.request(owner, "PUT", settings, map[string]any{"visibility": "public"}, 200)["token"].(string)
	shared := a.request(http.DefaultClient, "GET", "/shares/"+token, nil, 200)
	encoded, _ := json.Marshal(shared)
	if strings.Contains(string(encoded), "private-") || strings.Contains(string(encoded), conversation) {
		t.Fatalf("private data escaped: %s", encoded)
	}
	read := func(client *http.Client, id string, status int) {
		t.Helper()
		response, err := client.Get(a.server.URL + "/api/shares/" + token + "/images/" + id)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		raw, _ := io.ReadAll(response.Body)
		if response.StatusCode != status {
			t.Fatalf("image response %d: %s", response.StatusCode, raw)
		}
		if status == 200 && (!bytes.Equal(raw, picture.Bytes()) || response.Header.Get("Cache-Control") != "no-store") {
			t.Fatal("incorrect image or caching")
		}
	}
	read(http.DefaultClient, images[0], 200)
	read(http.DefaultClient, images[1], 404)
	a.request(owner, "PUT", settings, map[string]any{"visibility": "private"}, 200)
	read(http.DefaultClient, images[0], 404)
	head := a.registerRole("image-head@example.com", "teacher")
	member := a.register("image-member@example.com")
	class := a.request(head, "POST", "/classes", map[string]string{"name": "图片共享班"}, 201)["class"].(map[string]any)["id"].(string)
	code := a.request(head, "GET", "/classes/"+class+"/invitation", nil, 200)["code"].(string)
	for _, client := range []*http.Client{owner, member} {
		a.request(client, "POST", "/classes/join", map[string]string{"code": code}, 200)
	}
	a.request(owner, "PUT", settings, map[string]any{"visibility": "class", "classIds": []string{class}}, 200)
	read(member, images[0], 200)
	read(member, images[1], 404)
	read(http.DefaultClient, images[0], 404)
	memberID := a.request(member, "GET", "/me", nil, 200)["id"].(string)
	a.request(head, "DELETE", "/classes/"+class+"/members/"+memberID, nil, 200)
	read(member, images[0], 404)
}

func TestDeliverableSharingRequiresExplicitPublicationAndKeepsLink(t *testing.T) {
	a := setupAccountTest(t)
	owner := a.register("share-owner@example.com")
	other := a.register("share-other@example.com")
	course, _ := a.createCourseConversation(owner)
	path := "/courses/" + course + "/deliverables/classroom/share"
	initial := a.request(owner, "GET", path, nil, 200)
	if initial["visibility"] != "private" || initial["token"] != "" {
		t.Fatalf("unexpected default: %v", initial)
	}
	a.request(other, "PUT", path, map[string]any{"visibility": "public"}, 404)
	a.request(owner, "PUT", path, map[string]any{"visibility": "class"}, 400)
	published := a.request(owner, "PUT", path, map[string]any{"visibility": "public"}, 200)
	token := published["token"].(string)
	if token == "" {
		t.Fatal("missing share token")
	}
	shared := "/shares/" + token
	guest := &http.Client{}
	a.request(guest, "GET", shared, nil, 200)
	a.request(owner, "PUT", path, map[string]any{"visibility": "private"}, 200)
	a.request(guest, "GET", shared, nil, 404)
	a.request(other, "GET", shared, nil, 404)
	a.request(owner, "GET", shared, nil, 200)
	reopened := a.request(owner, "PUT", path, map[string]any{"visibility": "public"}, 200)
	if reopened["token"] != token {
		t.Fatal("link changed on republishing")
	}
	a.request(owner, "PATCH", "/courses/"+course, map[string]any{"title": "最新课件", "topic": "新主题"}, 200)
	latest := a.request(guest, "GET", shared, nil, 200)["deliverable"].(map[string]any)
	if latest["title"] != "最新课件" {
		t.Fatalf("stale share: %v", latest)
	}
	a.request(guest, "GET", "/shares/unknown", nil, 404)
	a.request(owner, "DELETE", "/courses/"+course, nil, 200)
	a.request(guest, "GET", shared, nil, 404)
}

func TestDocumentsHaveIndependentLinksAndShowSourceEdits(t *testing.T) {
	a := setupAccountTest(t)
	owner := a.register("share-documents@example.com")
	course, _ := a.createCourseConversation(owner)
	base := "/courses/" + course + "/deliverables"
	ids := []string{}
	tokens := []string{}
	for _, name := range []string{"第一份文档", "第二份文档"} {
		item := a.request(owner, "POST", base, map[string]any{
			"requestId": name, "kind": "document", "title": name,
			"blocks": []any{map[string]any{"id": "intro", "title": "简介", "markdown": "原始内容", "imageIds": []string{}}},
		}, 201)["deliverable"].(map[string]any)
		id := item["id"].(string)
		ids = append(ids, id)
		share := a.request(owner, "PUT", base+"/"+id+"/share", map[string]any{"visibility": "public"}, 200)
		tokens = append(tokens, share["token"].(string))
	}
	if tokens[0] == tokens[1] {
		t.Fatal("different documents shared a link")
	}
	a.request(owner, "PATCH", base+"/"+ids[0], map[string]any{
		"requestId": "edit", "revision": 1,
		"changes": []any{map[string]any{"action": "patch", "blockId": "intro", "field": "markdown", "oldText": "原始内容", "newText": "最新内容"}},
	}, 200)
	latest := a.request(http.DefaultClient, "GET", "/shares/"+tokens[0], nil, 200)["deliverable"].(map[string]any)
	if latest["blocks"].([]any)[0].(map[string]any)["markdown"] != "最新内容" {
		t.Fatal("shared document is stale")
	}
	a.request(owner, "PUT", base+"/"+ids[0]+"/share", map[string]any{"visibility": "private"}, 200)
	a.request(http.DefaultClient, "GET", "/shares/"+tokens[0], nil, 404)
	other := a.request(http.DefaultClient, "GET", "/shares/"+tokens[1], nil, 200)["deliverable"].(map[string]any)
	if other["blocks"].([]any)[0].(map[string]any)["markdown"] != "原始内容" {
		t.Fatal("changes crossed document boundaries")
	}
}

func TestClassSharesRequireCurrentMembershipAndKeepTheirLink(t *testing.T) {
	a := setupAccountTest(t)
	owner := a.registerRole("class-share-owner@example.com", "teacher")
	member := a.register("class-share-member@example.com")
	outsider := a.registerRole("class-share-outsider@example.com", "teacher")
	class := a.request(owner, "POST", "/classes", map[string]string{"name": "共享班级"}, 201)["class"].(map[string]any)["id"].(string)
	code := a.request(owner, "GET", "/classes/"+class+"/invitation", nil, 200)["code"].(string)
	a.request(member, "POST", "/classes/join", map[string]string{"code": code}, 200)
	otherClass := a.request(outsider, "POST", "/classes", map[string]string{"name": "其他班级"}, 201)["class"].(map[string]any)["id"].(string)
	course, _ := a.createCourseConversation(owner)
	path := "/courses/" + course + "/deliverables/classroom/share"
	a.request(owner, "PUT", path, map[string]any{"visibility": "class"}, 400)
	a.request(owner, "PUT", path, map[string]any{"visibility": "class", "classIds": []string{otherClass}}, 400)
	a.request(member, "PUT", path, map[string]any{"visibility": "class", "classIds": []string{class}}, 404)
	share := a.request(owner, "PUT", path, map[string]any{"visibility": "class", "classIds": []string{class}}, 200)
	token := share["token"].(string)
	if share["classIds"].([]any)[0] != class {
		t.Fatal("class selection was not saved")
	}
	link := "/shares/" + token
	a.request(owner, "GET", link, nil, 200)
	a.request(member, "GET", link, nil, 200)
	a.request(outsider, "GET", link, nil, 404)
	a.request(http.DefaultClient, "GET", link, nil, 404)
	memberID := a.request(member, "GET", "/me", nil, 200)["id"].(string)
	a.request(owner, "DELETE", "/classes/"+class+"/members/"+memberID, nil, 200)
	a.request(member, "GET", link, nil, 404)
	a.request(owner, "DELETE", "/classes/"+class, map[string]string{"name": "共享班级"}, 200)
	a.request(owner, "GET", link, nil, 200)
	settings := a.request(owner, "GET", path, nil, 200)
	if settings["token"] != token {
		t.Fatal("dissolving the class changed the link")
	}
	public := a.request(owner, "PUT", path, map[string]any{"visibility": "public"}, 200)
	if public["token"] != token {
		t.Fatal("switching class/public changed the link")
	}
	a.request(http.DefaultClient, "GET", link, nil, 200)
	a.request(owner, "PUT", path, map[string]any{"visibility": "private"}, 200)
	a.request(member, "GET", link, nil, 404)
}

func TestMultipleClassesShareOneLinkAndRevokeIndependently(t *testing.T) {
	a := setupAccountTest(t)
	owner := a.registerRole("multi-owner@example.com", "teacher")
	first := a.register("multi-first@example.com")
	second := a.register("multi-second@example.com")
	ids := []string{}
	for i, member := range []*http.Client{first, second} {
		id := a.request(owner, "POST", "/classes", map[string]string{"name": []string{"一班", "二班"}[i]}, 201)["class"].(map[string]any)["id"].(string)
		code := a.request(owner, "GET", "/classes/"+id+"/invitation", nil, 200)["code"].(string)
		a.request(member, "POST", "/classes/join", map[string]string{"code": code}, 200)
		ids = append(ids, id)
	}
	course, _ := a.createCourseConversation(owner)
	settings := "/courses/" + course + "/deliverables/classroom/share"
	token := a.request(owner, "PUT", settings, map[string]any{"visibility": "class", "classIds": ids}, 200)["token"].(string)
	link := "/shares/" + token
	for i, member := range []*http.Client{first, second} {
		a.request(member, "GET", link, nil, 200)
		items := a.request(member, "GET", "/classes/"+ids[i]+"/shares", nil, 200)["shares"].([]any)
		if len(items) != 1 || items[0].(map[string]any)["token"] != token {
			t.Fatal("class did not list the same shared link")
		}
	}
	a.request(owner, "PUT", settings, map[string]any{"visibility": "class", "classIds": []string{}}, 400)
	updated := a.request(owner, "PUT", settings, map[string]any{"visibility": "class", "classIds": ids[1:]}, 200)
	if updated["token"] != token {
		t.Fatal("changing selected classes changed the link")
	}
	a.request(first, "GET", link, nil, 404)
	a.request(second, "GET", link, nil, 200)
	if len(a.request(first, "GET", "/classes/"+ids[0]+"/shares", nil, 200)["shares"].([]any)) != 0 {
		t.Fatal("removed class still lists material")
	}
	a.request(owner, "PUT", settings, map[string]any{"visibility": "class", "classIds": ids}, 200)
	a.request(owner, "DELETE", "/classes/"+ids[0], map[string]string{"name": "一班"}, 200)
	a.request(first, "GET", link, nil, 404)
	a.request(second, "GET", link, nil, 200)
}

func TestClassPageListsOnlyCurrentTeacherShares(t *testing.T) {
	a := setupAccountTest(t)
	teacher := a.registerRole("class-list-teacher@example.com", "teacher")
	student := a.register("class-list-student@example.com")
	outsider := a.register("class-list-outsider@example.com")
	id := a.request(teacher, "POST", "/classes", map[string]string{"name": "资源班级"}, 201)["class"].(map[string]any)["id"].(string)
	code := a.request(teacher, "GET", "/classes/"+id+"/invitation", nil, 200)["code"].(string)
	a.request(student, "POST", "/classes/join", map[string]string{"code": code}, 200)
	course, _ := a.createCourseConversation(teacher)
	studentCourse, _ := a.createCourseConversation(student)
	settings := "/courses/" + course + "/deliverables/classroom/share"
	token := a.request(teacher, "PUT", settings, map[string]any{"visibility": "class", "classIds": []string{id}}, 200)["token"].(string)
	a.request(student, "PUT", "/courses/"+studentCourse+"/deliverables/classroom/share", map[string]any{"visibility": "class", "classIds": []string{id}}, 200)
	path := "/classes/" + id + "/shares"
	a.request(outsider, "GET", path, nil, 404)
	a.request(http.DefaultClient, "GET", path, nil, 401)
	items := a.request(student, "GET", path, nil, 200)["shares"].([]any)
	if len(items) != 1 || items[0].(map[string]any)["token"] != token {
		t.Fatalf("unexpected class shares: %v", items)
	}
	a.request(teacher, "PATCH", "/courses/"+course, map[string]string{"title": "更新的教学课件", "topic": "新主题"}, 200)
	items = a.request(student, "GET", path, nil, 200)["shares"].([]any)
	if items[0].(map[string]any)["title"] != "更新的教学课件" {
		t.Fatal("listing returned stale title")
	}
	a.request(teacher, "PUT", settings, map[string]string{"visibility": "private"}, 200)
	if len(a.request(student, "GET", path, nil, 200)["shares"].([]any)) != 0 {
		t.Fatal("private content remained listed")
	}
	a.request(teacher, "PUT", settings, map[string]any{"visibility": "class", "classIds": []string{id}}, 200)
	studentID := a.request(student, "GET", "/me", nil, 200)["id"].(string)
	a.request(teacher, "DELETE", "/classes/"+id+"/members/"+studentID, nil, 200)
	a.request(student, "GET", path, nil, 404)
	replacement := a.registerRole("class-list-replacement@example.com", "teacher")
	a.request(replacement, "POST", "/classes/join", map[string]string{"code": code}, 200)
	replacementID := a.request(replacement, "GET", "/me", nil, 200)["id"].(string)
	a.request(teacher, "POST", "/classes/"+id+"/transfer", map[string]string{"memberId": replacementID}, 200)
	a.request(teacher, "POST", "/classes/"+id+"/leave", nil, 200)
	if len(a.request(replacement, "GET", path, nil, 200)["shares"].([]any)) != 0 {
		t.Fatal("departed teacher's materials remained listed")
	}
	a.request(replacement, "GET", "/shares/"+token, nil, 404)
	a.request(teacher, "GET", "/shares/"+token, nil, 200)
}
