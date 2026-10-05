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
	read := func(id string, status int) {
		t.Helper()
		response, err := http.Get(a.server.URL + "/api/shares/" + token + "/images/" + id)
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
	read(images[0], 200)
	read(images[1], 404)
	a.request(owner, "PUT", settings, map[string]any{"visibility": "private"}, 200)
	read(images[0], 404)
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
