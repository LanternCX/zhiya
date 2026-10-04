package client

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestClassroomAlwaysProvidesPresentationAndCourseDocument(t *testing.T) {
	a := setupAccountTest(t)
	owner := a.register("classroom-files@example.com")
	other := a.register("classroom-files-other@example.com")
	course, conversation := a.createCourseConversation(owner)
	state := map[string]any{
		"messages": []any{map[string]any{"id": 1, "role": "assistant", "text": "解释静态类型与编译。", "pageId": "intro"}},
		"pages": []any{
			map[string]any{"id": "intro", "kind": "slide", "title": "认识 Rust", "markdown": "# 认识 Rust\n\n编译型语言。"},
			map[string]any{"id": "quiz", "kind": "question", "title": "练习", "text": "Rust 是静态类型吗？", "options": []string{"是", "否"}, "selected": []string{"student-private-answer"}, "answerText": "student-private-answer"},
			map[string]any{"id": "code", "kind": "coding", "title": "编程练习", "instructions": "打印一句问候。", "starterCode": "fn main() {}", "code": "student-private-code"},
			map[string]any{"id": "map", "kind": "animation", "title": "运行流程", "nodes": []any{map[string]any{"id": "source", "shape": "rectangle", "label": "源码"}}, "edges": []any{}},
		},
		"presentations":         []any{map[string]any{"id": "first", "pageId": "intro"}, map[string]any{"id": "again", "pageId": "intro"}, map[string]any{"id": "q", "pageId": "quiz"}},
		"currentPresentationId": "q",
	}
	raw, _ := json.Marshal(state)
	if err := a.app.models.Conversations.Save(context.Background(), a.request(owner, "GET", "/me", nil, 200)["id"].(string), conversation, raw); err != nil {
		t.Fatal(err)
	}
	path := "/courses/" + course + "/deliverables"
	items := a.request(owner, "GET", path, nil, 200)["deliverables"].([]any)
	if len(items) != 2 {
		t.Fatalf("classroom did not automatically provide both files: %v", items)
	}
	ppt := a.request(owner, "GET", path+"/classroom", nil, 200)["deliverable"].(map[string]any)
	document := a.request(owner, "GET", path+"/course-document", nil, 200)["deliverable"].(map[string]any)
	if ppt["source"] != "classroom" || len(ppt["blocks"].([]any)) != 5 {
		t.Fatalf("export duplicated history or lost printable content: %v", ppt)
	}
	for _, item := range []map[string]any{ppt, document} {
		encoded, _ := json.Marshal(item)
		if strings.Contains(string(encoded), "student-private") {
			t.Fatal("download included student answers or working code")
		}
	}
	encoded, _ := json.Marshal(document)
	if strings.Contains(string(encoded), "解释静态类型与编译") {
		t.Fatal("course document copied conversational messages into the artifact")
	}
	if ppt["blocks"].([]any)[1].(map[string]any)["markdown"] != "编译型语言。" {
		t.Fatal("native slide title was repeated in printable body")
	}
	state["pages"].([]any)[0].(map[string]any)["markdown"] = "课堂源内容已更新。"
	raw, _ = json.Marshal(state)
	_ = a.app.models.Conversations.Save(context.Background(), a.request(owner, "GET", "/me", nil, 200)["id"].(string), conversation, raw)
	updated := a.request(owner, "GET", path+"/classroom", nil, 200)["deliverable"].(map[string]any)
	encoded, _ = json.Marshal(updated)
	if updated["revision"] == ppt["revision"] || !strings.Contains(string(encoded), "课堂源内容已更新") {
		t.Fatal("download did not follow the classroom source")
	}
	a.request(other, "GET", path+"/classroom", nil, 404)
	a.request(other, "GET", path+"/course-document", nil, 404)
}

func TestCourseDownloadsIncludeUnassignedConversationContent(t *testing.T) {
	a := setupAccountTest(t)
	owner := a.register("course-files-unassigned@example.com")
	course, _ := a.createCourseConversation(owner)
	user := a.request(owner, "GET", "/me", nil, 200)["id"].(string)
	conversation, err := a.app.models.Conversations.Create(context.Background(), user, course)
	if err != nil {
		t.Fatal(err)
	}
	if err := a.app.models.Conversations.Save(context.Background(), user, conversation.ID, json.RawMessage(`{"messages":[],"pages":[{"id":"unassigned","kind":"slide","title":"未分配章节的课件","markdown":"已创建的课堂内容也需要下载。"}],"presentations":[],"currentPresentationId":""}`)); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"classroom", "course-document"} {
		item := a.request(owner, "GET", "/courses/"+course+"/deliverables/"+id, nil, 200)
		encoded, _ := json.Marshal(item)
		if !strings.Contains(string(encoded), "已创建的课堂内容也需要下载") {
			t.Fatal("download lost course content before section assignment")
		}
	}
}

func TestInteractiveAnimationExportsStaticStagesWithoutChangingClassroom(t *testing.T) {
	a := setupAccountTest(t)
	owner := a.register("animation-static-stages@example.com")
	course, conversation := a.createCourseConversation(owner)
	user := a.request(owner, "GET", "/me", nil, 200)["id"].(string)
	raw := json.RawMessage(`{"messages":[],"pages":[{"id":"process","kind":"animation","title":"赋值过程","layout":"horizontal","nodes":[{"id":"value","shape":"rectangle","label":"变量值：0"},{"id":"output","shape":"rectangle","label":"输出"}],"edges":[{"id":"flow","source":"value","target":"output"}],"buttons":[{"id":"run","label":"运行过程","steps":[[{"type":"update","targetId":"value","value":"变量值：1"},{"type":"highlight","targetId":"value"}],[{"type":"update","targetId":"value","value":"变量值：2"},{"type":"flow","targetId":"flow"}],[{"type":"hide","targetId":"output"}]]},{"id":"another","label":"另一个例子","steps":[[{"type":"update","targetId":"value","value":"变量值：5"}]]}]}],"presentations":[],"currentPresentationId":""}`)
	if err := a.app.models.Conversations.Save(context.Background(), user, conversation, raw); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"classroom", "course-document"} {
		item := a.request(owner, "GET", "/courses/"+course+"/deliverables/"+id, nil, 200)["deliverable"].(map[string]any)
		stages := []map[string]any{}
		for _, block := range item["blocks"].([]any) {
			b := block.(map[string]any)
			if source, ok := b["source"].(map[string]any); ok && source["pageId"] == "process" {
				stages = append(stages, b)
			}
		}
		if len(stages) != 5 {
			t.Fatalf("%s lost interactive stages: got %d", id, len(stages))
		}
		if !strings.Contains(stages[1]["markdown"].(string), "变量值：1") || !strings.Contains(stages[2]["markdown"].(string), "变量值：2") {
			t.Fatal("static stages lost updated labels")
		}
		first := stages[0]["diagram"].(map[string]any)
		if first["edges"].([]any)[0].(map[string]any)["arrow"] != true {
			t.Fatal("static export lost default arrow direction")
		}
		if len(stages[1]["diagram"].(map[string]any)["highlightedIds"].([]any)) != 1 || len(stages[2]["diagram"].(map[string]any)["flowingIds"].([]any)) != 1 {
			t.Fatal("static export lost emphasis or flow")
		}
		hidden := stages[3]["diagram"].(map[string]any)
		if len(hidden["nodes"].([]any)) != 1 || len(hidden["edges"].([]any)) != 0 {
			t.Fatal("hidden objects remained visible in a static stage")
		}
		fresh := stages[4]["diagram"].(map[string]any)
		if len(fresh["nodes"].([]any)) != 2 || !strings.Contains(stages[4]["markdown"].(string), "变量值：5") {
			t.Fatal("a new button sequence did not start from the original scene")
		}
		encoded, _ := json.Marshal(item)
		if strings.Contains(string(encoded), `"buttons"`) || strings.Contains(string(encoded), `"steps"`) {
			t.Fatal("download retained interactive controls")
		}
	}
	stored, err := a.app.models.Conversations.Get(context.Background(), user, conversation)
	if err != nil {
		t.Fatal(err)
	}
	var actual, expected any
	_ = json.Unmarshal(stored.State, &actual)
	_ = json.Unmarshal(raw, &expected)
	actualJSON, _ := json.Marshal(actual)
	expectedJSON, _ := json.Marshal(expected)
	if !bytes.Equal(actualJSON, expectedJSON) {
		t.Fatal("static export changed the interactive classroom source")
	}
}

func TestAgentPatchesClassroomAndBothDownloadsFollowSource(t *testing.T) {
	a := setupAccountTest(t)
	owner := a.register("classroom-patch@example.com")
	course, conversation := a.createCourseConversation(owner)
	user := a.request(owner, "GET", "/me", nil, 200)["id"].(string)
	raw := json.RawMessage(`{"messages":[],"pages":[{"id":"intro","kind":"slide","title":"认识 AI","markdown":"原文保留第一段。\n\n语音助手。"}],"presentations":[{"id":"shown","pageId":"intro"}],"currentPresentationId":"shown"}`)
	if err := a.app.models.Conversations.Save(context.Background(), user, conversation, raw); err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		_ = json.NewDecoder(r.Body).Decode(&payload)
		call := calls.Add(1)
		name, args := "", ""
		if call == 1 {
			name, args = "read_classroom_page", `{"pageId":"intro"}`
		}
		if call == 2 {
			version := ""
			for _, message := range payload["messages"].([]any) {
				entry := message.(map[string]any)
				if entry["role"] != "tool" {
					continue
				}
				var result struct {
					Version string `json:"version"`
				}
				if content, ok := entry["content"].(string); ok {
					_ = json.Unmarshal([]byte(content), &result)
					version = result.Version
				}
			}
			if version == "" {
				t.Error("read did not return source version")
			}
			name, args = "edit_classroom_page", fmt.Sprintf(`{"pageId":"intro","version":%q,"changes":[{"field":"markdown","oldText":"语音助手。","newText":"校园里的语音助手。"}]}`, version)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		delta := map[string]any{"role": "assistant", "content": "课堂内容已修改，PPT 和课程文档已同步。"}
		reason := "stop"
		if name != "" {
			delta = map[string]any{"role": "assistant", "tool_calls": []any{map[string]any{"index": 0, "id": fmt.Sprintf("call-%d", call), "type": "function", "function": map[string]any{"name": name, "arguments": args}}}}
			reason = "tool_calls"
		}
		for _, choice := range []any{map[string]any{"index": 0, "delta": delta, "finish_reason": nil}, map[string]any{"index": 0, "delta": map[string]any{}, "finish_reason": reason}} {
			encoded, _ := json.Marshal(map[string]any{"id": "answer", "object": "chat.completion.chunk", "model": "test", "choices": []any{choice}})
			fmt.Fprintf(w, "data: %s\n\n", encoded)
		}
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	t.Cleanup(upstream.Close)
	a.app.config.Model.Endpoint, a.app.config.Model.ID = upstream.URL, "test"
	startAgentWorker(t, a)
	opened := a.request(owner, "POST", "/agent/sessions", map[string]any{"kind": "course", "courseId": course, "conversationId": conversation}, 201)
	id := opened["id"].(string)
	a.request(owner, "POST", "/agent/sessions/"+id+"/commands", map[string]any{"requestId": "patch-page", "action": "prompt", "args": []any{"把语音助手的例子改成校园里的，其他内容保留"}}, 202)
	deadline := time.Now().Add(15 * time.Second)
	complete := false
	for time.Now().Before(deadline) {
		state := a.request(owner, "GET", "/agent/sessions/"+id, nil, 200)["state"].(map[string]any)
		if receipts, ok := state["commands"].(map[string]any); ok {
			if receipt, ok := receipts["patch-page"].(map[string]any); ok && receipt["status"] == "complete" {
				complete = true
				break
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	if !complete {
		t.Fatal("source patch did not complete")
	}
	for _, view := range []string{"classroom", "course-document"} {
		item := a.request(owner, "GET", "/courses/"+course+"/deliverables/"+view, nil, 200)
		encoded, _ := json.Marshal(item)
		if !strings.Contains(string(encoded), "校园里的语音助手") || !strings.Contains(string(encoded), "原文保留第一段") {
			t.Fatalf("%s did not follow the saved classroom source: %s", view, encoded)
		}
	}
}

func TestDeliverablePictureSurvivesItsSourceConversation(t *testing.T) {
	a := setupAccountTest(t)
	owner := a.register("deliverable-picture@example.com")
	user := a.request(owner, "GET", "/me", nil, 200)["id"].(string)
	course, conversation := a.createCourseConversation(owner)
	ctx := context.Background()
	generated, err := a.app.models.Illustrations.Create(ctx, user, course, conversation, "picture", "配图", "配图", "配图", "test")
	if err != nil {
		t.Fatal(err)
	}
	var picture bytes.Buffer
	_ = png.Encode(&picture, image.NewRGBA(image.Rect(0, 0, 8, 8)))
	if err = a.objects.Put(ctx, "original-picture", "image/png", bytes.NewReader(picture.Bytes())); err != nil {
		t.Fatal(err)
	}
	if _, err = a.app.models.Illustrations.Complete(ctx, generated.ID, "original-picture"); err != nil {
		t.Fatal(err)
	}
	state, _ := json.Marshal(map[string]any{"messages": []any{}, "pages": []any{map[string]any{"id": "picture", "kind": "illustration", "title": "课堂配图", "alt": "用于讲解的图片", "assetId": generated.ID}}, "presentations": []any{}, "currentPresentationId": ""})
	if err := a.app.models.Conversations.Save(ctx, user, conversation, state); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"classroom", "course-document"} {
		file := a.request(owner, "GET", "/courses/"+course+"/deliverables/"+id, nil, 200)["deliverable"].(map[string]any)
		blocks := file["blocks"].([]any)
		if blocks[len(blocks)-1].(map[string]any)["imageIds"].([]any)[0] != generated.ID {
			t.Fatal("automatic download lost classroom picture")
		}
	}
	sourceImage := a.request(owner, "GET", "/courses/"+course+"/deliverable-images/"+generated.ID, nil, 200)
	sourceResponse, err := owner.Get(sourceImage["url"].(string))
	if err != nil {
		t.Fatal(err)
	}
	sourceBytes, _ := io.ReadAll(sourceResponse.Body)
	_ = sourceResponse.Body.Close()
	if sourceResponse.StatusCode != 200 || !bytes.Equal(sourceBytes, picture.Bytes()) {
		t.Fatal("classroom picture cannot be embedded in downloads")
	}
	other := a.register("deliverable-picture-other@example.com")
	a.request(other, "GET", "/courses/"+course+"/deliverable-images/"+generated.ID, nil, 404)
	a.request(owner, "POST", "/courses/"+course+"/deliverables", map[string]any{"requestId": "picture-doc", "kind": "document", "title": "图文讲义", "blocks": []any{map[string]any{"id": "intro", "title": "讲义", "markdown": "保留图片", "imageIds": []string{generated.ID}}}}, 201)
	stored := a.request(owner, "GET", "/courses/"+course, nil, 200)["course"].(map[string]any)
	section := stored["sections"].([]any)[0].(map[string]any)["id"].(string)
	a.request(owner, "DELETE", "/courses/"+course+"/sections/"+section+"/conversations/"+conversation, nil, 200)
	_ = a.objects.Delete(ctx, "original-picture")
	download := a.request(owner, "GET", "/courses/"+course+"/deliverable-images/"+generated.ID, nil, 200)
	response, err := owner.Get(download["url"].(string))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	raw, _ := io.ReadAll(response.Body)
	if response.StatusCode != 200 || !bytes.Equal(raw, picture.Bytes()) {
		t.Fatal("source conversation cleanup lost the deliverable picture")
	}
}

func TestAgentCreatesAndEditsSavedDeliverable(t *testing.T) {
	a := setupAccountTest(t)
	var calls atomic.Int32
	var target string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		_ = json.NewDecoder(r.Body).Decode(&payload)
		call := calls.Add(1)
		name, args := "", ""
		switch call {
		case 1:
			name, args = "create_deliverable", `{"kind":"document","title":"AI 讲义","blocks":[{"id":"intro","title":"认识 AI","markdown":"原始内容","imageIds":[]},{"id":"practice","title":"练习","markdown":"保留的练习","imageIds":[]}]}`
		case 3:
			raw, _ := json.Marshal(payload)
			if !strings.Contains(string(raw), target) || !strings.Contains(string(raw), "intro") {
				t.Error("selected target missing from model context")
			}
			name, args = "read_deliverable", fmt.Sprintf(`{"id":%q}`, target)
		case 4:
			name, args = "edit_deliverable", fmt.Sprintf(`{"id":%q,"revision":1,"changes":[{"action":"replace","blockId":"intro","block":{"id":"intro","title":"身边的 AI","markdown":"修改后的内容","imageIds":[]}}]}`, target)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		delta := map[string]any{"role": "assistant", "content": "已更新右侧产物。"}
		reason := "stop"
		if name != "" {
			delta = map[string]any{"role": "assistant", "tool_calls": []any{map[string]any{"index": 0, "id": fmt.Sprintf("call-%d", call), "type": "function", "function": map[string]any{"name": name, "arguments": args}}}}
			reason = "tool_calls"
		}
		for _, choice := range []any{map[string]any{"index": 0, "delta": delta, "finish_reason": nil}, map[string]any{"index": 0, "delta": map[string]any{}, "finish_reason": reason}} {
			raw, _ := json.Marshal(map[string]any{"id": "answer", "object": "chat.completion.chunk", "created": 1, "model": "test", "choices": []any{choice}})
			_, _ = fmt.Fprintf(w, "data: %s\n\n", raw)
		}
		_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	t.Cleanup(upstream.Close)
	a.app.config.Model.Endpoint, a.app.config.Model.ID = upstream.URL, "test"
	startAgentWorker(t, a)
	owner := a.register("deliverable-agent@example.com")
	course, conversation := a.createCourseConversation(owner)
	opened := a.request(owner, "POST", "/agent/sessions", map[string]any{"kind": "course", "courseId": course, "conversationId": conversation}, 201)
	id := opened["id"].(string)
	command := func(requestID, action string, args []any) map[string]any {
		t.Helper()
		a.request(owner, "POST", "/agent/sessions/"+id+"/commands", map[string]any{"requestId": requestID, "action": action, "args": args}, 202)
		deadline := time.Now().Add(15 * time.Second)
		for time.Now().Before(deadline) {
			state := a.request(owner, "GET", "/agent/sessions/"+id, nil, 200)["state"].(map[string]any)
			if commands, ok := state["commands"].(map[string]any); ok {
				if receipt, ok := commands[requestID].(map[string]any); ok && receipt["status"] == "complete" {
					return state
				}
			}
			time.Sleep(50 * time.Millisecond)
		}
		t.Fatal("agent command did not complete")
		return nil
	}
	command("create", "prompt", []any{"制作两页 PPT"})
	items := a.request(owner, "GET", "/courses/"+course+"/deliverables", nil, 200)["deliverables"].([]any)
	if len(items) != 3 {
		t.Fatalf("agent did not save a deliverable: %v", items)
	}
	target = items[2].(map[string]any)["id"].(string)
	command("select", "selectDeliverable", []any{target, "intro"})
	state := command("edit", "prompt", []any{"把这一页改成身边的例子"})
	item := a.request(owner, "GET", "/courses/"+course+"/deliverables/"+target, nil, 200)["deliverable"].(map[string]any)
	blocks := item["blocks"].([]any)
	if item["revision"] != float64(2) || blocks[0].(map[string]any)["markdown"] != "修改后的内容" || blocks[1].(map[string]any)["markdown"] != "保留的练习" {
		t.Fatalf("incorrect saved edit: %v", item)
	}
	if state["deliverablesChanged"] != float64(2) {
		t.Fatalf("review refresh not published: %v", state)
	}
}

func TestImportedPresentationCanBeEditedAndKeepsItsPicture(t *testing.T) {
	a := setupAccountTest(t)
	owner := a.register("import-deck@example.com")
	other := a.register("import-other@example.com")
	course, _ := a.createCourseConversation(owner)
	var file bytes.Buffer
	z := zip.NewWriter(&file)
	parts := map[string]string{
		"ppt/presentation.xml":             `<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="r1"/></p:sldIdLst></p:presentation>`,
		"ppt/_rels/presentation.xml.rels":  `<Relationships><Relationship Id="r1" Target="slides/slide1.xml"/></Relationships>`,
		"ppt/slides/slide1.xml":            `<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><a:p><a:r><a:t>人工智能</a:t></a:r></a:p><a:p><a:r><a:t>认识语音助手</a:t></a:r></a:p><a:blip r:embed="image1"/><a:chart r:id="chart1"/></p:sld>`,
		"ppt/slides/_rels/slide1.xml.rels": `<Relationships><Relationship Id="image1" Target="../media/picture.png"/></Relationships>`,
	}
	for name, data := range parts {
		w, _ := z.Create(name)
		_, _ = w.Write([]byte(data))
	}
	var picture bytes.Buffer
	_ = png.Encode(&picture, image.NewRGBA(image.Rect(0, 0, 8, 8)))
	w, _ := z.Create("ppt/media/picture.png")
	_, _ = w.Write(picture.Bytes())
	_ = z.Close()
	path := "/courses/" + course + "/deliverables"
	input := map[string]any{"name": "导入课件.pptx", "base64": base64.StdEncoding.EncodeToString(file.Bytes()), "requestId": "import-one"}
	item := a.request(owner, "POST", path+"/import", input, http.StatusCreated)["deliverable"].(map[string]any)
	block := item["blocks"].([]any)[0].(map[string]any)
	if notes, ok := item["importNotes"].([]any); !ok || len(notes) < 2 {
		t.Fatal("import must report reflow and unsupported chart content")
	}
	if block["title"] != "人工智能" || block["markdown"] != "认识语音助手" {
		t.Fatalf("lost slide content: %v", item)
	}
	image := block["imageIds"].([]any)[0].(string)
	download := a.request(owner, "GET", "/courses/"+course+"/deliverable-images/"+image, nil, http.StatusOK)
	a.request(other, "GET", "/courses/"+course+"/deliverable-images/"+image, nil, http.StatusNotFound)
	block["markdown"] = "重新编辑后的内容"
	a.request(owner, "PATCH", path+"/"+item["id"].(string), map[string]any{"revision": 1, "requestId": "edit-import", "changes": []any{map[string]any{"action": "replace", "blockId": block["id"], "block": block}}}, http.StatusOK)
	a.request(owner, "DELETE", "/courses/"+course, nil, http.StatusOK)
	response, err := owner.Get(download["url"].(string))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNotFound {
		t.Fatal("deleted course left its deliverable picture available")
	}
}

func TestDeliverableCanBeRevisedAndRestoredWithoutChangingClassroom(t *testing.T) {
	a := setupAccountTest(t)
	owner := a.register("deliverables@example.com")
	other := a.register("other-deliverables@example.com")
	course, _ := a.createCourseConversation(owner)
	path := "/courses/" + course + "/deliverables"
	draft := map[string]any{"requestId": "create-one", "kind": "presentation", "title": "人工智能入门", "blocks": []any{
		map[string]any{"id": "intro", "title": "什么是人工智能", "markdown": "从生活中的例子认识人工智能。", "imageIds": []string{}},
		map[string]any{"id": "practice", "title": "练习", "markdown": "找出一个生活中的例子。", "imageIds": []string{}},
	}}
	created := a.request(owner, "POST", path, draft, http.StatusCreated)["deliverable"].(map[string]any)
	id := created["id"].(string)
	retried := a.request(owner, "POST", path, draft, http.StatusCreated)["deliverable"].(map[string]any)
	if retried["id"] != id {
		t.Fatal("retry created another deliverable")
	}
	edit := map[string]any{"requestId": "edit-one", "revision": 1, "changes": []any{
		map[string]any{"action": "replace", "blockId": "intro", "block": map[string]any{"id": "intro", "title": "身边的人工智能", "markdown": "语音助手可以理解简单的问题。", "imageIds": []string{}}},
		map[string]any{"action": "move", "blockId": "practice", "afterId": ""},
	}}
	a.request(owner, "PATCH", path+"/"+id, edit, http.StatusOK)
	a.request(owner, "PATCH", path+"/"+id, edit, http.StatusOK)
	edit["requestId"] = "stale-edit"
	a.request(owner, "PATCH", path+"/"+id, edit, http.StatusConflict)
	restored := a.request(owner, "GET", path+"/"+id, nil, http.StatusOK)["deliverable"].(map[string]any)
	blocks := restored["blocks"].([]any)
	if restored["revision"] != float64(2) || blocks[0].(map[string]any)["id"] != "practice" || blocks[1].(map[string]any)["title"] != "身边的人工智能" {
		t.Fatalf("incorrect revision: %v", restored)
	}
	listed := a.request(owner, "GET", path, nil, http.StatusOK)["deliverables"].([]any)
	if len(listed) != 3 {
		t.Fatalf("unexpected list: %v", listed)
	}
	a.request(other, "GET", path+"/"+id, nil, http.StatusNotFound)
	a.request(other, "PATCH", path+"/"+id, edit, http.StatusNotFound)
	edit["requestId"] = "invalid-batch"
	edit["revision"] = 2
	edit["changes"] = []any{
		map[string]any{"action": "remove", "blockId": "intro"},
		map[string]any{"action": "remove", "blockId": "does-not-exist"},
	}
	a.request(owner, "PATCH", path+"/"+id, edit, http.StatusBadRequest)
	unchanged := a.request(owner, "GET", path+"/"+id, nil, http.StatusOK)["deliverable"].(map[string]any)
	if unchanged["revision"] != float64(2) || len(unchanged["blocks"].([]any)) != 2 {
		t.Fatal("failed batch changed saved content")
	}
	draft["title"] = "different request"
	a.request(owner, "POST", path, draft, http.StatusConflict)
}

func TestDocumentPatchesMatchOriginalTextAndFailAtomically(t *testing.T) {
	a := setupAccountTest(t)
	owner := a.register("document-patch@example.com")
	course, _ := a.createCourseConversation(owner)
	path := "/courses/" + course + "/deliverables"
	item := a.request(owner, "POST", path, map[string]any{"requestId": "create", "kind": "document", "title": "教程", "blocks": []any{map[string]any{"id": "intro", "title": "基础", "markdown": "保留第一段。\n\n第一处需要修改。第二处需要调整。重复。重复。", "imageIds": []string{}}}}, 201)["deliverable"].(map[string]any)
	id := item["id"].(string)
	input := map[string]any{"requestId": "patch", "revision": 1, "changes": []any{map[string]any{"action": "patch", "blockId": "intro", "field": "markdown", "oldText": "第一处需要修改。", "newText": "第一处已修改。"}, map[string]any{"action": "patch", "blockId": "intro", "field": "markdown", "oldText": "第二处需要调整。", "newText": "第二处已调整。"}}}
	patched := a.request(owner, "PATCH", path+"/"+id, input, 200)["deliverable"].(map[string]any)
	block := patched["blocks"].([]any)[0].(map[string]any)
	if block["markdown"] != "保留第一段。\n\n第一处已修改。第二处已调整。重复。重复。" || block["title"] != "基础" {
		t.Fatalf("patch changed unrelated source: %v", block)
	}
	input["requestId"], input["revision"] = "ambiguous", 2
	input["changes"] = []any{map[string]any{"action": "patch", "blockId": "intro", "field": "markdown", "oldText": "保留第一段。", "newText": "不应保存。"}, map[string]any{"action": "patch", "blockId": "intro", "field": "markdown", "oldText": "重复。", "newText": "有歧义。"}}
	a.request(owner, "PATCH", path+"/"+id, input, 400)
	restored := a.request(owner, "GET", path+"/"+id, nil, 200)["deliverable"].(map[string]any)
	if restored["revision"] != float64(2) || restored["blocks"].([]any)[0].(map[string]any)["markdown"] != block["markdown"] {
		t.Fatal("failed patch changed source")
	}
}
