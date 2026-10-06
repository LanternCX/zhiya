package client

import (
	"net/http"
	"strings"
	"testing"
)

func TestKnowledgeReferencesRequireLoginAndDistinguishUnavailableService(t *testing.T) {
	a := setupAccountTest(t)
	path := "/knowledge/" + strings.Repeat("a", 64) + "/blocks/doc-page-1"
	guest := a.client()
	for _, suffix := range []string{"", "/asset", "/original"} {
		a.request(guest, "GET", path+suffix, nil, http.StatusUnauthorized)
	}
	student := a.register("knowledge@example.com")
	response := a.request(student, "GET", path, nil, http.StatusServiceUnavailable)
	if response["error"] != "知识库暂时不可用" {
		t.Fatal("unavailable source was misreported as missing evidence")
	}
}
