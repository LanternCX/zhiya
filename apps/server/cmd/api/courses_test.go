package main

import (
	"bytes"
	"io"
	"net/http"
	"testing"
)

func (a *testApp) uploadMaterial(c *http.Client, courseID, filename, content string, status int) map[string]any {
	a.t.Helper()
	started := a.request(c, "POST", "/courses/"+courseID+"/material-uploads", map[string]any{
		"name": filename, "sizeBytes": len(content),
	}, status)
	if status != http.StatusCreated {
		return started
	}
	upload := started["upload"].(map[string]any)
	listed := a.request(c, "GET", "/courses/"+courseID+"/materials", nil, http.StatusOK)["materials"].([]any)
	if len(listed) != 0 {
		a.t.Fatalf("unfinished upload was listed: %v", listed)
	}
	req, _ := http.NewRequest("PUT", upload["url"].(string), bytes.NewReader([]byte(content)))
	for name, value := range upload["headers"].(map[string]any) {
		req.Header.Set(name, value.(string))
	}
	res, err := c.Do(req)
	if err != nil {
		a.t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		a.t.Fatalf("direct upload %s = %d %s", filename, res.StatusCode, raw)
	}
	completePath := "/courses/" + courseID + "/material-uploads/" + upload["id"].(string) + "/complete"
	result := a.request(c, "POST", completePath, nil, http.StatusCreated)
	retried := a.request(c, "POST", completePath, nil, http.StatusCreated)
	if retried["material"].(map[string]any)["id"] != result["material"].(map[string]any)["id"] {
		a.t.Fatalf("retried completion created another material: %v", retried)
	}
	return result
}

func TestCourseCreationStartsWithoutLearningStructure(t *testing.T) {
	a := setupAccountTest(t)
	student := a.register("empty-course@example.com")

	created := a.request(student, "POST", "/courses", map[string]any{
		"title": "认识人工智能",
		"topic": "从生活中的例子理解人工智能",
		"cover": map[string]any{
			"motif":   "code",
			"palette": "sprout",
			"label":   "COMPUTING · 01",
		},
	}, http.StatusCreated)["course"].(map[string]any)

	if created["conversationId"] != "" || len(created["sections"].([]any)) != 0 {
		t.Fatalf("new course created placeholder learning structure: %v", created)
	}
}

func TestCourseCRUDPersistsOneConversation(t *testing.T) {
	a := setupAccountTest(t)
	student := a.register("courses@example.com")

	created := a.request(student, "POST", "/courses", map[string]any{
		"title": "认识人工智能",
		"topic": "从生活中的例子理解人工智能",
		"cover": map[string]any{
			"motif":   "code",
			"palette": "sprout",
			"label":   "COMPUTING · 01",
		},
	}, http.StatusCreated)["course"].(map[string]any)
	id := created["id"].(string)
	if id == "" {
		t.Fatalf("course was not created: %v", created)
	}
	cover := created["cover"].(map[string]any)
	if cover["motif"] != "code" || cover["palette"] != "sprout" || cover["label"] != "COMPUTING · 01" {
		t.Fatalf("course cover was not preserved: %v", cover)
	}
	outlined := a.request(student, "PUT", "/courses/"+id+"/outline", map[string]any{
		"sections": []any{
			map[string]any{"title": "认识人工智能", "objective": "理解人工智能能做什么"},
		},
	}, http.StatusOK)["course"].(map[string]any)
	sectionID := outlined["sections"].([]any)[0].(map[string]any)["id"].(string)
	conversation := a.request(student, "POST", "/courses/"+id+"/sections/"+sectionID+"/conversations", map[string]any{
		"title": "生活中的人工智能",
	}, http.StatusCreated)["conversation"].(map[string]any)
	conversationID := conversation["id"].(string)

	state := map[string]any{
		"messages":         []any{map[string]any{"id": 1, "role": "user", "text": "什么是人工智能？"}},
		"pages":            []any{},
		"presentedPageIds": []any{},
		"currentPageId":    "",
	}
	a.request(student, "PUT", "/courses/"+id+"/conversation", map[string]any{
		"conversationId": conversationID,
		"state":          state,
	}, http.StatusOK)

	listed := a.request(student, "GET", "/courses", nil, http.StatusOK)["courses"].([]any)
	if len(listed) != 1 || listed[0].(map[string]any)["title"] != "认识人工智能" {
		t.Fatalf("created course not listed: %v", listed)
	}
	restored := a.request(student, "GET", "/courses/"+id, nil, http.StatusOK)["course"].(map[string]any)
	messages := restored["state"].(map[string]any)["messages"].([]any)
	if len(messages) != 1 || messages[0].(map[string]any)["text"] != "什么是人工智能？" {
		t.Fatalf("conversation was not restored: %v", restored)
	}

	updated := a.request(student, "PATCH", "/courses/"+id, map[string]any{
		"title": "人工智能入门",
	}, http.StatusOK)["course"].(map[string]any)
	if updated["title"] != "人工智能入门" {
		t.Fatalf("course was not renamed: %v", updated)
	}

	a.request(student, "DELETE", "/courses/"+id, nil, http.StatusOK)
	listed = a.request(student, "GET", "/courses", nil, http.StatusOK)["courses"].([]any)
	if len(listed) != 0 {
		t.Fatalf("deleted course still listed: %v", listed)
	}
}

func TestCoursesArePrivateToTheirStudent(t *testing.T) {
	a := setupAccountTest(t)
	owner := a.register("course-owner@example.com")
	other := a.register("course-other@example.com")
	created := a.request(owner, "POST", "/courses", map[string]any{
		"title": "只属于我的课程",
		"topic": "隐私",
		"cover": map[string]any{"motif": "abstract", "palette": "sunrise", "label": "PRIVATE"},
	}, http.StatusCreated)["course"].(map[string]any)
	id := created["id"].(string)

	a.request(other, "GET", "/courses/"+id, nil, http.StatusNotFound)
	a.request(other, "PATCH", "/courses/"+id, map[string]any{"title": "越权修改"}, http.StatusNotFound)
	a.request(other, "DELETE", "/courses/"+id, nil, http.StatusNotFound)
	listed := a.request(other, "GET", "/courses", nil, http.StatusOK)["courses"].([]any)
	if len(listed) != 0 {
		t.Fatalf("another student's course leaked: %v", listed)
	}
}

func TestCourseMaterialsUploadListReadAndStayPrivate(t *testing.T) {
	a := setupAccountTest(t)
	owner := a.register("material-owner@example.com")
	other := a.register("material-other@example.com")
	created := a.request(owner, "POST", "/courses", map[string]any{
		"title": "Python 入门",
		"topic": "学习 Python",
		"cover": map[string]any{"motif": "code", "palette": "sprout", "label": "PYTHON"},
	}, http.StatusCreated)["course"].(map[string]any)
	courseID := created["id"].(string)

	uploaded := a.uploadMaterial(owner, courseID, "基础.md", "# 变量\n变量保存数据。", http.StatusCreated)["material"].(map[string]any)
	materialID := uploaded["id"].(string)
	if uploaded["name"] != "基础.md" || uploaded["sizeBytes"] != float64(len("# 变量\n变量保存数据。")) {
		t.Fatalf("unexpected material metadata: %v", uploaded)
	}

	materials := a.request(owner, "GET", "/courses/"+courseID+"/materials", nil, http.StatusOK)["materials"].([]any)
	if len(materials) != 1 || materials[0].(map[string]any)["id"] != materialID {
		t.Fatalf("uploaded material not listed: %v", materials)
	}
	download := a.request(owner, "GET", "/courses/"+courseID+"/materials/"+materialID+"/download", nil, http.StatusOK)
	res, err := owner.Get(download["url"].(string))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	content, _ := io.ReadAll(res.Body)
	if string(content) != "# 变量\n变量保存数据。" {
		t.Fatalf("material content changed: %q", content)
	}

	a.request(other, "GET", "/courses/"+courseID+"/materials", nil, http.StatusNotFound)
	a.request(other, "GET", "/courses/"+courseID+"/materials/"+materialID+"/download", nil, http.StatusNotFound)
	a.uploadMaterial(owner, courseID, "讲义.pdf", "%PDF", http.StatusBadRequest)
	a.request(owner, "DELETE", "/courses/"+courseID+"/materials/"+materialID, map[string]any{}, http.StatusOK)
	a.request(owner, "GET", "/courses/"+courseID+"/materials/"+materialID+"/download", nil, http.StatusNotFound)
}

func TestDeletingCourseRemovesUnfinishedDirectUpload(t *testing.T) {
	a := setupAccountTest(t)
	student := a.register("unfinished-material@example.com")
	created := a.request(student, "POST", "/courses", map[string]any{
		"title": "待删除课程", "topic": "清理上传",
		"cover": map[string]any{"motif": "code", "palette": "sprout", "label": "CLEANUP"},
	}, http.StatusCreated)["course"].(map[string]any)
	courseID := created["id"].(string)
	started := a.request(student, "POST", "/courses/"+courseID+"/material-uploads", map[string]any{
		"name": "notes.txt", "sizeBytes": 5,
	}, http.StatusCreated)["upload"].(map[string]any)
	req, _ := http.NewRequest(http.MethodPut, started["url"].(string), bytes.NewBufferString("notes"))
	for name, value := range started["headers"].(map[string]any) {
		req.Header.Set(name, value.(string))
	}
	res, err := student.Do(req)
	if err != nil || res.StatusCode != http.StatusOK {
		t.Fatalf("direct upload = %v, %v", res, err)
	}
	_ = res.Body.Close()

	a.request(student, "DELETE", "/courses/"+courseID, nil, http.StatusOK)
	res, err = student.Get(started["url"].(string))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("unfinished object survived course deletion: %d", res.StatusCode)
	}
}

func TestInvalidDirectUploadIsRejectedAndRemoved(t *testing.T) {
	a := setupAccountTest(t)
	student := a.register("invalid-material@example.com")
	created := a.request(student, "POST", "/courses", map[string]any{
		"title": "材料校验", "topic": "拒绝无效内容",
		"cover": map[string]any{"motif": "code", "palette": "sprout", "label": "VALIDATE"},
	}, http.StatusCreated)["course"].(map[string]any)
	courseID := created["id"].(string)
	started := a.request(student, "POST", "/courses/"+courseID+"/material-uploads", map[string]any{
		"name": "invalid.txt", "sizeBytes": 1,
	}, http.StatusCreated)["upload"].(map[string]any)
	req, _ := http.NewRequest(http.MethodPut, started["url"].(string), bytes.NewReader([]byte{0xff}))
	for name, value := range started["headers"].(map[string]any) {
		req.Header.Set(name, value.(string))
	}
	res, err := student.Do(req)
	if err != nil || res.StatusCode != http.StatusOK {
		t.Fatalf("direct upload = %v, %v", res, err)
	}
	_ = res.Body.Close()
	completePath := "/courses/" + courseID + "/material-uploads/" + started["id"].(string) + "/complete"
	a.request(student, "POST", completePath, nil, http.StatusBadRequest)
	a.request(student, "POST", completePath, nil, http.StatusNotFound)
	listed := a.request(student, "GET", "/courses/"+courseID+"/materials", nil, http.StatusOK)["materials"].([]any)
	if len(listed) != 0 {
		t.Fatalf("invalid material was listed: %v", listed)
	}
	res, err = student.Get(started["url"].(string))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("invalid object was not removed: %d", res.StatusCode)
	}
}

func TestCourseOutlineOrganizesMultipleConversations(t *testing.T) {
	a := setupAccountTest(t)
	student := a.register("outline@example.com")
	created := a.request(student, "POST", "/courses", map[string]any{
		"title": "Python 入门",
		"topic": "从基础开始学习 Python",
		"cover": map[string]any{"motif": "code", "palette": "sprout", "label": "PYTHON"},
	}, http.StatusCreated)["course"].(map[string]any)
	courseID := created["id"].(string)

	outline := a.request(student, "PUT", "/courses/"+courseID+"/outline", map[string]any{
		"sections": []any{
			map[string]any{"title": "变量与类型", "objective": "理解变量和常见数据类型"},
			map[string]any{"title": "循环", "objective": "使用循环解决重复任务"},
		},
	}, http.StatusOK)["course"].(map[string]any)
	sections := outline["sections"].([]any)
	if len(sections) != 2 || sections[0].(map[string]any)["title"] != "变量与类型" {
		t.Fatalf("outline order was not preserved: %v", sections)
	}
	first := sections[0].(map[string]any)
	firstID := first["id"].(string)
	firstConversation := a.request(student, "POST", "/courses/"+courseID+"/sections/"+firstID+"/conversations", map[string]any{
		"title": "第一次学习",
	}, http.StatusCreated)["conversation"].(map[string]any)
	restored := a.request(student, "GET", "/courses/"+courseID, nil, http.StatusOK)["course"].(map[string]any)
	first = restored["sections"].([]any)[0].(map[string]any)
	conversations := first["conversations"].([]any)
	if len(conversations) != 1 || conversations[0].(map[string]any)["id"] != firstConversation["id"] {
		t.Fatalf("first conversation was not created in the first section: %v", first)
	}

	secondID := sections[1].(map[string]any)["id"].(string)
	added := a.request(student, "POST", "/courses/"+courseID+"/sections/"+secondID+"/conversations", map[string]any{
		"title": "循环练习",
	}, http.StatusCreated)["conversation"].(map[string]any)
	if added["title"] != "循环练习" {
		t.Fatalf("conversation title was not preserved: %v", added)
	}
	restored = a.request(student, "GET", "/courses/"+courseID, nil, http.StatusOK)["course"].(map[string]any)
	second := restored["sections"].([]any)[1].(map[string]any)
	if len(second["conversations"].([]any)) != 1 {
		t.Fatalf("section conversations were not restored: %v", second)
	}

	started := a.request(student, "PUT", "/courses/"+courseID+"/outline", map[string]any{
		"sections": []any{
			map[string]any{"id": secondID, "title": "循环与迭代", "objective": "熟练使用循环", "status": "active"},
			map[string]any{"id": firstID, "title": "变量与类型", "objective": "理解变量和常见数据类型", "status": "complete"},
		},
	}, http.StatusAccepted)["reorganization"].(map[string]any)
	var updated map[string]any
	pendingReassignments := started["pending"].([]any)
	for index, item := range pendingReassignments {
		pending := item.(map[string]any)
		status := http.StatusAccepted
		if index == len(pendingReassignments)-1 {
			status = http.StatusOK
		}
		result := a.request(student, "PUT", "/courses/"+courseID+"/outline-reorganizations/"+started["id"].(string)+"/assignments/"+pending["id"].(string), map[string]any{
			"sectionId": pending["sectionId"], "conversationUpdatedAt": pending["updatedAt"], "reason": "保持与实际学习内容一致",
		}, status)
		if course, ok := result["course"].(map[string]any); ok {
			updated = course
		}
	}
	if updated == nil {
		t.Fatal("outline reorganization did not publish")
	}
	updatedSections := updated["sections"].([]any)
	if updatedSections[0].(map[string]any)["id"] != secondID || updatedSections[0].(map[string]any)["status"] != "active" {
		t.Fatalf("outline update did not preserve and reorder sections: %v", updatedSections)
	}
	if len(updatedSections[0].(map[string]any)["conversations"].([]any)) != 1 {
		t.Fatalf("outline update lost an existing conversation: %v", updatedSections[0])
	}

	a.request(student, "PUT", "/courses/"+courseID+"/outline", map[string]any{
		"sections": []any{
			map[string]any{"id": secondID, "title": "循环", "objective": "练习循环"},
			map[string]any{"id": secondID, "title": "重复循环", "objective": "不应接受重复标识"},
		},
	}, http.StatusBadRequest)
	archiveJob := a.request(student, "PUT", "/courses/"+courseID+"/outline", map[string]any{
		"sections": []any{
			map[string]any{"id": secondID, "title": "循环与迭代", "objective": "熟练使用循环"},
		},
	}, http.StatusAccepted)["reorganization"].(map[string]any)
	var archived []any
	pendingItems := archiveJob["pending"].([]any)
	for index, item := range pendingItems {
		pending := item.(map[string]any)
		status := http.StatusAccepted
		if index == len(pendingItems)-1 {
			status = http.StatusOK
		}
		result := a.request(student, "PUT", "/courses/"+courseID+"/outline-reorganizations/"+archiveJob["id"].(string)+"/assignments/"+pending["id"].(string), map[string]any{
			"sectionId": secondID, "conversationUpdatedAt": pending["updatedAt"], "reason": "新版大纲将相关学习合并到循环小节",
		}, status)
		if course, ok := result["course"].(map[string]any); ok {
			archived = course["sections"].([]any)
		}
	}
	if len(archived) != 2 || archived[0].(map[string]any)["status"] != "active" || len(archived[0].(map[string]any)["conversations"].([]any)) != 2 || archived[1].(map[string]any)["status"] != "archived" || len(archived[1].(map[string]any)["conversations"].([]any)) != 0 {
		t.Fatalf("removed outline section did not reclassify its history: %v", archived)
	}
}

func TestCourseOutlineReorganizationClassifiesConversationContentBeforePublishing(t *testing.T) {
	a := setupAccountTest(t)
	student := a.register("outline-reorganization@example.com")
	created := a.request(student, "POST", "/courses", map[string]any{
		"title": "Python 入门", "topic": "从项目中学习 Python",
		"cover": map[string]any{"motif": "code", "palette": "sprout", "label": "PYTHON"},
	}, http.StatusCreated)["course"].(map[string]any)
	courseID := created["id"].(string)
	outlined := a.request(student, "PUT", "/courses/"+courseID+"/outline", map[string]any{
		"sections": []any{
			map[string]any{"title": "基础语法", "objective": "理解变量和控制流"},
		},
	}, http.StatusOK)["course"].(map[string]any)
	oldSectionID := outlined["sections"].([]any)[0].(map[string]any)["id"].(string)
	conversation := a.request(student, "POST", "/courses/"+courseID+"/sections/"+oldSectionID+"/conversations", map[string]any{
		"title": "做一个猜数字游戏",
	}, http.StatusCreated)["conversation"].(map[string]any)
	conversationID := conversation["id"].(string)
	a.request(student, "PUT", "/courses/"+courseID+"/conversation", map[string]any{
		"conversationId": conversationID,
		"state": map[string]any{
			"messages": []any{
				map[string]any{"id": 1, "role": "user", "text": "我想给猜数字游戏加上最多五次机会"},
				map[string]any{"id": 2, "role": "assistant", "text": "可以用循环记录尝试次数。"},
			},
			"pages": []any{}, "presentedPageIds": []any{}, "currentPageId": "",
		},
	}, http.StatusOK)

	started := a.request(student, "PUT", "/courses/"+courseID+"/outline", map[string]any{
		"sections": []any{
			map[string]any{"title": "函数", "objective": "用函数组织程序"},
			map[string]any{"title": "循环项目", "objective": "在项目中控制重复执行"},
		},
	}, http.StatusAccepted)["reorganization"].(map[string]any)
	if started["pendingCount"] != float64(1) {
		t.Fatalf("conversation was not queued for classification: %v", started)
	}
	unchanged := a.request(student, "GET", "/courses/"+courseID, nil, http.StatusOK)["course"].(map[string]any)
	if unchanged["sections"].([]any)[0].(map[string]any)["id"] != oldSectionID {
		t.Fatalf("draft outline became visible before classification: %v", unchanged)
	}

	work := a.request(student, "GET", "/courses/"+courseID+"/outline-reorganization", nil, http.StatusOK)["reorganization"].(map[string]any)
	pending := work["pending"].([]any)
	if len(pending) != 1 {
		t.Fatalf("unexpected classification queue: %v", pending)
	}
	queued := pending[0].(map[string]any)
	messages := queued["state"].(map[string]any)["messages"].([]any)
	if messages[0].(map[string]any)["text"] != "我想给猜数字游戏加上最多五次机会" {
		t.Fatalf("classification did not expose conversation content: %v", queued)
	}
	targetSectionID := work["sections"].([]any)[1].(map[string]any)["id"].(string)
	published := a.request(student, "PUT", "/courses/"+courseID+"/outline-reorganizations/"+work["id"].(string)+"/assignments/"+conversationID, map[string]any{
		"sectionId":             targetSectionID,
		"conversationUpdatedAt": queued["updatedAt"],
		"reason":                "对话的主要内容是用循环限制游戏尝试次数",
	}, http.StatusOK)["course"].(map[string]any)
	sections := published["sections"].([]any)
	if len(sections) != 3 || sections[0].(map[string]any)["title"] != "函数" || sections[1].(map[string]any)["title"] != "循环项目" {
		t.Fatalf("draft outline was not published: %v", sections)
	}
	assigned := sections[1].(map[string]any)["conversations"].([]any)
	if len(assigned) != 1 || assigned[0].(map[string]any)["id"] != conversationID {
		t.Fatalf("conversation was not assigned from its classified content: %v", sections)
	}
	if sections[2].(map[string]any)["status"] != "archived" {
		t.Fatalf("replaced section was not archived: %v", sections)
	}
}

func TestCourseOutlineReorganizationRequeuesAConversationThatChangesDuringClassification(t *testing.T) {
	a := setupAccountTest(t)
	student := a.register("outline-stale@example.com")
	created := a.request(student, "POST", "/courses", map[string]any{
		"title": "Python 项目", "topic": "逐步完善项目",
		"cover": map[string]any{"motif": "code", "palette": "sprout", "label": "PYTHON"},
	}, http.StatusCreated)["course"].(map[string]any)
	courseID := created["id"].(string)
	outlined := a.request(student, "PUT", "/courses/"+courseID+"/outline", map[string]any{
		"sections": []any{map[string]any{"title": "项目基础", "objective": "完成第一个项目"}},
	}, http.StatusOK)["course"].(map[string]any)
	oldSectionID := outlined["sections"].([]any)[0].(map[string]any)["id"].(string)
	conversation := a.request(student, "POST", "/courses/"+courseID+"/sections/"+oldSectionID+"/conversations", map[string]any{
		"title": "小游戏",
	}, http.StatusCreated)["conversation"].(map[string]any)
	conversationID := conversation["id"].(string)
	job := a.request(student, "PUT", "/courses/"+courseID+"/outline", map[string]any{
		"sections": []any{map[string]any{"title": "循环项目", "objective": "使用循环完成小游戏"}},
	}, http.StatusAccepted)["reorganization"].(map[string]any)
	queued := job["pending"].([]any)[0].(map[string]any)
	targetID := job["sections"].([]any)[0].(map[string]any)["id"].(string)

	a.request(student, "PUT", "/courses/"+courseID+"/conversation", map[string]any{
		"conversationId": conversationID,
		"state": map[string]any{
			"messages": []any{map[string]any{"id": 1, "role": "user", "text": "项目改成用循环控制五次机会"}},
			"pages":    []any{}, "presentedPageIds": []any{}, "currentPageId": "",
		},
	}, http.StatusOK)
	a.request(student, "PUT", "/courses/"+courseID+"/outline-reorganizations/"+job["id"].(string)+"/assignments/"+conversationID, map[string]any{
		"sectionId": targetID, "conversationUpdatedAt": queued["updatedAt"], "reason": "旧内容的分类结果",
	}, http.StatusConflict)

	refreshed := a.request(student, "GET", "/courses/"+courseID+"/outline-reorganization", nil, http.StatusOK)["reorganization"].(map[string]any)
	requeued := refreshed["pending"].([]any)[0].(map[string]any)
	if requeued["updatedAt"] == queued["updatedAt"] || requeued["state"].(map[string]any)["messages"].([]any)[0].(map[string]any)["text"] != "项目改成用循环控制五次机会" {
		t.Fatalf("changed conversation was not requeued with current content: %v", requeued)
	}
	published := a.request(student, "PUT", "/courses/"+courseID+"/outline-reorganizations/"+job["id"].(string)+"/assignments/"+conversationID, map[string]any{
		"sectionId": targetID, "conversationUpdatedAt": requeued["updatedAt"], "reason": "新内容主要使用循环",
	}, http.StatusOK)["course"].(map[string]any)
	if published["sections"].([]any)[0].(map[string]any)["conversations"].([]any)[0].(map[string]any)["id"] != conversationID {
		t.Fatalf("reclassified conversation was not published: %v", published)
	}
}

func TestCourseOutlineReorganizationCanCreateASectionForUnmatchedContent(t *testing.T) {
	a := setupAccountTest(t)
	student := a.register("outline-no-fit@example.com")
	created := a.request(student, "POST", "/courses", map[string]any{
		"title": "Python 综合", "topic": "学习 Python",
		"cover": map[string]any{"motif": "code", "palette": "sprout", "label": "PYTHON"},
	}, http.StatusCreated)["course"].(map[string]any)
	courseID := created["id"].(string)
	outlined := a.request(student, "PUT", "/courses/"+courseID+"/outline", map[string]any{
		"sections": []any{map[string]any{"title": "基础语法", "objective": "理解变量"}},
	}, http.StatusOK)["course"].(map[string]any)
	oldSectionID := outlined["sections"].([]any)[0].(map[string]any)["id"].(string)
	conversation := a.request(student, "POST", "/courses/"+courseID+"/sections/"+oldSectionID+"/conversations", map[string]any{
		"title": "调试网络程序",
	}, http.StatusCreated)["conversation"].(map[string]any)
	job := a.request(student, "PUT", "/courses/"+courseID+"/outline", map[string]any{
		"sections": []any{map[string]any{"title": "函数", "objective": "使用函数组织代码"}},
	}, http.StatusAccepted)["reorganization"].(map[string]any)
	queued := job["pending"].([]any)[0].(map[string]any)
	published := a.request(student, "PUT", "/courses/"+courseID+"/outline-reorganizations/"+job["id"].(string)+"/assignments/"+conversation["id"].(string), map[string]any{
		"newSection":            map[string]any{"title": "网络程序调试", "objective": "定位并修复网络程序问题"},
		"conversationUpdatedAt": queued["updatedAt"], "reason": "现有大纲没有涵盖网络调试",
	}, http.StatusOK)["course"].(map[string]any)
	sections := published["sections"].([]any)
	if len(sections) != 3 || sections[1].(map[string]any)["title"] != "网络程序调试" || len(sections[1].(map[string]any)["conversations"].([]any)) != 1 {
		t.Fatalf("unmatched content did not create an assigned section: %v", sections)
	}
}

func TestCourseConversationDeletionPreservesItsSectionAndPrivacy(t *testing.T) {
	a := setupAccountTest(t)
	owner := a.register("conversation-delete-owner@example.com")
	other := a.register("conversation-delete-other@example.com")
	created := a.request(owner, "POST", "/courses", map[string]any{
		"title": "Python 入门",
		"topic": "学习 Python",
		"cover": map[string]any{"motif": "code", "palette": "sprout", "label": "PYTHON"},
	}, http.StatusCreated)["course"].(map[string]any)
	courseID := created["id"].(string)
	outlined := a.request(owner, "PUT", "/courses/"+courseID+"/outline", map[string]any{
		"sections": []any{
			map[string]any{"title": "变量与类型", "objective": "理解变量和常见数据类型"},
		},
	}, http.StatusOK)["course"].(map[string]any)
	section := outlined["sections"].([]any)[0].(map[string]any)
	sectionID := section["id"].(string)
	first := a.request(owner, "POST", "/courses/"+courseID+"/sections/"+sectionID+"/conversations", map[string]any{
		"title": "第一次学习",
	}, http.StatusCreated)["conversation"].(map[string]any)
	firstID := first["id"].(string)
	second := a.request(owner, "POST", "/courses/"+courseID+"/sections/"+sectionID+"/conversations", map[string]any{
		"title": "第二次学习",
	}, http.StatusCreated)["conversation"].(map[string]any)
	secondID := second["id"].(string)

	remaining := a.request(owner, "DELETE", "/courses/"+courseID+"/sections/"+sectionID+"/conversations/"+firstID, nil, http.StatusOK)["course"].(map[string]any)
	remainingSection := remaining["sections"].([]any)[0].(map[string]any)
	remainingConversations := remainingSection["conversations"].([]any)
	if len(remainingConversations) != 1 || remainingConversations[0].(map[string]any)["id"] != secondID {
		t.Fatalf("deleting one conversation changed the section or wrong conversation: %v", remaining)
	}

	a.request(other, "DELETE", "/courses/"+courseID+"/sections/"+sectionID+"/conversations/"+secondID, nil, http.StatusNotFound)
	last := a.request(owner, "DELETE", "/courses/"+courseID+"/sections/"+sectionID+"/conversations/"+secondID, nil, http.StatusOK)["course"].(map[string]any)
	if last["conversationId"] != "" {
		t.Fatalf("course kept a deleted active conversation: %v", last)
	}
	lastSection := last["sections"].([]any)[0].(map[string]any)
	if len(lastSection["conversations"].([]any)) != 0 {
		t.Fatalf("deleting the last conversation removed or repopulated its section: %v", last)
	}
	state := last["state"].(map[string]any)
	if len(state["messages"].([]any)) != 0 {
		t.Fatalf("course without conversations did not return an empty state: %v", last)
	}
}
